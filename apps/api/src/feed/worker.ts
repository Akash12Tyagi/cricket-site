// Live-feed worker: a separate process from the API (`pnpm --filter @cricket/api feed`).
//
// Fans never call the data provider. One worker polls the licensed feed every few seconds, writes deliveries into
// Postgres through the same scoring engine, and refreshes the per-match snapshot that the API already serves to
// every viewer from Redis/CDN. So 10k or 1M viewers cost the provider the same: one request per poll.
// Several worker replicas can run for availability; a Redis lock makes exactly one of them the active poller.
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import pino from "pino";
import { z } from "zod";
import { createDb } from "@cricket/db";
import { createSportmonksFileProvider, createSportmonksProvider } from "./sportmonks.js";
import { openFeedMatches, syncFixture } from "./sync.js";
import { FeedError, type FeedFixture, type FeedProvider } from "./types.js";

import { apiRound, createYouTubeApi, YouTubeApiError } from "./youtube-api.js";
import { findMatchForTitle, syncChannels } from "./youtube.js";
import { newsroomRound } from "./newsroom.js";
import { streamConfig, streamsRound } from "../streams/index.js";
import { createHighlightlyClient } from "./highlightly.js";
import { createHighlightlyRunner } from "./highlightly-runner.js";

const env = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  /** none = video channels only; sportmonks = live API (needs token); sportmonks-file = replay a saved response (dev). */
  FEED_PROVIDER: z.enum(["none", "sportmonks", "sportmonks-file", "highlightly"]).default("none"),
  /** Highlightly Cricket API key (free plan: 100 requests/day). Scorecard feed: fixtures, live scores, scorecards. */
  HIGHLIGHTLY_API_KEY: z.string().min(10).optional(),
  HIGHLIGHTLY_DAILY_REQUESTS: z.coerce.number().int().min(10).default(100),
  /** Fastest live refresh allowed; the free plan's budget usually makes it ~15 min anyway. */
  HIGHLIGHTLY_MIN_LIST_SECONDS: z.coerce.number().int().min(5).default(15),
  SPORTMONKS_API_TOKEN: z.string().min(10).optional(),
  FEED_FILE: z.string().optional(),
  FEED_POLL_SECONDS: z.coerce.number().int().min(2).max(300).default(5),
  /** Create matches automatically for every live fixture in the plan (true), or only sync matches an admin linked (false). */
  FEED_AUTO_CREATE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  YOUTUBE_POLL_MINUTES: z.coerce.number().int().min(0).max(1440).default(10),
  /** Automated newsroom: seconds between rounds (0 = off). */
  NEWSROOM_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
  /** Live video: seconds between source checks (0 = off) and the hosts we may play from (see api/src/env.ts). */
  STREAM_CHECK_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  STREAM_HLS_HOSTS: z.string().default(""),
  STREAM_EMBED_HOSTS: z.string().default(""),
  STREAM_TOKEN_PARAM: z.string().regex(/^[A-Za-z0-9_-]{1,30}$/).default("token"),
  /** Free Google Cloud API key (YouTube Data API v3). Optional: enables full back catalogues and view counts. */
  YOUTUBE_API_KEY: z.string().min(20).optional(),
  /** Quota units/day the worker may spend (YouTube's free default is 10,000; keep headroom). */
  YOUTUBE_DAILY_UNITS: z.coerce.number().int().min(50).max(1_000_000).default(8000),
  WEB_INTERNAL_URL: z.url().optional(),
  REVALIDATE_SECRET: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
}).superRefine((e, ctx) => {
  if (e.FEED_PROVIDER === "sportmonks" && !e.SPORTMONKS_API_TOKEN) ctx.addIssue({ code: "custom", path: ["SPORTMONKS_API_TOKEN"], message: "required when FEED_PROVIDER=sportmonks" });
  if (e.FEED_PROVIDER === "highlightly" && !e.HIGHLIGHTLY_API_KEY) ctx.addIssue({ code: "custom", path: ["HIGHLIGHTLY_API_KEY"], message: "required when FEED_PROVIDER=highlightly" });
  if (e.FEED_PROVIDER === "sportmonks-file" && !e.FEED_FILE) ctx.addIssue({ code: "custom", path: ["FEED_FILE"], message: "required when FEED_PROVIDER=sportmonks-file" });
}).safeParse(process.env);
if (!env.success) {
  process.stderr.write(`Invalid environment: ${env.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}\n`);
  process.exit(1);
}
const cfg = env.data;
const log = pino({ level: cfg.LOG_LEVEL, redact: ["token", "url", "key", "headers"] });
const { db, client } = createDb(cfg.DATABASE_URL, { max: 3 });
const redis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => log.warn({ err: err.message }, "redis error"));

const provider: FeedProvider | null =
  cfg.FEED_PROVIDER === "sportmonks" ? createSportmonksProvider(cfg.SPORTMONKS_API_TOKEN!)
  : cfg.FEED_PROVIDER === "sportmonks-file" ? createSportmonksFileProvider(cfg.FEED_FILE!)
  : null;

const youtube = cfg.YOUTUBE_API_KEY ? createYouTubeApi(cfg.YOUTUBE_API_KEY, redis, cfg.YOUTUBE_DAILY_UNITS) : null;
let youtubePausedUntil = 0;

/** Discovery via the free channel feeds, then (with an API key) back-catalogue import and statistics refresh. */
async function videoRound() {
  await syncChannels(db, log, fetch, youtube && Date.now() > youtubePausedUntil ? youtube : null);
  if (!youtube || Date.now() < youtubePausedUntil) return;
  try {
    // Spread the daily budget over the day's rounds; the back catalogue gets whatever the refresh doesn't need.
    const rounds = Math.max(1, Math.floor(1440 / Math.max(1, cfg.YOUTUBE_POLL_MINUTES)));
    const perRound = Math.max(10, Math.floor(cfg.YOUTUBE_DAILY_UNITS / rounds));
    const r = await apiRound(db, youtube, log, (t, d) => findMatchForTitle(db, t, d), { maxBackfillPages: Math.floor(perRound / 2), maxRefreshCalls: Math.ceil(perRound / 2) });
    if (r.pages || r.refreshed || r.removed) log.info({ ...r, unitsLeftToday: await youtube.remaining() }, "youtube api round");
  } catch (err) {
    if (err instanceof YouTubeApiError && (err.status === 403 || err.status === 429)) youtubePausedUntil = Date.now() + 3600_000; // quota/key problem: retry in an hour
    log.warn({ err: (err as Error).message }, "youtube api round failed");
  }
}

const highlightly = cfg.FEED_PROVIDER === "highlightly"
  ? createHighlightlyRunner({
    db, redis, log, client: createHighlightlyClient(cfg.HIGHLIGHTLY_API_KEY!), autoCreate: cfg.FEED_AUTO_CREATE,
    dailyRequests: cfg.HIGHLIGHTLY_DAILY_REQUESTS, minListSeconds: cfg.HIGHLIGHTLY_MIN_LIST_SECONDS,
    onChange: (slug) => revalidate([`/match/${slug}`, `/match/${slug}/scorecard`, "/", "/schedule"]),
  })
  : null;
let hlBackoffUntil = 0;
async function pollHighlightly() {
  if (!highlightly || Date.now() < hlBackoffUntil) return;
  try {
    const r = await highlightly();
    if ("lists" in r && (r.lists || r.details)) log.info(r, "highlightly round");
    await heartbeat({ ok: true, provider: "highlightly", ...r });
  } catch (err) {
    const wait = err instanceof FeedError ? (err.retryAfterSeconds ?? (err.status === 429 ? 900 : 60)) : 60;
    hlBackoffUntil = Date.now() + wait * 1000;
    log.warn({ err: (err as Error).message, retryInSeconds: wait }, "highlightly round failed");
    await heartbeat({ ok: false, provider: "highlightly", error: (err as Error).message, retryInSeconds: wait });
  }
}

/* ───────────── Leader election: only one replica polls ───────────── */
const LOCK = "feed:leader", me = randomUUID(), LOCK_MS = 30_000;
async function holdLock(): Promise<boolean> {
  // Renew if we hold it, otherwise try to take it. Lua keeps check-and-extend atomic.
  const res = await redis.eval(
    `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return redis.call("set", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) and 1 or 0 end`,
    1, LOCK, me, String(LOCK_MS),
  ).catch(() => 0);
  return res === 1;
}

/** Status shown in admin (never contains secrets). */
async function heartbeat(state: Record<string, unknown>) {
  await redis.set("feed:status", JSON.stringify({ at: new Date().toISOString(), provider: provider?.name ?? "none", ...state }), "EX", 600).catch(() => undefined);
}

function revalidate(paths: string[]) {
  if (!cfg.WEB_INTERNAL_URL || !cfg.REVALIDATE_SECRET || !paths.length) return;
  void fetch(`${cfg.WEB_INTERNAL_URL}/internal/revalidate`, {
    method: "POST", headers: { "content-type": "application/json", "x-revalidate-secret": cfg.REVALIDATE_SECRET },
    body: JSON.stringify({ paths }), signal: AbortSignal.timeout(2000),
  }).catch(() => undefined);
}

/* ───────────── Live-score loop ───────────── */
let backoffUntil = 0, lastOpenCheck = 0, lastError: string | null = null;
const lastWarnings = new Map<string, string[]>();

async function pollFeed() {
  if (!provider || Date.now() < backoffUntil) return;
  const started = Date.now();
  try {
    const fixtures = await provider.liveFixtures();
    const seen = new Set(fixtures.map((f) => f.extId));
    // Linked matches that dropped off the live list (finished, or not started yet): check each once a minute.
    if (Date.now() - lastOpenCheck > 60_000) {
      lastOpenCheck = Date.now();
      for (const m of await openFeedMatches(db, provider.name)) {
        if (m.feedMatchId && !seen.has(m.feedMatchId)) {
          const f = await provider.fixture(m.feedMatchId);
          if (f) fixtures.push(f);
        }
      }
    }
    let changed = 0;
    for (const f of fixtures) changed += await syncOne(f);
    lastError = null;
    await heartbeat({ ok: true, live: fixtures.length, changed, ms: Date.now() - started, warnings: Object.fromEntries(lastWarnings) });
  } catch (err) {
    // 429 (plan quota) or provider outage: back off; the site keeps serving the last snapshot meanwhile.
    const wait = err instanceof FeedError ? (err.retryAfterSeconds ?? (err.status === 429 ? 60 : 15)) : 15;
    backoffUntil = Date.now() + wait * 1000;
    lastError = (err as Error).message;
    log.warn({ err: lastError, retryInSeconds: wait }, "feed poll failed");
    await heartbeat({ ok: false, error: lastError, retryInSeconds: wait });
  }
}

async function syncOne(f: FeedFixture): Promise<number> {
  try {
    const r = await syncFixture(db, redis, f, { autoCreate: cfg.FEED_AUTO_CREATE });
    if (f.warnings.length) lastWarnings.set(f.extId, [...new Set(f.warnings)].slice(0, 10)); else lastWarnings.delete(f.extId);
    if (r.changed && r.slug) {
      log.info({ match: r.slug, balls: r.ballsWritten, rebuilt: r.rebuiltInnings }, "feed synced");
      revalidate([`/match/${r.slug}`, `/match/${r.slug}/scorecard`, `/match/${r.slug}/commentary`, "/"]);
      return 1;
    }
  } catch (err) {
    log.error({ fixture: f.extId, err: (err as Error).message }, "feed sync failed for fixture");
  }
  return 0;
}

/* ───────────── Main loop ───────────── */
let stopping = false, lastVideos = 0, lastNews = 0, lastStreams = 0;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { stopping = true; });
log.info({ provider: provider?.name ?? "none", pollSeconds: cfg.FEED_POLL_SECONDS, youtubeMinutes: cfg.YOUTUBE_POLL_MINUTES }, "feed worker started");

while (!stopping) {
  if (await holdLock()) {
    await pollFeed();
    await pollHighlightly();
    if (cfg.YOUTUBE_POLL_MINUTES > 0 && Date.now() - lastVideos > cfg.YOUTUBE_POLL_MINUTES * 60_000) {
      lastVideos = Date.now();
      await videoRound().catch((err: Error) => log.warn({ err: err.message }, "youtube sync failed"));
    }
    if (cfg.NEWSROOM_SECONDS > 0 && Date.now() - lastNews > cfg.NEWSROOM_SECONDS * 1000) {
      lastNews = Date.now();
      try {
        const slugs = await newsroomRound(db, redis);
        if (slugs.length) { log.info({ stories: slugs }, "newsroom published"); revalidate(["/news", "/news/[slug]", "/news/tag/[tag]", "/sitemap.xml"]); }
      } catch (err) { log.warn({ err: (err as Error).message }, "newsroom round failed"); }
    }
    if (cfg.STREAM_CHECK_SECONDS > 0 && Date.now() - lastStreams > cfg.STREAM_CHECK_SECONDS * 1000) {
      lastStreams = Date.now();
      try {
        const r = await streamsRound(db, streamConfig({ STREAM_HLS_HOSTS: cfg.STREAM_HLS_HOSTS, STREAM_EMBED_HOSTS: cfg.STREAM_EMBED_HOSTS, STREAM_TOKEN_PARAM: cfg.STREAM_TOKEN_PARAM, YOUTUBE_API_KEY: cfg.YOUTUBE_API_KEY } as Parameters<typeof streamConfig>[0]), fetch, { minAgeMs: cfg.STREAM_CHECK_SECONDS * 800 });
        if (r.changedSlugs.length) { log.info({ matches: r.changedSlugs.length }, "stream status changed"); revalidate(r.changedSlugs.map((x) => `/match/${x}/watch`)); }
      } catch (err) { log.warn({ err: (err as Error).message }, "stream check round failed"); }
    }
    if (!provider && !highlightly) await heartbeat({ ok: true, live: 0 });
  }
  await new Promise((r) => setTimeout(r, cfg.FEED_POLL_SECONDS * 1000));
}
await redis.eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`, 1, LOCK, me).catch(() => undefined);
await Promise.allSettled([client.end({ timeout: 5 }), redis.quit()]);
log.info("feed worker stopped");

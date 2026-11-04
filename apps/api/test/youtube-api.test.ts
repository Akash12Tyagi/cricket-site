import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { eq, inArray } from "drizzle-orm";
import { createDb, videoChannels, videos } from "@cricket/db";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";
import { apiRound, createYouTubeApi, parseDuration, toApiVideo, YouTubeApiError, type ApiVideo, type YouTubeApi } from "../src/feed/youtube-api.js";

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL, { max: 2 });
const appRedis = new Redis(env.REDIS_URL);
const app = await buildApp({ env, db, redis: appRedis, mailer: { sendLoginCode: async () => {} }, logger: false });

describe("YouTube API mapping", () => {
  it("parses ISO-8601 durations", () => {
    expect(parseDuration("PT45S")).toBe(45);
    expect(parseDuration("PT1H2M3S")).toBe(3723);
    expect(parseDuration("P1DT1M")).toBe(86460);
    expect(parseDuration("garbage")).toBeNull();
  });
  it("maps a videos.list item, gating embedding on owner settings and public status", () => {
    const base = { id: "dQw4w9WgXcQ", snippet: { title: "Final highlights", channelId: "UCt2JXOLNxqry7B_4rRZME3Q", channelTitle: "ICC", publishedAt: "2026-10-01T00:00:00Z", liveBroadcastContent: "none" },
      statistics: { viewCount: "12345678" }, status: { embeddable: true, privacyStatus: "public", uploadStatus: "processed" }, contentDetails: { duration: "PT10M" } };
    expect(toApiVideo(base)).toMatchObject({ viewCount: 12345678, durationSeconds: 600, embeddable: true, isShort: false, isLive: false });
    expect(toApiVideo({ ...base, status: { ...base.status, embeddable: false } }).embeddable).toBe(false);
    expect(toApiVideo({ ...base, status: { ...base.status, privacyStatus: "unlisted" } }).embeddable).toBe(false);
    expect(toApiVideo({ ...base, contentDetails: { duration: "PT30S" } }).isShort).toBe(true);
    expect(toApiVideo({ ...base, snippet: { ...base.snippet, title: "Catch of the year #shorts" }, contentDetails: { duration: "PT2M" } }).isShort).toBe(true);
    expect(toApiVideo({ ...base, snippet: { ...base.snippet, liveBroadcastContent: "live" } }).isLive).toBe(true);
  });
});

describe("YouTube API client", () => {
  it("counts quota in Redis, stops at the local daily budget and never puts the key in errors", async () => {
    const redis = new Redis(env.REDIS_URL);
    const day = `yt:quota:${new Date().toISOString().slice(0, 10)}`;
    const before = Number((await redis.get(day)) ?? 0);
    const urls: string[] = [];
    const fake = (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 }); }) as unknown as typeof fetch;
    const api = createYouTubeApi("SECRET_KEY_123456789012345", redis, before + 1, fake);
    const err = await api.uploadsPlaylist("UCt2JXOLNxqry7B_4rRZME3Q").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect((err as Error).message).toBe("youtube api HTTP 403 (quotaExceeded)");
    expect((err as Error).message).not.toContain("SECRET");
    expect(urls[0]).toContain("key=SECRET");
    // Budget now used up: the next call is refused locally without touching the network.
    expect(await api.uploadsPlaylist("UCt2JXOLNxqry7B_4rRZME3Q").catch((e: YouTubeApiError) => e.reason)).toBe("local_daily_budget");
    expect(urls).toHaveLength(1);
    await redis.decr(day); await redis.quit();
  });
});

describe("back catalogue import, refresh and policy clean-up", () => {
  const tag = randomUUID().replace(/-/g, "").slice(0, 8);
  const channelId = `UC${tag}${"x".repeat(14)}`;
  const id = (n: number) => `${tag}${String(n).padStart(3, "0")}`; // 11 chars
  const make = (n: number, views: number, days = 100): ApiVideo => ({
    youtubeId: id(n), title: `Video ${n} ${tag}`, channelId, channelName: "Test Board", publishedAt: new Date(Date.now() - days * 86_400_000),
    viewCount: views, durationSeconds: 300, embeddable: true, isLive: false, isShort: false,
  });
  // A fake channel with 120 uploads over 3 pages; video 5 is later removed from YouTube.
  const catalogue = new Map(Array.from({ length: 120 }, (_, k) => [id(k), make(k, 1000 * (k + 1), k === 0 ? 1 : 100)]));
  let calls = 0;
  const fakeApi = {
    remaining: async () => 1000,
    uploadsPlaylist: async (c: string) => { calls++; return c === channelId ? `UU${tag}` : null; },
    playlistPage: async (_p: string, token?: string | null) => {
      calls++;
      const start = Number(token ?? 0), ids = [...catalogue.keys()].slice(start, start + 50);
      return { ids, next: start + 50 < catalogue.size ? String(start + 50) : null };
    },
    details: async (ids: string[]) => { calls++; return ids.map((i) => catalogue.get(i)).filter((v): v is ApiVideo => !!v); },
  } as unknown as YouTubeApi;
  const log = { info: () => {}, warn: () => {} };
  const noLink = async () => null;
  const opts = { maxBackfillPages: 2, maxRefreshCalls: 5, channelIds: [channelId] };

  afterAll(async () => {
    await db.delete(videos).where(eq(videos.channelId, channelId));
    await db.delete(videoChannels).where(eq(videoChannels.channelId, channelId));
    await app.close(); await client.end(); await appRedis.quit();
  });

  it("imports the back catalogue across rounds, resuming where it stopped", async () => {
    await db.insert(videoChannels).values({ channelId, name: "Test Board" });
    const r1 = await apiRound(db, fakeApi, log, noLink, opts);
    expect(r1.pages).toBe(2);
    expect((await db.select().from(videoChannels).where(eq(videoChannels.channelId, channelId)))[0]).toMatchObject({ backfillDone: false, backfillPageToken: "100" });
    const r2 = await apiRound(db, fakeApi, log, noLink, opts);
    expect(r2.pages).toBe(1);
    const rows = await db.select().from(videos).where(eq(videos.channelId, channelId));
    expect(rows).toHaveLength(120);
    expect((await db.select().from(videoChannels).where(eq(videoChannels.channelId, channelId)))[0]!.backfillDone).toBe(true);
    const before = calls;
    await apiRound(db, fakeApi, log, noLink, opts);
    expect(calls).toBe(before); // finished and fresh: no quota spent
  });

  it("serves most viewed, this week and latest with unlimited cursor paging", async () => {
    const popular = (await app.inject(`/v1/videos?sort=popular&channel=${channelId}&limit=48`)).json();
    expect(popular.videos[0].youtubeId).toBe(id(119));
    expect(popular.videos[0].viewCount).toBe(120000);
    let seen = popular.videos.length, next = popular.next;
    while (next) {
      const page = (await app.inject(`/v1/videos?sort=popular&channel=${channelId}&limit=48&cursor=${next}`)).json();
      seen += page.videos.length; next = page.next;
    }
    expect(seen).toBe(120);
    const week = (await app.inject(`/v1/videos?sort=week&channel=${channelId}`)).json();
    expect(week.videos.map((v: { youtubeId: string }) => v.youtubeId)).toEqual([id(0)]);
    expect((await app.inject("/v1/videos?cursor=not-a-cursor")).statusCode).toBe(200);
  });

  it("refreshes due statistics, deletes videos gone from YouTube, clears stats older than 30 days", async () => {
    await db.update(videos).set({ statsFetchedAt: new Date(Date.now() - 21 * 86_400_000) }).where(inArray(videos.youtubeId, [id(5), id(6)]));
    catalogue.delete(id(5));
    catalogue.set(id(6), make(6, 999_999));
    const r = await apiRound(db, fakeApi, log, noLink, opts);
    expect(r.removed).toBe(1);
    expect(await db.select().from(videos).where(eq(videos.youtubeId, id(5)))).toHaveLength(0);
    expect((await db.select().from(videos).where(eq(videos.youtubeId, id(6))))[0]!.viewCount).toBe(999_999);
    // Simulate a refresh that couldn't run for 31 days (e.g. no quota): the stored count must not be shown any more.
    await db.update(videos).set({ statsFetchedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(videos.youtubeId, id(7)));
    await apiRound(db, fakeApi, log, noLink, { ...opts, maxRefreshCalls: 0 });
    expect((await db.select().from(videos).where(eq(videos.youtubeId, id(7))))[0]!.viewCount).toBeNull();
  });
});

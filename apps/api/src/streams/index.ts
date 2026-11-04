import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { matches, streamSources, type Database } from "@cricket/db";
import type { Env } from "../env.js";
import { embedProvider } from "./embed.js";
import { hlsProvider, withToken } from "./hls.js";
import { parseHosts, type PublicStream, type StreamConfig, type StreamKind, type StreamProvider, type StreamStatus } from "./types.js";
import { youtubeProvider } from "./youtube.js";
import { youtubeIdFromUrl } from "../feed/youtube.js";

export * from "./types.js";
export { youtubeUrl } from "./youtube.js";

/** The registry: to add a provider, implement StreamProvider and add it here. */
export const PROVIDERS: Record<StreamKind, StreamProvider> = { youtube: youtubeProvider, hls: hlsProvider, embed: embedProvider };

export const streamConfig = (env: Env, secrets: Record<string, string | undefined> = process.env): StreamConfig => ({
  hlsHosts: parseHosts(env.STREAM_HLS_HOSTS), embedHosts: parseHosts(env.STREAM_EMBED_HOSTS), tokenParam: env.STREAM_TOKEN_PARAM,
  youtubeApiKey: env.YOUTUBE_API_KEY, secrets,
});

export const TOKEN_ENV = /^STREAM_TOKEN_[A-Z0-9_]{1,30}$/;
type Row = typeof streamSources.$inferSelect;

/** Verdict order shown to viewers: proven-live first, never an offline stream ahead of a working one. */
const RANK: Record<string, number> = { live: 0, unknown: 1, pending: 1, vod: 2, error: 3, offline: 4 };
export const rankOf = (s: string | null) => RANK[s ?? "pending"] ?? 3;

/** Row → what the browser gets. Rights notes, token variable names and tokens never leave the server. */
export function toPublic(r: Row): PublicStream {
  const base: PublicStream = { id: r.id, kind: r.kind as StreamKind, label: r.label, region: r.region, status: (r.lastStatus as StreamStatus | null) ?? "pending", checkedAt: r.lastCheckedAt?.toISOString() ?? null };
  if (r.kind === "youtube") return { ...base, youtubeId: youtubeIdFromUrl(r.url) ?? undefined };
  if (r.kind === "hls" && r.authEnv) return { ...base, needsToken: true };
  return { ...base, url: r.url };
}

/** Runs the provider's check and stores the verdict. Returns whether the verdict changed (so pages can refresh). */
export async function verifyAndStore(db: Database, src: Row, cfg: StreamConfig, fetchImpl: typeof fetch = fetch) {
  let result;
  try { result = await PROVIDERS[src.kind as StreamKind].verify({ url: src.url, authEnv: src.authEnv, checkState: src.checkState, lastCheckedAt: src.lastCheckedAt }, cfg, fetchImpl); }
  catch { result = { status: "error" as const, detail: "check failed unexpectedly" }; }
  await db.update(streamSources).set({ lastCheckedAt: new Date(), lastStatus: result.status, lastDetail: result.detail.slice(0, 160), checkState: result.state ?? src.checkState ?? null }).where(eq(streamSources.id, src.id));
  return { ...result, changed: src.lastStatus !== result.status };
}

/** The playable URL for a source that needs a server-side token (only HLS). Null if it can't be produced. */
export const playbackUrl = (r: Row, cfg: StreamConfig) => (r.kind === "hls" ? withToken(r.url, r.authEnv, cfg) : null);

/**
 * One worker round: re-verify enabled sources whose match is live, starting within 3 h, or finished within the last
 * hour (and any source never checked). Returns the match slugs whose verdict changed.
 */
export async function streamsRound(db: Database, cfg: StreamConfig, fetchImpl: typeof fetch = fetch, opts: { minAgeMs?: number; sourceIds?: string[] } = {}) {
  const minAge = opts.minAgeMs ?? 45_000;
  const rows = await db.select({ s: streamSources, slug: matches.slug, mStatus: matches.status, startsAt: matches.startsAt })
    .from(streamSources).leftJoin(matches, or(eq(matches.id, streamSources.matchId), and(sql`${streamSources.seriesId} is not null`, eq(matches.seriesId, streamSources.seriesId))))
    .where(and(eq(streamSources.enabled, true), opts.sourceIds ? inArray(streamSources.id, opts.sourceIds) : undefined,
      or(sql`${streamSources.lastCheckedAt} is null`, sql`${matches.status} in ('TOSS','LIVE','INNINGS_BREAK','STUMPS','DELAYED')`,
        sql`(${matches.status} = 'SCHEDULED' and ${matches.startsAt} < now() + interval '3 hours')`, sql`(${matches.status} = 'COMPLETED' and ${matches.startsAt} > now() - interval '1 hour')`)))
    .orderBy(asc(streamSources.lastCheckedAt));
  // A series-level source shows up once per match in the series: check it once, then refresh every one of those pages.
  const bySource = new Map<string, { s: Row; slugs: string[] }>();
  for (const { s, slug } of rows) { const e = bySource.get(s.id) ?? { s, slugs: [] }; if (slug) e.slugs.push(slug); bySource.set(s.id, e); }
  const changedSlugs = new Set<string>();
  for (const { s, slugs } of bySource.values()) {
    if (s.lastCheckedAt && Date.now() - s.lastCheckedAt.getTime() < minAge) continue;
    const r = await verifyAndStore(db, s, cfg, fetchImpl);
    if (r.changed) slugs.forEach((x) => changedSlugs.add(x));
  }
  return { checked: bySource.size, changedSlugs: [...changedSlugs] };
}

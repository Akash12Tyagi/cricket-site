import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { videoChannels, videos, type Database } from "@cricket/db";

/**
 * YouTube Data API v3 (free: a Google Cloud API key, no billing; 10,000 quota units/day by default).
 * Used for what the public channel feed can't give: a channel's whole back catalogue, view counts and the
 * owner's embedding setting. Every call here costs 1 unit (channels/playlistItems/videos.list); search (100 units)
 * is never used. Quota spent is counted in Redis so the worker stays inside YOUTUBE_DAILY_UNITS.
 *
 * YouTube API Services Developer Policies we follow (III.E.4): statistics are refreshed and never kept more than
 * 30 days (cleared otherwise); view counts shown are YouTube's own numbers; unavailable videos are deleted.
 */
const BASE = "https://www.googleapis.com/youtube/v3";

export class YouTubeApiError extends Error {
  constructor(readonly status: number, readonly reason: string | null) { super(`youtube api HTTP ${status}${reason ? ` (${reason})` : ""}`); this.name = "YouTubeApiError"; }
}

export type ApiVideo = {
  youtubeId: string; title: string; channelId: string; channelName: string; publishedAt: Date;
  viewCount: number | null; durationSeconds: number | null; embeddable: boolean; isLive: boolean; isShort: boolean;
};

/** ISO-8601 duration ("PT1H2M3S", "P1DT2H") → seconds. */
export function parseDuration(iso: string | undefined): number | null {
  const m = iso ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso) : null;
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

type ApiItem = {
  id: string;
  snippet?: { title?: string; description?: string; channelId?: string; channelTitle?: string; publishedAt?: string; liveBroadcastContent?: string };
  statistics?: { viewCount?: string };
  status?: { embeddable?: boolean; privacyStatus?: string; uploadStatus?: string };
  contentDetails?: { duration?: string };
};

/** One videos.list item → our shape. Pure; unit-tested. */
export function toApiVideo(v: ApiItem): ApiVideo {
  const s = v.snippet ?? {};
  const duration = parseDuration(v.contentDetails?.duration);
  const text = `${s.title ?? ""} ${s.description ?? ""}`;
  return {
    youtubeId: v.id, title: (s.title ?? "Video").slice(0, 200), channelId: s.channelId ?? "", channelName: (s.channelTitle ?? "").slice(0, 80),
    publishedAt: new Date(s.publishedAt ?? Date.now()),
    viewCount: v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null,
    durationSeconds: duration,
    // Shown in our player only if public, fully processed and the owner allows embedding.
    embeddable: v.status?.embeddable === true && v.status.privacyStatus === "public" && (v.status.uploadStatus ?? "processed") === "processed",
    isLive: s.liveBroadcastContent === "live",
    isShort: duration != null && (duration <= 60 || (duration <= 180 && /#shorts?\b/i.test(text))),
  };
}

export function createYouTubeApi(key: string, redis: Redis, dailyUnits: number, fetchImpl: typeof fetch = fetch) {
  const quotaKey = () => `yt:quota:${new Date().toISOString().slice(0, 10)}`;
  const spent = async () => Number((await redis.get(quotaKey()).catch(() => null)) ?? 0);
  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    if ((await spent()) >= dailyUnits) throw new YouTubeApiError(429, "local_daily_budget");
    await redis.multi().incr(quotaKey()).expire(quotaKey(), 2 * 86400).exec().catch(() => undefined);
    const res = await fetchImpl(`${BASE}${path}?${new URLSearchParams({ ...params, key })}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null;
      throw new YouTubeApiError(res.status, body?.error?.errors?.[0]?.reason ?? null); // never includes the URL (it carries the key)
    }
    return (await res.json()) as T;
  }
  return {
    remaining: async () => Math.max(0, dailyUnits - (await spent())),
    async uploadsPlaylist(channelId: string) {
      const r = await get<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>("/channels", { part: "contentDetails", id: channelId });
      return r.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
    },
    async playlistPage(playlistId: string, pageToken?: string | null) {
      const r = await get<{ items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string }>("/playlistItems", {
        part: "contentDetails", playlistId, maxResults: "50", ...(pageToken ? { pageToken } : {}),
      });
      return { ids: (r.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => !!x), next: r.nextPageToken ?? null };
    },
    /** Up to 50 ids per call. Videos missing from the answer are deleted/private on YouTube. */
    async details(ids: string[]): Promise<ApiVideo[]> {
      if (!ids.length) return [];
      const r = await get<{ items?: ApiItem[] }>("/videos", { part: "snippet,statistics,status,contentDetails", id: ids.join(","), maxResults: "50" });
      return (r.items ?? []).map(toApiVideo);
    },
  };
}
export type YouTubeApi = ReturnType<typeof createYouTubeApi>;

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
type Linker = (title: string, publishedAt: Date) => Promise<{ id: string; seriesId: string | null } | null>;

/** Inserts/updates API videos; new ones are linked to a match when the title names both teams. */
export async function upsertApiVideos(db: Database, list: ApiVideo[], channelNames: Map<string, string>, link: Linker) {
  const now = new Date();
  for (const v of list) {
    const stats = { viewCount: v.viewCount, durationSeconds: v.durationSeconds, statsFetchedAt: now, embeddable: v.embeddable, isLive: v.isLive, isShort: v.isShort, title: v.title };
    const [exists] = await db.select({ id: videos.id }).from(videos).where(eq(videos.youtubeId, v.youtubeId)).limit(1);
    if (exists) { await db.update(videos).set(stats).where(eq(videos.id, exists.id)); continue; }
    const match = await link(v.title, v.publishedAt);
    await db.insert(videos).values({
      ...stats, youtubeId: v.youtubeId, channelId: v.channelId, channelName: channelNames.get(v.channelId) ?? v.channelName, publishedAt: v.publishedAt,
      matchId: match?.id ?? null, seriesId: match?.seriesId ?? null,
    }).onConflictDoNothing();
  }
}

/**
 * One round of API work, within the remaining quota:
 * 1. back-catalogue import (oldest pages last) for channels not finished yet;
 * 2. statistics refresh: videos from the last 7 days every 6 h (so "this week" stays current), others every 20 days;
 * 3. policy clean-up: statistics older than 30 days are cleared; videos gone from YouTube are deleted.
 */
export async function apiRound(db: Database, api: YouTubeApi, log: Log, link: Linker, opts: { maxBackfillPages: number; maxRefreshCalls: number; channelIds?: string[] }) {
  const scope = opts.channelIds ? inArray(videos.channelId, opts.channelIds) : undefined;
  const channels = await db.select().from(videoChannels)
    .where(and(eq(videoChannels.enabled, true), opts.channelIds ? inArray(videoChannels.channelId, opts.channelIds) : undefined));
  const names = new Map(channels.map((c) => [c.channelId, c.name]));
  let pages = 0, refreshed = 0, removed = 0;

  for (const ch of channels) {
    if (ch.backfillDone) continue;
    let playlist = ch.uploadsPlaylistId, token = ch.backfillPageToken;
    if (!playlist) {
      playlist = await api.uploadsPlaylist(ch.channelId);
      if (!playlist) { log.warn({ channel: ch.name }, "youtube channel not found"); continue; }
      await db.update(videoChannels).set({ uploadsPlaylistId: playlist }).where(eq(videoChannels.channelId, ch.channelId));
    }
    while (pages < opts.maxBackfillPages) {
      const page = await api.playlistPage(playlist, token);
      pages++;
      const known = page.ids.length ? new Set((await db.select({ y: videos.youtubeId }).from(videos).where(and(inArray(videos.youtubeId, page.ids), sql`${videos.statsFetchedAt} is not null`))).map((r) => r.y)) : new Set<string>();
      await upsertApiVideos(db, await api.details(page.ids.filter((id) => !known.has(id))), names, link);
      token = page.next;
      await db.update(videoChannels).set({ backfillPageToken: token, backfillDone: !token }).where(eq(videoChannels.channelId, ch.channelId));
      if (!token) { log.info({ channel: ch.name }, "youtube back catalogue imported"); break; }
    }
    if (pages >= opts.maxBackfillPages) break;
  }

  while (refreshed < opts.maxRefreshCalls) {
    const due = await db.select({ y: videos.youtubeId }).from(videos).where(and(scope, or(
      isNull(videos.statsFetchedAt),
      and(sql`${videos.publishedAt} > now() - interval '7 days'`, lt(videos.statsFetchedAt, sql`now() - interval '6 hours'`)),
      lt(videos.statsFetchedAt, sql`now() - interval '20 days'`),
    ))).orderBy(asc(videos.statsFetchedAt)).limit(50);
    if (!due.length) break;
    const ids = due.map((d) => d.y);
    const got = await api.details(ids);
    refreshed++;
    await upsertApiVideos(db, got, names, link);
    const gone = ids.filter((id) => !got.some((g) => g.youtubeId === id));
    if (gone.length) { await db.delete(videos).where(inArray(videos.youtubeId, gone)); removed += gone.length; }
  }

  // Never keep statistics older than 30 days (YouTube API policy III.E.4.b).
  await db.update(videos).set({ viewCount: null }).where(and(scope, sql`${videos.viewCount} is not null`, lt(videos.statsFetchedAt, sql`now() - interval '30 days'`)));
  return { pages, refreshed, removed };
}

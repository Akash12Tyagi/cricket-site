import { and, between, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { matches, teams, videoChannels, videos, type Database } from "@cricket/db";
import { upsertApiVideos, type YouTubeApi } from "./youtube-api.js";

/**
 * Official highlights via YouTube. We only list uploads from an allow-list of official channels (ICC, boards),
 * read from YouTube's public channel feed (no API key), and only show a video in our player if YouTube's oEmbed
 * endpoint says the owner allows embedding. Playback happens in YouTube's own player, so views, ads and rights
 * stay with the owner. Nothing is downloaded or re-hosted.
 */
const UA = "CricketLive/0.1 (official highlights listing)";
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export type FeedEntry = { youtubeId: string; title: string; publishedAt: Date; channelId: string; channelName: string; isShort: boolean; isLive: boolean };

const decode = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml); return m ? decode(m[1]!.trim()) : null; };

/** Parses YouTube's Atom channel feed. Pure; tolerant of missing fields (bad entries are skipped). */
export function parseChannelFeed(xml: string): FeedEntry[] {
  const channelName = tag(xml.split("<entry>")[0] ?? "", "title") ?? "";
  const out: FeedEntry[] = [];
  for (const chunk of xml.split("<entry>").slice(1)) {
    const youtubeId = tag(chunk, "yt:videoId"), channelId = tag(chunk, "yt:channelId"), title = tag(chunk, "title"), published = tag(chunk, "published");
    if (!youtubeId || !YOUTUBE_ID.test(youtubeId) || !channelId || !title || !published || Number.isNaN(Date.parse(published))) continue;
    const link = /<link rel="alternate" href="([^"]+)"/.exec(chunk)?.[1] ?? "";
    out.push({
      youtubeId, channelId, channelName, title: title.slice(0, 200), publishedAt: new Date(published),
      isShort: link.includes("/shorts/"), isLive: /(^|\W)LIVE(\W|$)/.test(title),
    });
  }
  return out;
}

/** Accepts a YouTube URL (watch, youtu.be, shorts, live, embed) or a bare id; returns the 11-char id or null. */
export function youtubeIdFromUrl(input: string): string | null {
  const s = input.trim();
  if (YOUTUBE_ID.test(s)) return s;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v") ?? /^\/(?:shorts|live|embed)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** YouTube oEmbed: 200 = embeddable (+ title/channel); 401/403/404 = not embeddable or gone; otherwise unknown (null). */
export async function checkEmbeddable(youtubeId: string, fetchImpl: typeof fetch = fetch): Promise<{ embeddable: boolean; title?: string; channelName?: string } | null> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${youtubeId}`)}`;
  try {
    const r = await fetchImpl(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
    if (r.ok) { const j = (await r.json()) as { title?: string; author_name?: string }; return { embeddable: true, title: j.title, channelName: j.author_name }; }
    if ([400, 401, 403, 404].includes(r.status)) return { embeddable: false };
    return null;
  } catch { return null; }
}

/**
 * Links a video to the match it is about: both team names appear in the title and the match started between
 * 4 days before and 1 day after upload. Only an unambiguous single match is linked; editors can fix links in admin.
 */
export async function findMatchForTitle(db: Database, title: string, publishedAt: Date) {
  const t1 = alias(teams, "t1"), t2 = alias(teams, "t2");
  const lower = title.toLowerCase();
  const women = /\bwomen|\bwomen's/i.test(title);
  const rows = await db.select({ id: matches.id, seriesId: matches.seriesId, n1: t1.name, n2: t2.name, k1: t1.kind })
    .from(matches).innerJoin(t1, eq(t1.id, matches.team1Id)).innerJoin(t2, eq(t2.id, matches.team2Id))
    .where(and(
      between(matches.startsAt, new Date(publishedAt.getTime() - 4 * 86_400_000), new Date(publishedAt.getTime() + 86_400_000)),
      sql`position(lower(${t1.name}) in ${lower}) > 0`, sql`position(lower(${t2.name}) in ${lower}) > 0`,
    )).limit(5);
  const fit = rows.filter((r) => (r.k1 === "INTERNATIONAL_WOMEN") === women);
  return fit.length === 1 ? fit[0]! : null;
}

/**
 * Fetches every enabled channel's public feed once (free, no quota) to discover new uploads. With a YouTube Data API
 * key, new videos get their details (views, duration, embedding setting) from the API; without one, embedding is
 * checked with oEmbed.
 */
export async function syncChannels(db: Database, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }, fetchImpl: typeof fetch = fetch, api: YouTubeApi | null = null) {
  const channels = await db.select().from(videoChannels).where(eq(videoChannels.enabled, true));
  const names = new Map(channels.map((c) => [c.channelId, c.name]));
  let added = 0;
  for (const ch of channels) {
    try {
      const r = await fetchImpl(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) { log.warn({ channel: ch.name, status: r.status }, "youtube feed failed"); continue; }
      const entries = parseChannelFeed(await r.text());
      const ids = entries.map((e) => e.youtubeId);
      const known = ids.length ? new Set((await db.select({ y: videos.youtubeId }).from(videos).where(inArray(videos.youtubeId, ids))).map((x) => x.y)) : new Set<string>();
      const fresh = entries.filter((e) => !known.has(e.youtubeId));
      if (api && fresh.length) {
        await upsertApiVideos(db, await api.details(fresh.map((e) => e.youtubeId)), names, (t, d) => findMatchForTitle(db, t, d));
        added += fresh.length;
      } else {
        for (const e of fresh) {
          const check = await checkEmbeddable(e.youtubeId, fetchImpl);
          if (check === null) continue; // YouTube unsure right now: retry next round rather than store a wrong flag
          const match = await findMatchForTitle(db, e.title, e.publishedAt);
          await db.insert(videos).values({
            youtubeId: e.youtubeId, title: e.title, channelId: e.channelId, channelName: ch.name, publishedAt: e.publishedAt,
            isShort: e.isShort, isLive: e.isLive, embeddable: check.embeddable, matchId: match?.id ?? null, seriesId: match?.seriesId ?? null,
          }).onConflictDoNothing();
          added++;
        }
      }
      await db.update(videoChannels).set({ lastFetchedAt: new Date() }).where(eq(videoChannels.channelId, ch.channelId));
    } catch (err) {
      log.warn({ channel: ch.name, err: (err as Error).message }, "youtube feed error");
    }
  }
  // Re-try linking recent unlinked videos: the match row may have been created after the upload was first seen.
  const recent = await db.select({ id: videos.id, title: videos.title, publishedAt: videos.publishedAt }).from(videos)
    .where(and(isNull(videos.matchId), eq(videos.source, "channel"), sql`${videos.publishedAt} > now() - interval '3 days'`)).limit(200);
  for (const v of recent) {
    const match = await findMatchForTitle(db, v.title, v.publishedAt);
    if (match) await db.update(videos).set({ matchId: match.id, seriesId: match.seriesId }).where(eq(videos.id, v.id));
  }
  if (added) log.info({ added }, "youtube videos added");
  return added;
}

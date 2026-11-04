import "server-only";
import type { LiveSnapshot } from "@cricket/shared";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

export type MatchSummary = {
  id: string; slug: string; title: string; format: string; status: string; startsAt: string;
  resultText: string | null;
  team1: { id: string; name: string; shortName: string };
  team2: { id: string; name: string; shortName: string };
  venue: { name: string; city: string | null } | null;
  series?: { name: string; slug: string } | null;
  oversPerInnings?: number | null;
  innings?: { number: number; battingTeamId: string; runs: number; wickets: number; legalBalls: number; target: number | null; isComplete: boolean; isDeclared: boolean }[];
};

/** Public GET with ISR caching. `null` = not found; throws UpstreamError on failure (see above). */
export function apiGet<T>(path: string, revalidate: number): Promise<T | null> {
  return getJson<T>(path, { next: { revalidate } });
}

/**
 * Thrown when the API is unreachable or failing. Deliberately NOT caught in ISR pages:
 * when a background re-render throws, Next.js keeps serving the last good page and retries later.
 * (Found by the Postgres-outage drill: returning an "unavailable" page let Next.js cache the error
 * message, so the site still looked broken after the database had recovered.)
 * A page that has never rendered successfully falls back to app/error.tsx.
 */
export class UpstreamError extends Error {
  constructor(path: string, detail: string) { super(`upstream ${path}: ${detail}`); this.name = "UpstreamError"; }
}

async function getJson<T>(path: string, init: RequestInit & { next?: { revalidate: number } }): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(3000) });
  } catch (err) {
    throw new UpstreamError(path, err instanceof Error ? err.message : "fetch failed");
  }
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new UpstreamError(path, `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function getMatches(status: "live" | "upcoming" | "recent", revalidate = 30): Promise<MatchSummary[]> {
  const d = await getJson<{ matches: MatchSummary[] }>(`/v1/matches?status=${status}`, { next: { revalidate } });
  return d?.matches ?? [];
}

/** Live snapshot by id or slug, cached for 5 s on the server. `null` = not found; throws on failure. */
export function getLive(key: string, opts: { fresh?: boolean } = {}): Promise<LiveSnapshot | null> {
  return getJson<LiveSnapshot>(`/v1/matches/${encodeURIComponent(key)}/live`, opts.fresh ? { cache: "no-store" } : { next: { revalidate: 5 } });
}

export type WatchOption = { id: string; region: string; name: string; url: string; kind: "stream" | "tv" | "radio"; note: string | null };
export type Video = {
  id: string; youtubeId: string; title: string; channelName: string | null; publishedAt: string; isShort: boolean; isLive: boolean; matchId: string | null;
  viewCount: number | null; durationSeconds: number | null; statsFetchedAt: string | null;
};
export type VideoSort = "latest" | "popular" | "week";

/** Where to watch + official videos for a match. Never throws: media is an extra, the score must still render. */
export async function getMatchMedia(slug: string): Promise<{ watch: WatchOption[]; videos: Video[] }> {
  try {
    return (await getJson<{ watch: WatchOption[]; videos: Video[] }>(`/v1/matches/${encodeURIComponent(slug)}/media`, { next: { revalidate: 60 } })) ?? { watch: [], videos: [] };
  } catch {
    return { watch: [], videos: [] };
  }
}

export async function getVideos(sort: VideoSort = "latest", revalidate = 300): Promise<{ videos: Video[]; next: string | null }> {
  const d = await getJson<{ videos: Video[]; next: string | null }>(`/v1/videos?limit=24&sort=${sort}`, { next: { revalidate } });
  return d ?? { videos: [], next: null };
}

export type StreamStatus = "live" | "vod" | "unknown" | "offline" | "error" | "pending";
export type PublicStream = {
  id: string; kind: "youtube" | "hls" | "embed"; label: string; region: string; status: StreamStatus; checkedAt: string | null;
  youtubeId?: string; url?: string; needsToken?: boolean;
};

/** Playback sources for a match's Watch tab. Never throws: an extra, the page must still render. */
export async function getMatchStreams(slug: string): Promise<PublicStream[]> {
  try {
    return (await getJson<{ sources: PublicStream[] }>(`/v1/matches/${encodeURIComponent(slug)}/streams`, { next: { revalidate: 5 } }))?.sources ?? [];
  } catch { return []; }
}

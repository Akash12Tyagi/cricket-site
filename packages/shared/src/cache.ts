/**
 * CDN cache policy (plan §4.2). Live data: every viewer of a match shares one cached response,
 * so 10k pollers cost the origin roughly one request per TTL per CDN location.
 */
export const CACHE = {
  live: "public, max-age=0, s-maxage=5, stale-while-revalidate=30, stale-if-error=300",
  short: "public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=3600",
  long: "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400",
  private: "private, no-store",
} as const;

/** Browser polling intervals; clients add ±20% jitter and pause while the tab is hidden. */
export const POLL_MS = { liveMatch: 10_000, liveList: 30_000, idle: 60_000 } as const;

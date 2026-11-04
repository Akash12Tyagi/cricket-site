import type { PublicStream, StreamStatus } from "./api";

const RANK: Record<StreamStatus, number> = { live: 0, unknown: 1, pending: 1, vod: 2, error: 3, offline: 4 };

/** Sources playable in our player, best first. Offline and errored ones are left out unless nothing else exists. */
export function orderServers(sources: PublicStream[], region: string | null): PublicStream[] {
  const here = (s: PublicStream) => s.region === "WW" || region === null || s.region === region;
  const rank = (s: PublicStream) => RANK[s.status] * 10 + (s.region === region ? 0 : s.region === "WW" ? 1 : 2);
  const usable = sources.filter(here);
  const working = usable.filter((s) => s.status !== "offline" && s.status !== "error");
  return [...(working.length ? working : usable)].sort((a, b) => rank(a) - rank(b));
}

/** The next server to try after one failed (wrapping once), or null when every server has failed. */
export function nextServer(order: PublicStream[], failed: Set<string>): PublicStream | null {
  return order.find((s) => !failed.has(s.id)) ?? null;
}

export const STATUS_TEXT: Record<StreamStatus, string> = {
  live: "Live", unknown: "Available", pending: "Checking", vod: "Replay", error: "Unavailable", offline: "Offline",
};

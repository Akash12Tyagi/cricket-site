import type { MatchSummary } from "./api";

export type Ball = "red" | "white";
/** The ball a format is played with: red for the long game, white for limited overs. */
export const ballOf = (format: string): Ball => (format === "TEST" || format === "FIRST_CLASS" ? "red" : "white");

export const LIVE_STATUSES = new Set(["TOSS", "LIVE", "INNINGS_BREAK", "STUMPS", "DELAYED"]);
export const STATUS_LABEL: Record<string, string> = { TOSS: "Toss", LIVE: "Live", INNINGS_BREAK: "Innings break", STUMPS: "Stumps", DELAYED: "Delayed" };

const overs = (balls: number) => `${Math.floor(balls / 6)}${balls % 6 ? `.${balls % 6}` : ""}`;

/** "113 & 516/7d" plus the current innings' overs, for one team. */
export function teamLine(m: MatchSummary, teamId: string) {
  const inns = (m.innings ?? []).filter((i) => i.battingTeamId === teamId);
  if (!inns.length) return null;
  const last = (m.innings ?? []).at(-1);
  const text = inns.map((i) => `${i.runs}${i.wickets < 10 ? `/${i.wickets}` : ""}${i.isDeclared ? "d" : ""}`).join(" & ");
  const batting = last?.battingTeamId === teamId && !last.isComplete;
  return { text, overs: batting && last ? overs(last.legalBalls) : null, batting };
}

/** "Need 93 off 72" for a live limited-overs chase; null otherwise. */
export function chaseLine(m: MatchSummary) {
  const last = (m.innings ?? []).at(-1);
  if (!last || last.isComplete || last.target == null) return null;
  const need = last.target - last.runs;
  if (need <= 0) return null;
  if (m.oversPerInnings) {
    const left = m.oversPerInnings * 6 - last.legalBalls;
    if (left > 0) return `Need ${need} off ${left} ball${left === 1 ? "" : "s"}`;
  }
  return `Need ${need} to win`;
}

/**
 * The seam for a live card: one stitch per over, at exact length.
 * Limited overs run against the innings quota (stitches still to come are dashed). Multi-day innings have no quota,
 * so the seam only grows: stitches for overs actually bowled (one per 5 overs past 60), never a made-up target.
 */
export function seamProgress(m: MatchSummary) {
  const last = (m.innings ?? []).at(-1);
  if (!last) return null;
  const done = Math.floor(last.legalBalls / 6), part = last.legalBalls % 6;
  const oversText = `${done}${part ? `.${part}` : ""}`;
  if (m.oversPerInnings) {
    return { bowled: last.legalBalls, total: m.oversPerInnings * 6, perStitch: 1, open: false, label: `${oversText} of ${m.oversPerInnings} overs bowled in innings ${last.number}` };
  }
  const perStitch = done >= 60 ? 5 : 1;
  return { bowled: last.legalBalls, total: Math.max(6, last.legalBalls), perStitch, open: true, label: `${oversText} overs bowled in innings ${last.number}${perStitch > 1 ? " (one stitch per 5 overs)" : ""}` };
}

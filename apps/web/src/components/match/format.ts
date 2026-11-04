import type { LiveSnapshot } from "@cricket/shared";

export type Innings = LiveSnapshot["innings"][number];

export const playerName = (s: LiveSnapshot, id: string | null) => {
  if (!id) return "";
  const p = s.players.find((x) => x.playerId === id);
  return p ? (p.knownAs ?? p.name) : "Unknown";
};
export const teamShort = (s: LiveSnapshot, id: string) => s.teams.find((t) => t.id === id)?.shortName ?? "";
export const teamName = (s: LiveSnapshot, id: string) => s.teams.find((t) => t.id === id)?.name ?? "";
export const score = (i: Innings) => `${i.runs}/${i.wickets}`;
export const strikeRate = (runs: number, balls: number) => (balls ? ((runs / balls) * 100).toFixed(1) : "-");
export const economy = (runs: number, legalBalls: number, bpo: number) => (legalBalls ? ((runs / legalBalls) * bpo).toFixed(2) : "-");
export const oversOf = (legalBalls: number, bpo: number) => `${Math.floor(legalBalls / bpo)}.${legalBalls % bpo}`;

const DISMISSAL_TEXT: Record<string, string> = {
  BOWLED: "b", CAUGHT: "c", LBW: "lbw", RUN_OUT: "run out", STUMPED: "st", HIT_WICKET: "hit wicket",
  HANDLED_BALL: "handled the ball", HIT_BALL_TWICE: "hit the ball twice", OBSTRUCTING_FIELD: "obstructing the field", TIMED_OUT: "timed out",
  RETIRED_HURT: "retired hurt", RETIRED_OUT: "retired out",
};
export function howOut(s: LiveSnapshot, b: Innings["batters"][number]): string {
  if (!b.out) return "not out";
  const bowler = playerName(s, b.outBowlerId), fielder = playerName(s, b.outFielderId);
  switch (b.out) {
    case "CAUGHT": return b.outFielderId === b.outBowlerId ? `c & b ${bowler}` : `c ${fielder} b ${bowler}`;
    case "STUMPED": return `st ${fielder} b ${bowler}`;
    case "LBW": return `lbw b ${bowler}`;
    case "BOWLED": return `b ${bowler}`;
    case "RUN_OUT": return fielder ? `run out (${fielder})` : "run out";
    default: return DISMISSAL_TEXT[b.out] ?? b.out;
  }
}

/** One-line status for titles and headers, e.g. "IND 145/3 (16.2) · need 36 from 22". */
export function summaryLine(s: LiveSnapshot): string {
  const cur = s.innings.at(-1);
  if (!cur) return s.match.resultText ?? s.match.title;
  const bpo = s.match.ballsPerOver;
  let line = `${teamShort(s, cur.battingTeamId)} ${score(cur)} (${oversOf(cur.legalBalls, bpo)})`;
  if (cur.chase && !cur.isComplete) line += ` · need ${cur.chase.runsNeeded}${cur.chase.ballsLeft != null ? ` from ${cur.chase.ballsLeft}` : ""}`;
  if (s.match.resultText) line += ` · ${s.match.resultText}`;
  return line;
}

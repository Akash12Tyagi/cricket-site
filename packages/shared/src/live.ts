import type { MatchFormat, MatchStatus } from "./cricket.ts";
import type { ChaseState, InningsState } from "./scoring.ts";

/** The public live view of a match: served to every viewer, polled every ~10 s (plan §4.2). */
export interface LiveSnapshot {
  version: number;
  generatedAt: string;
  match: {
    id: string; slug: string; title: string; format: MatchFormat; status: MatchStatus; startsAt: string;
    resultText: string | null; oversPerInnings: number | null; ballsPerOver: number;
    tossWinnerId: string | null; tossDecision: string | null;
    /** Who writes the ball log: a licensed live feed, our own scorer, or a completed-match archive import. */
    source: "feed" | "scorer" | "archive";
  };
  teams: { id: string; name: string; shortName: string; logoUrl: string | null }[];
  venue: { name: string; city: string | null; timezone: string } | null;
  players: {
    playerId: string; teamId: string; name: string; knownAs: string | null; slug: string;
    isPlayingXi: boolean; isCaptain: boolean; isKeeper: boolean; battingOrder: number | null;
  }[];
  innings: (InningsState & {
    id: string; number: number; battingTeamId: string; bowlingTeamId: string;
    isComplete: boolean; isDeclared: boolean; target: number | null; chase: ChaseState | null;
  })[];
  /** Most recent deliveries (newest first), across innings. Older ones: GET /v1/matches/:key/balls. */
  recentBalls: BallEntry[];
}

/** One line of ball-by-ball commentary. */
export interface BallEntry {
  id: string;
  inningsNumber: number;
  seq: number;
  /** "12.3": overs completed + ball in the over (extras show the same ball number again). */
  over: string;
  label: string;
  bowlerId: string;
  strikerId: string;
  runs: number;
  isWicket: boolean;
  isBoundary: boolean;
  text: string | null;
  createdAt: string;
}

export interface BallPage { balls: BallEntry[]; nextBefore: { inningsNumber: number; seq: number } | null }

export const LIVE_STATUSES: readonly MatchStatus[] = ["TOSS", "LIVE", "INNINGS_BREAK", "STUMPS", "DELAYED"];

/**
 * Scorecard from a scorecard-only feed (no deliveries), stored on the match in our innings shape.
 * Player ids are our ids; `isComplete` and `target` are as the feed reported them.
 */
export interface StoredInnings {
  number: number; battingTeamId: string; bowlingTeamId: string; isComplete: boolean; isDeclared: boolean; target: number | null;
  runs: number; wickets: number; legalBalls: number;
  extras: InningsState["extras"];
  batters: InningsState["batters"]; bowlers: InningsState["bowlers"]; fallOfWickets: InningsState["fallOfWickets"];
}
export interface StoredScorecard { source: string; updatedAt: string; innings: StoredInnings[] }

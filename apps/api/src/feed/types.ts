import type { DismissalType, ExtraType, MatchFormat, MatchStatus } from "@cricket/shared";

/**
 * Provider-neutral shape of a match from a licensed live-score feed. Each provider adapter (Sportmonks today)
 * converts its own JSON into this, and the sync engine only ever sees this shape, so adding or switching
 * providers never touches the scoring/storage code.
 */
export type FeedTeam = { extId: string; name: string; shortName: string; national: boolean };
export type FeedPlayer = {
  extId: string; fullName: string; teamExtId: string | null;
  dateOfBirth: string | null; battingStyle: string | null; bowlingStyle: string | null; role: string | null;
  isCaptain?: boolean; isKeeper?: boolean;
};
export type FeedBall = {
  extId: string;
  inningsNumber: number;
  battingTeamExtId: string;
  strikerExtId: string; nonStrikerExtId: string; bowlerExtId: string;
  runsBat: number; extraType: ExtraType | null; extraRuns: number; isBoundary: boolean;
  dismissal: DismissalType | null; dismissedExtId: string | null; fielderExtId: string | null;
};
export type FeedFixture = {
  provider: string;
  extId: string;
  format: MatchFormat;
  status: MatchStatus;
  startsAt: Date;
  oversPerInnings: number | null;
  round: string | null;
  teams: [FeedTeam, FeedTeam];
  venue: { extId: string; name: string; city: string | null } | null;
  series: { extId: string; name: string; season: string | null } | null;
  tossWinnerExtId: string | null;
  tossDecision: "bat" | "bowl" | null;
  winnerExtId: string | null;
  resultText: string | null;
  players: FeedPlayer[];
  /** In delivery order. Innings numbers start at 1; super overs are excluded by the adapter. */
  balls: FeedBall[];
  /** Anything the adapter could not map exactly (shown in the admin feed status, never silently dropped). */
  warnings: string[];
};

export interface FeedProvider {
  readonly name: string;
  /** Matches the provider currently lists as live (including just-finished ones). */
  liveFixtures(): Promise<FeedFixture[]>;
  /** One match by the provider's id (used for matches that have dropped off the live list). */
  fixture(extId: string): Promise<FeedFixture | null>;
}

/** Thrown for provider HTTP failures. Carries no URL, so an API token in the query string can never reach a log. */
export class FeedError extends Error {
  constructor(readonly provider: string, readonly status: number, readonly retryAfterSeconds: number | null = null) {
    super(`${provider} feed HTTP ${status}`);
    this.name = "FeedError";
  }
}

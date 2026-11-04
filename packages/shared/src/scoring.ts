import type { DismissalType, ExtraType } from "./cricket.ts";

/**
 * Ball-by-ball scoring engine (plan §4.1, §8.1).
 * Pure functions: the innings state is always *derived* from the list of deliveries,
 * so totals can never drift from the ball log, and undo is simply "drop the last ball".
 *
 * Conventions for a delivery:
 * - `runsBat`: runs credited to the batter (off the bat). Boundaries are 4/6 here with `isBoundary`.
 * - `extraRuns`: all extras on this delivery, INCLUDING the 1-run wide/no-ball penalty.
 *     wide with 2 run:          extraType WIDE,    extraRuns 3, runsBat 0
 *     no-ball hit for 4:        extraType NO_BALL, extraRuns 1, runsBat 4
 *     2 leg-byes:               extraType LEG_BYE, extraRuns 2
 * - `strikerId` / `nonStrikerId` are recorded by the scorer for every ball (authoritative);
 *   the engine only *suggests* who faces next.
 */
export interface Delivery {
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  runsBat: number;
  extraType: ExtraType | null;
  extraRuns: number;
  isBoundary: boolean;
  dismissal: DismissalType | null;
  dismissedPlayerId: string | null;
  fielderId: string | null;
}

export interface BatterLine { playerId: string; runs: number; balls: number; fours: number; sixes: number; out: DismissalType | null; outBowlerId: string | null; outFielderId: string | null }
export interface BowlerLine { playerId: string; legalBalls: number; maidens: number; runs: number; wickets: number; wides: number; noBalls: number }
export interface FallOfWicket { wicket: number; runs: number; legalBalls: number; playerId: string }

export interface InningsState {
  runs: number;
  wickets: number;
  legalBalls: number;
  overs: string; // "12.3"
  extras: { wides: number; noBalls: number; byes: number; legByes: number; penalty: number; total: number };
  batters: BatterLine[]; // in order of appearance
  bowlers: BowlerLine[]; // in order of appearance
  fallOfWickets: FallOfWicket[];
  partnership: { runs: number; balls: number };
  /** Labels for the over in progress, e.g. ["1", "Wd", "4", "W"]. */
  thisOver: string[];
  runRate: number | null;
  /** Who should face next, after strike rotation and end-of-over swap. `null` = new batter needed. */
  next: { strikerId: string | null; nonStrikerId: string | null; overComplete: boolean; lastBowlerId: string | null };
}

export interface InningsLimits {
  ballsPerOver?: number; // default 6
  maxOvers?: number | null; // null = unlimited (Tests)
  maxWickets?: number; // default 10
  target?: number | null;
}

export interface ChaseState { target: number; runsNeeded: number; ballsLeft: number | null; requiredRate: number | null }

export const MAX_RUNS_PER_BALL = 12;

/** Dismissals credited to the bowler. */
const BOWLER_WICKETS: ReadonlySet<DismissalType> = new Set(["BOWLED", "CAUGHT", "LBW", "STUMPED", "HIT_WICKET"]);
/** Dismissals that don't count as a wicket against the side. */
const NOT_A_WICKET: ReadonlySet<DismissalType> = new Set(["RETIRED_HURT"]);

export const isLegal = (d: Pick<Delivery, "extraType">) => d.extraType !== "WIDE" && d.extraType !== "NO_BALL" && d.extraType !== "PENALTY";

/** Runs the batters physically ran on this delivery (drives strike rotation). */
export function runsRun(d: Delivery): number {
  if (d.isBoundary) return 0;
  switch (d.extraType) {
    case "WIDE":
    case "NO_BALL": return d.runsBat + Math.max(0, d.extraRuns - 1);
    case "BYE":
    case "LEG_BYE": return d.extraRuns;
    case "PENALTY": return 0;
    default: return d.runsBat;
  }
}

/** Runs charged to the bowler: everything except byes, leg-byes and penalty runs. */
function bowlerRuns(d: Delivery): number {
  if (d.extraType === "BYE" || d.extraType === "LEG_BYE" || d.extraType === "PENALTY") return d.runsBat;
  return d.runsBat + d.extraRuns;
}

/** Short label shown in "this over" strips: 0 · 1 · 4 · 6 · W · Wd · 2Wd · Nb · 4Nb · 1b · 2lb. */
export function ballLabel(d: Delivery): string {
  const w = d.dismissal && !NOT_A_WICKET.has(d.dismissal) ? "W" : "";
  switch (d.extraType) {
    case "WIDE": return `${d.extraRuns > 1 ? d.extraRuns - 1 : ""}Wd${w ? "+W" : ""}`;
    case "NO_BALL": { const r = d.runsBat + d.extraRuns - 1; return `${r || ""}Nb${w ? "+W" : ""}`; }
    case "BYE": return `${d.extraRuns}b${w ? "+W" : ""}`;
    case "LEG_BYE": return `${d.extraRuns}lb${w ? "+W" : ""}`;
    case "PENALTY": return `${d.extraRuns}p`;
    default: return w ? (d.runsBat ? `${d.runsBat}+W` : "W") : String(d.runsBat);
  }
}

export const formatOvers = (legalBalls: number, ballsPerOver = 6) => `${Math.floor(legalBalls / ballsPerOver)}.${legalBalls % ballsPerOver}`;

export function computeInnings(deliveries: readonly Delivery[], limits: InningsLimits = {}): InningsState {
  const bpo = limits.ballsPerOver ?? 6;
  const extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0, total: 0 };
  const batters = new Map<string, BatterLine>();
  const bowlers = new Map<string, BowlerLine>();
  const fow: FallOfWicket[] = [];
  let runs = 0, wickets = 0, legalBalls = 0;
  let partnership = { runs: 0, balls: 0 };
  let thisOver: string[] = [];
  let overBowlerRuns = 0, overLegal = 0;
  let striker: string | null = null, nonStriker: string | null = null, lastBowler: string | null = null;
  let overComplete = false;

  const batter = (id: string) => {
    let b = batters.get(id);
    if (!b) batters.set(id, (b = { playerId: id, runs: 0, balls: 0, fours: 0, sixes: 0, out: null, outBowlerId: null, outFielderId: null }));
    return b;
  };
  const bowler = (id: string) => {
    let b = bowlers.get(id);
    if (!b) bowlers.set(id, (b = { playerId: id, legalBalls: 0, maidens: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0 }));
    return b;
  };

  for (const d of deliveries) {
    if (overComplete) { thisOver = []; overBowlerRuns = 0; overLegal = 0; overComplete = false; }
    const legal = isLegal(d);
    const s = batter(d.strikerId);
    batter(d.nonStrikerId);
    const bw = d.extraType === "PENALTY" ? null : bowler(d.bowlerId);

    const total = d.runsBat + d.extraRuns;
    runs += total;
    partnership.runs += total;

    switch (d.extraType) {
      case "WIDE": extras.wides += d.extraRuns; if (bw) bw.wides += d.extraRuns; break;
      case "NO_BALL": extras.noBalls += d.extraRuns; if (bw) bw.noBalls += 1; break;
      case "BYE": extras.byes += d.extraRuns; break;
      case "LEG_BYE": extras.legByes += d.extraRuns; break;
      case "PENALTY": extras.penalty += d.extraRuns; break;
    }
    extras.total += d.extraRuns;

    s.runs += d.runsBat;
    if (d.extraType !== "WIDE" && d.extraType !== "PENALTY") s.balls += 1; // no-balls count as balls faced
    if (d.isBoundary && d.runsBat === 4) s.fours += 1;
    if (d.isBoundary && d.runsBat === 6) s.sixes += 1;

    if (bw) {
      bw.runs += bowlerRuns(d);
      overBowlerRuns += bowlerRuns(d);
      lastBowler = d.bowlerId;
    }
    if (legal) { legalBalls += 1; overLegal += 1; partnership.balls += 1; if (bw) bw.legalBalls += 1; }
    if (d.extraType !== "PENALTY") thisOver.push(ballLabel(d));

    // Strike after this ball: start from the recorded positions, rotate on odd runs run.
    striker = d.strikerId;
    nonStriker = d.nonStrikerId;
    if (runsRun(d) % 2 === 1) [striker, nonStriker] = [nonStriker, striker];

    if (d.dismissal) {
      const outId = d.dismissedPlayerId ?? d.strikerId;
      const out = batter(outId);
      out.out = d.dismissal;
      if (BOWLER_WICKETS.has(d.dismissal)) { out.outBowlerId = d.bowlerId; if (bw) bw.wickets += 1; }
      out.outFielderId = d.fielderId;
      if (!NOT_A_WICKET.has(d.dismissal)) {
        wickets += 1;
        fow.push({ wicket: wickets, runs, legalBalls, playerId: outId });
      }
      partnership = { runs: 0, balls: 0 };
      if (striker === outId) striker = null;
      else if (nonStriker === outId) nonStriker = null;
    }

    if (legal && overLegal === bpo) {
      overComplete = true;
      if (bw && overBowlerRuns === 0) bw.maidens += 1;
      [striker, nonStriker] = [nonStriker, striker];
    }
  }

  return {
    runs, wickets, legalBalls,
    overs: formatOvers(legalBalls, bpo),
    extras,
    batters: [...batters.values()],
    bowlers: [...bowlers.values()],
    fallOfWickets: fow,
    partnership,
    thisOver: overComplete ? [] : thisOver,
    runRate: legalBalls ? Math.round((runs / legalBalls) * bpo * 100) / 100 : null,
    next: { strikerId: striker, nonStrikerId: nonStriker, overComplete: overComplete || legalBalls === 0, lastBowlerId: lastBowler },
  };
}

export function chase(state: Pick<InningsState, "runs" | "legalBalls">, limits: InningsLimits): ChaseState | null {
  if (limits.target == null) return null;
  const bpo = limits.ballsPerOver ?? 6;
  const runsNeeded = Math.max(0, limits.target - state.runs);
  const ballsLeft = limits.maxOvers == null ? null : Math.max(0, limits.maxOvers * bpo - state.legalBalls);
  const requiredRate = ballsLeft ? Math.round((runsNeeded / ballsLeft) * bpo * 100) / 100 : null;
  return { target: limits.target, runsNeeded, ballsLeft, requiredRate };
}

/** Innings is over when all out, overs are used up, or the target is reached. */
export function isInningsComplete(state: Pick<InningsState, "runs" | "wickets" | "legalBalls">, limits: InningsLimits): boolean {
  const bpo = limits.ballsPerOver ?? 6;
  if (state.wickets >= (limits.maxWickets ?? 10)) return true;
  if (limits.maxOvers != null && state.legalBalls >= limits.maxOvers * bpo) return true;
  if (limits.target != null && state.runs >= limits.target) return true;
  return false;
}

export type DeliveryError =
  | "SAME_BATTERS" | "BOWLER_IS_BATTER" | "BOWLER_CONSECUTIVE_OVERS" | "INVALID_RUNS"
  | "INVALID_EXTRA" | "INVALID_DISMISSAL_ON_EXTRA" | "DISMISSED_NOT_AT_CREASE" | "BATTER_ALREADY_OUT" | "INNINGS_COMPLETE";

/**
 * Validates a new delivery against the current state before it is stored (plan §4.3 step 1).
 * Returns null when valid, otherwise a machine-readable error code for the scorer UI.
 */
export function validateDelivery(d: Delivery, state: InningsState, limits: InningsLimits = {}): DeliveryError | null {
  if (isInningsComplete(state, limits)) return "INNINGS_COMPLETE";
  if (d.strikerId === d.nonStrikerId) return "SAME_BATTERS";
  if (d.bowlerId === d.strikerId || d.bowlerId === d.nonStrikerId) return "BOWLER_IS_BATTER";
  if (state.batters.some((b) => b.out && b.out !== "RETIRED_HURT" && (b.playerId === d.strikerId || b.playerId === d.nonStrikerId))) return "BATTER_ALREADY_OUT";
  // A bowler may not bowl two consecutive overs.
  if (state.next.overComplete && state.legalBalls > 0 && state.next.lastBowlerId === d.bowlerId) return "BOWLER_CONSECUTIVE_OVERS";

  const intOk = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  // Up to 12: runs plus overthrows can exceed 7 (a real 8 exists in the 2008 Brisbane Test).
  if (!intOk(d.runsBat, MAX_RUNS_PER_BALL) || !intOk(d.extraRuns, MAX_RUNS_PER_BALL)) return "INVALID_RUNS";
  if (d.isBoundary && d.runsBat !== 4 && d.runsBat !== 6) return "INVALID_RUNS";
  switch (d.extraType) {
    case null: if (d.extraRuns !== 0) return "INVALID_EXTRA"; break;
    case "WIDE": if (d.extraRuns < 1 || d.runsBat !== 0) return "INVALID_EXTRA"; break;
    case "NO_BALL": if (d.extraRuns < 1) return "INVALID_EXTRA"; break;
    case "BYE": case "LEG_BYE": if (d.extraRuns < 1 || d.runsBat !== 0) return "INVALID_EXTRA"; break;
    case "PENALTY": if (d.extraRuns !== 5 || d.runsBat !== 0) return "INVALID_EXTRA"; break;
  }
  if (d.dismissal) {
    const outId = d.dismissedPlayerId ?? d.strikerId;
    if (outId !== d.strikerId && outId !== d.nonStrikerId) return "DISMISSED_NOT_AT_CREASE";
    const allowedOnNoBall: DismissalType[] = ["RUN_OUT", "HANDLED_BALL", "HIT_BALL_TWICE", "OBSTRUCTING_FIELD", "RETIRED_HURT", "RETIRED_OUT"];
    const allowedOnWide: DismissalType[] = [...allowedOnNoBall, "STUMPED", "HIT_WICKET"];
    if (d.extraType === "NO_BALL" && !allowedOnNoBall.includes(d.dismissal)) return "INVALID_DISMISSAL_ON_EXTRA";
    if (d.extraType === "WIDE" && !allowedOnWide.includes(d.dismissal)) return "INVALID_DISMISSAL_ON_EXTRA";
    if (d.extraType === "PENALTY") return "INVALID_DISMISSAL_ON_EXTRA";
    // Non-striker can only be run out (or obstruct/retire) — never bowled, caught, lbw, stumped.
    if (outId === d.nonStrikerId && !["RUN_OUT", "OBSTRUCTING_FIELD", "RETIRED_HURT", "RETIRED_OUT", "TIMED_OUT"].includes(d.dismissal)) return "DISMISSED_NOT_AT_CREASE";
  }
  return null;
}

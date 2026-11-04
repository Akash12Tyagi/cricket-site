import { describe, expect, it } from "vitest";
import { ballLabel, chase, computeInnings, isInningsComplete, validateDelivery, type Delivery } from "./scoring.ts";

const A = "batA", B = "batB", C = "batC", X = "bowlX", Y = "bowlY";

/** Helper: a delivery with sensible defaults. */
const d = (p: Partial<Delivery> = {}): Delivery => ({
  strikerId: A, nonStrikerId: B, bowlerId: X, runsBat: 0, extraType: null, extraRuns: 0,
  isBoundary: false, dismissal: null, dismissedPlayerId: null, fielderId: null, ...p,
});

describe("totals and extras", () => {
  it("counts bat runs, wides, no-balls, byes, leg-byes separately", () => {
    const s = computeInnings([
      d({ runsBat: 4, isBoundary: true }),
      d({ extraType: "WIDE", extraRuns: 1 }),
      d({ extraType: "WIDE", extraRuns: 3 }), // wide + 2 run
      d({ extraType: "NO_BALL", extraRuns: 1, runsBat: 6, isBoundary: true }),
      d({ extraType: "BYE", extraRuns: 2 }),
      d({ extraType: "LEG_BYE", extraRuns: 1 }),
    ]);
    expect(s.runs).toBe(4 + 1 + 3 + 7 + 2 + 1);
    expect(s.extras).toEqual({ wides: 4, noBalls: 1, byes: 2, legByes: 1, penalty: 0, total: 8 });
    expect(s.legalBalls).toBe(3); // boundary, bye, leg-bye
    expect(s.overs).toBe("0.3");
  });

  it("credits batter and bowler correctly", () => {
    const s = computeInnings([
      d({ runsBat: 4, isBoundary: true }),
      d({ extraType: "NO_BALL", extraRuns: 1, runsBat: 6, isBoundary: true }),
      d({ extraType: "WIDE", extraRuns: 1 }),
      d({ extraType: "LEG_BYE", extraRuns: 4 }),
    ]);
    const a = s.batters.find((b) => b.playerId === A)!;
    expect(a).toMatchObject({ runs: 10, balls: 3, fours: 1, sixes: 1 }); // wide not a ball faced; no-ball is
    const x = s.bowlers.find((b) => b.playerId === X)!;
    expect(x).toMatchObject({ runs: 4 + 7 + 1, legalBalls: 2, wides: 1, noBalls: 1 }); // leg-byes not charged
  });
});

describe("strike rotation", () => {
  it("swaps on odd runs, keeps strike on even runs and boundaries", () => {
    expect(computeInnings([d({ runsBat: 1 })]).next.strikerId).toBe(B);
    expect(computeInnings([d({ runsBat: 2 })]).next.strikerId).toBe(A);
    expect(computeInnings([d({ runsBat: 4, isBoundary: true })]).next.strikerId).toBe(A);
    expect(computeInnings([d({ extraType: "LEG_BYE", extraRuns: 1 })]).next.strikerId).toBe(B);
    expect(computeInnings([d({ extraType: "WIDE", extraRuns: 2 })]).next.strikerId).toBe(B); // ran one on a wide
  });

  it("swaps at the end of the over and completes a maiden", () => {
    const over = Array.from({ length: 6 }, () => d());
    const s = computeInnings(over);
    expect(s.overs).toBe("1.0");
    expect(s.next).toMatchObject({ strikerId: B, nonStrikerId: A, overComplete: true, lastBowlerId: X });
    expect(s.bowlers[0]!.maidens).toBe(1);
    expect(s.thisOver).toEqual([]);
  });

  it("a single off the last ball keeps the same batter on strike for the next over", () => {
    const s = computeInnings([...Array.from({ length: 5 }, () => d()), d({ runsBat: 1 })]);
    expect(s.next.strikerId).toBe(A);
    expect(s.bowlers[0]!.maidens).toBe(0);
  });

  it("wides and no-balls don't complete an over", () => {
    const s = computeInnings([...Array.from({ length: 5 }, () => d()), d({ extraType: "WIDE", extraRuns: 1 })]);
    expect(s.overs).toBe("0.5");
    expect(s.next.overComplete).toBe(false);
    expect(s.thisOver).toEqual(["0", "0", "0", "0", "0", "Wd"]);
  });
});

describe("wickets", () => {
  it("records fall of wickets, credits bowler, resets partnership", () => {
    const s = computeInnings([d({ runsBat: 3 }), d({ strikerId: B, nonStrikerId: A, dismissal: "CAUGHT", fielderId: "f1" })]);
    expect(s.wickets).toBe(1);
    expect(s.fallOfWickets).toEqual([{ wicket: 1, runs: 3, legalBalls: 2, playerId: B }]);
    expect(s.bowlers[0]!.wickets).toBe(1);
    expect(s.batters.find((b) => b.playerId === B)).toMatchObject({ out: "CAUGHT", outBowlerId: X, outFielderId: "f1" });
    expect(s.partnership).toEqual({ runs: 0, balls: 0 });
    expect(s.next.strikerId).toBeNull(); // new batter needed
    expect(s.next.nonStrikerId).toBe(A);
  });

  it("run out is not credited to the bowler and can remove the non-striker", () => {
    const s = computeInnings([d({ runsBat: 1, dismissal: "RUN_OUT", dismissedPlayerId: B })]);
    expect(s.wickets).toBe(1);
    expect(s.bowlers[0]!.wickets).toBe(0);
    expect(s.runs).toBe(1);
    expect(s.next).toMatchObject({ strikerId: null, nonStrikerId: A });
  });

  it("retired hurt is not a wicket", () => {
    const s = computeInnings([d({ dismissal: "RETIRED_HURT" })]);
    expect(s.wickets).toBe(0);
    expect(s.fallOfWickets).toEqual([]);
  });
});

describe("labels", () => {
  it.each([
    [d(), "0"], [d({ runsBat: 4, isBoundary: true }), "4"], [d({ dismissal: "BOWLED" }), "W"],
    [d({ extraType: "WIDE", extraRuns: 1 }), "Wd"], [d({ extraType: "WIDE", extraRuns: 3 }), "2Wd"],
    [d({ extraType: "NO_BALL", extraRuns: 1 }), "Nb"], [d({ extraType: "NO_BALL", extraRuns: 1, runsBat: 4, isBoundary: true }), "4Nb"],
    [d({ extraType: "LEG_BYE", extraRuns: 2 }), "2lb"], [d({ extraType: "BYE", extraRuns: 1 }), "1b"],
    [d({ runsBat: 1, dismissal: "RUN_OUT", dismissedPlayerId: B }), "1+W"],
  ])("%#", (ball, label) => expect(ballLabel(ball)).toBe(label));
});

describe("chase and completion", () => {
  it("computes required rate", () => {
    expect(chase({ runs: 100, legalBalls: 60 }, { target: 181, maxOvers: 20 })).toEqual({ target: 181, runsNeeded: 81, ballsLeft: 60, requiredRate: 8.1 });
    expect(chase({ runs: 10, legalBalls: 6 }, {})).toBeNull();
  });
  it("detects all out, overs used and target reached", () => {
    expect(isInningsComplete({ runs: 50, wickets: 10, legalBalls: 30 }, {})).toBe(true);
    expect(isInningsComplete({ runs: 50, wickets: 2, legalBalls: 120 }, { maxOvers: 20 })).toBe(true);
    expect(isInningsComplete({ runs: 181, wickets: 2, legalBalls: 100 }, { maxOvers: 20, target: 181 })).toBe(true);
    expect(isInningsComplete({ runs: 50, wickets: 2, legalBalls: 100 }, { maxOvers: 20 })).toBe(false);
  });
});

describe("validation", () => {
  const empty = computeInnings([]);
  it("accepts a normal ball", () => expect(validateDelivery(d({ runsBat: 1 }), empty)).toBeNull());
  it("accepts 8 off one ball (runs plus overthrows)", () => expect(validateDelivery(d({ runsBat: 8 }), empty)).toBeNull());
  it.each([
    [d({ nonStrikerId: A }), "SAME_BATTERS"],
    [d({ bowlerId: A }), "BOWLER_IS_BATTER"],
    [d({ runsBat: 13 }), "INVALID_RUNS"],
    [d({ runsBat: 3, isBoundary: true }), "INVALID_RUNS"],
    [d({ extraType: "WIDE", extraRuns: 0 }), "INVALID_EXTRA"],
    [d({ extraType: "WIDE", extraRuns: 1, runsBat: 2 }), "INVALID_EXTRA"],
    [d({ extraType: "NO_BALL", extraRuns: 1, dismissal: "BOWLED" }), "INVALID_DISMISSAL_ON_EXTRA"],
    [d({ extraType: "WIDE", extraRuns: 1, dismissal: "LBW" }), "INVALID_DISMISSAL_ON_EXTRA"],
    [d({ dismissal: "CAUGHT", dismissedPlayerId: B }), "DISMISSED_NOT_AT_CREASE"],
    [d({ dismissal: "RUN_OUT", dismissedPlayerId: C }), "DISMISSED_NOT_AT_CREASE"],
  ])("rejects %#", (ball, code) => expect(validateDelivery(ball, empty)).toBe(code));

  it("allows stumping off a wide and run out off a no-ball", () => {
    expect(validateDelivery(d({ extraType: "WIDE", extraRuns: 1, dismissal: "STUMPED" }), empty)).toBeNull();
    expect(validateDelivery(d({ extraType: "NO_BALL", extraRuns: 1, dismissal: "RUN_OUT", dismissedPlayerId: B }), empty)).toBeNull();
  });

  it("blocks the same bowler bowling consecutive overs", () => {
    const afterOver = computeInnings(Array.from({ length: 6 }, () => d()));
    expect(validateDelivery(d({ strikerId: B, nonStrikerId: A, bowlerId: X }), afterOver)).toBe("BOWLER_CONSECUTIVE_OVERS");
    expect(validateDelivery(d({ strikerId: B, nonStrikerId: A, bowlerId: Y }), afterOver)).toBeNull();
  });

  it("blocks a dismissed batter from returning, and balls after the innings ends", () => {
    const s = computeInnings([d({ dismissal: "BOWLED" })]);
    expect(validateDelivery(d(), s)).toBe("BATTER_ALREADY_OUT");
    expect(validateDelivery(d({ strikerId: C }), s)).toBeNull();
    const allOut = computeInnings([d({ dismissal: "BOWLED" })]);
    expect(validateDelivery(d({ strikerId: C }), allOut, { maxWickets: 1 })).toBe("INNINGS_COMPLETE");
  });
});

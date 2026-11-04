import { describe, expect, it } from "vitest";
import { computeInnings, type Delivery } from "@cricket/shared";
import { mapScore, mapStatus, toFeedFixture } from "../src/feed/sportmonks.js";
import { S, smFixture } from "./fixtures/sportmonks.js";

describe("Sportmonks score mapping", () => {
  const map = (s: (typeof S)[keyof typeof S]) => mapScore(s, []);
  it("maps runs, boundaries and extras", () => {
    expect(map(S.four)).toEqual({ runsBat: 4, extraType: null, extraRuns: 0, isBoundary: true, dismissal: null });
    expect(map(S.six).isBoundary).toBe(true);
    expect(map(S.wide)).toMatchObject({ runsBat: 0, extraType: "WIDE", extraRuns: 1 });
    expect(map(S.fiveWides)).toMatchObject({ extraType: "WIDE", extraRuns: 5 });
    expect(map(S.noBallPlusOne)).toMatchObject({ runsBat: 1, extraType: "NO_BALL", extraRuns: 1 });
    expect(map(S.bye)).toMatchObject({ runsBat: 0, extraType: "BYE", extraRuns: 1 });
    expect(map(S.legBye)).toMatchObject({ extraType: "LEG_BYE", extraRuns: 1 });
    expect(map(S.penalty)).toMatchObject({ runsBat: 0, extraType: "PENALTY", extraRuns: 5 });
  });
  it("maps dismissals, including wickets with extras", () => {
    expect(map(S.caught).dismissal).toBe("CAUGHT");
    expect(map(S.lbw).dismissal).toBe("LBW");
    expect(map(S.byeRunOut)).toMatchObject({ extraType: "BYE", extraRuns: 1, dismissal: "RUN_OUT" });
    const warnings: string[] = [];
    mapScore({ ...S.caught, name: "Something New" }, warnings);
    expect(warnings[0]).toContain("unknown dismissal");
  });
  it("maps match statuses", () => {
    expect(mapStatus("NS")).toBe("SCHEDULED");
    expect(mapStatus("2nd Innings")).toBe("LIVE");
    expect(mapStatus("Tea Break")).toBe("LIVE");
    expect(mapStatus("Innings Break")).toBe("INNINGS_BREAK");
    expect(mapStatus("Stump Day 2")).toBe("STUMPS");
    expect(mapStatus("Int.")).toBe("DELAYED");
    expect(mapStatus("Aban.")).toBe("ABANDONED");
    expect(mapStatus("Finished")).toBe("COMPLETED");
  });
});

describe("Sportmonks fixture → feed fixture", () => {
  const f = toFeedFixture(smFixture());
  it("maps teams, venue, series, toss and lineup", () => {
    expect(f).toMatchObject({ provider: "sportmonks", extId: "777001", format: "T20I", status: "LIVE", oversPerInnings: 20, tossDecision: "bat", tossWinnerExtId: "501" });
    expect(f.teams.map((t) => t.shortName)).toEqual(["FDL", "SYN"]);
    expect(f.series).toEqual({ extId: "3-2026", name: "Feed Series", season: "2026" });
    expect(f.players).toHaveLength(22);
    expect(f.players.find((p) => p.extId === "1")).toMatchObject({ isCaptain: true, teamExtId: "501" });
  });
  it("orders deliveries, derives the non-striker and skips super overs", () => {
    expect(f.balls).toHaveLength(9);
    expect(f.balls.every((b) => b.inningsNumber <= 2)).toBe(true);
    const caught = f.balls[3]!;
    expect(caught).toMatchObject({ strikerExtId: "2", nonStrikerExtId: "1", dismissal: "CAUGHT", dismissedExtId: "2", fielderExtId: "22" });
    expect(f.balls[4]).toMatchObject({ dismissal: "LBW", dismissedExtId: "3", fielderExtId: null });
  });
  it("produces totals the scoring engine agrees with", () => {
    const first = f.balls.filter((b) => b.inningsNumber === 1).map((b) => ({ ...b, strikerId: b.strikerExtId, nonStrikerId: b.nonStrikerExtId, bowlerId: b.bowlerExtId, dismissedPlayerId: b.dismissedExtId, fielderId: b.fielderExtId })) as unknown as Delivery[];
    const s = computeInnings(first, { ballsPerOver: 6, maxOvers: 20 });
    // 4 + 1wd + (1nb + 1) + W + W + 6 + 1lb + 0 = 14/2 after 6 legal balls
    expect({ runs: s.runs, wickets: s.wickets, overs: s.overs }).toEqual({ runs: 14, wickets: 2, overs: "1.0" });
  });
});

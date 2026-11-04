import { describe, expect, it } from "vitest";
import { createHighlightlyClient, mapDismissal, mapHlStatus, oversToBalls, parseInfo, parseScore, toHlDetail, toHlMatch } from "../src/feed/highlightly.js";
import { mapFormat, mergeMultiDay } from "../src/feed/scorecard-sync.js";
import { hlDetail, hlRaw } from "./fixtures/highlightly.js";

const H = { id: 1, name: "Hometown", abbr: "HOM" }, A = { id: 2, name: "Awayville Strikers", abbr: "AWS" };

describe("Highlightly parsing", () => {
  it("parses score lines and info", () => {
    expect(parseScore("243/9")).toEqual([{ runs: 243, wickets: 9, declared: false }]);
    expect(parseScore("241")).toEqual([{ runs: 241, wickets: 10, declared: false }]);
    expect(parseScore("350/8d & 120/3")).toEqual([{ runs: 350, wickets: 8, declared: true }, { runs: 120, wickets: 3, declared: false }]);
    expect(parseScore(null)).toEqual([]);
    expect(parseInfo("47.1/50 ov, T:242")).toEqual({ overs: "47.1", maxOvers: 50, target: 242 });
    expect(parseInfo("9/15 ov")).toEqual({ overs: "9", maxOvers: 15, target: null });
    expect(oversToBalls(8.4)).toBe(52);
    expect(oversToBalls("47.1")).toBe(283);
  });
  it("maps statuses and dismissals", () => {
    expect(mapHlStatus("Scheduled", "Match yet to begin")).toBe("SCHEDULED");
    expect(mapHlStatus("In play", null)).toBe("LIVE");
    expect(mapHlStatus("Finished", "Pakistan won by 1 wicket")).toBe("COMPLETED");
    expect(mapHlStatus("Finished", "No result")).toBe("ABANDONED");
    expect(mapHlStatus("Postponed", "No result")).toBe("ABANDONED");
    expect(mapHlStatus("Innings break", null)).toBe("INNINGS_BREAK");
    expect(mapHlStatus("Stumps", null)).toBe("STUMPS");
    expect(mapDismissal("caught", [])).toBe("CAUGHT");
    expect(mapDismissal("run out", [])).toBe("RUN_OUT");
    expect(mapDismissal("not out", [])).toBeNull();
    const w: string[] = []; mapDismissal("vanished", w); expect(w).toHaveLength(1);
  });
  it("finds the winner by name, short name, or (failing that) by score", () => {
    const fin = (report: string, hs: string, as: string) => toHlMatch(hlRaw("1", H, A, { state: { teams: { home: { info: null, score: hs }, away: { info: "T:200", score: as } }, report, description: "Finished" } }));
    expect(fin("Hometown won by 50 runs", "199/5", "149").winnerExtId).toBe("1");
    expect(fin("Strikers won by 3 wickets (with 2 balls remaining)", "199/5", "200/7").winnerExtId).toBe("2");
    expect(fin("AWS won by 3 wickets", "199/5", "200/7").winnerExtId).toBe("2");
    expect(fin("A.V.S. won by 3 wickets", "199/5", "200/7").winnerExtId).toBe("2"); // unknown short form → higher total
    expect(fin("A.V.S. won by 5 runs (DLS method)", "120/5", "100/2").winnerExtId).toBeNull(); // DLS: don't guess
    expect(fin("Match tied", "150", "150").winnerExtId).toBeNull();
  });
  it("maps a full scorecard in batting order with bowlers and fall of wickets", () => {
    const d = toHlDetail(hlDetail("9", H, A, "t"));
    expect(d.status).toBe("LIVE");
    expect(d.innings.map((i) => i.battingExtId)).toEqual(["1", "2"]); // sorted by innings number
    expect(d.innings[0]!.batters[0]).toMatchObject({ runs: 101, out: "RUN_OUT", fielderName: "Away Bat 4 t" });
    expect(d.innings[1]!.bowlers[0]).toMatchObject({ name: "Home Bat 9 t", legalBalls: 24, wickets: 1 });
    expect(d.innings[1]!.fallOfWickets[1]).toEqual({ wicket: 2, runs: 52, legalBalls: 41, name: "Away Bat 2 t" });
    expect(d.players).toHaveLength(8);
    expect(d.away.target).toBe(153);
  });
  it("maps formats for internationals and domestic teams", () => {
    expect(mapFormat("T20", true)).toBe("T20I");
    expect(mapFormat("T20", false)).toBe("T20");
    expect(mapFormat("ODI", false)).toBe("LIST_A");
    expect(mapFormat("TEST", true)).toBe("TEST");
    expect(mapFormat("TEST", false)).toBe("FIRST_CLASS");
  });
});

describe("Highlightly client", () => {
  it("sends the key only as a header, tracks the plan's remaining requests, and keeps the key out of errors", async () => {
    const seen: { url: string; key: string | null }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      seen.push({ url, key: new Headers(init.headers).get("x-rapidapi-key") });
      return new Response(JSON.stringify({ data: [hlRaw("5", H, A)], pagination: { totalCount: 1 } }), { status: 200, headers: { "x-ratelimit-requests-limit": "100", "x-ratelimit-requests-remaining": "42" } });
    }) as unknown as typeof fetch;
    const c = createHighlightlyClient("SECRET-KEY-1234567890", ok);
    expect((await c.matchesOn("2026-10-27"))[0]!.extId).toBe("5");
    expect(seen[0]!.url).not.toContain("SECRET");
    expect(seen[0]!.key).toBe("SECRET-KEY-1234567890");
    expect(c.quota).toMatchObject({ limit: 100, remaining: 42 });
    const bad = createHighlightlyClient("SECRET-KEY-1234567890", (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch);
    const err = await bad.matchesOn("2026-10-27").catch((e: Error) => e);
    expect((err as Error).message).toBe("highlightly feed HTTP 429");
  });
});

describe("multi-day list updates (mergeMultiDay)", () => {
  const T = (ext: string) => `team-${ext}`;
  const inn = (number: number, bat: string, runs: number, wickets: number, balls = 0, extra: object = {}) => ({
    number, battingTeamId: T(bat), bowlingTeamId: T(bat === "1" ? "2" : "1"), isComplete: false, isDeclared: false, target: null, runs, wickets, legalBalls: balls,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0, total: 0 }, batters: [{ playerId: "p", runs: 5, balls: 5, fours: 0, sixes: 0, out: null, outBowlerId: null, outFielderId: null }], bowlers: [], fallOfWickets: [], ...extra,
  });
  const list = (home: [string, string | null], away: [string, string | null], status = "In play") => toHlMatch(hlRaw("77", H, A, {
    format: "TEST", dayType: "MULTI",
    state: { teams: { home: { info: home[1], score: home[0] || null }, away: { info: away[1], score: away[0] || null } }, report: null, description: status },
  }));
  const team = (ext: string) => T(ext);

  it("advances the live innings from the score line and keeps the batting card", () => {
    const prev = [inn(1, "1", 312, 5, 546)];
    const out = mergeMultiDay(prev, list(["392/5", "109 ov"], ["", null]), team);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ runs: 392, wickets: 5, legalBalls: 654, isComplete: false });
    expect(out[0]!.batters).toHaveLength(1);
  });

  it("appends a new innings in batting order (the side that did not bat last) with totals only", () => {
    const prev = [inn(1, "1", 450, 10, 700)];
    const out = mergeMultiDay(prev, list(["450", "117 ov"], ["30/1", "8 ov"]), team);
    expect(out.map((i) => [i.number, i.battingTeamId, i.runs, i.wickets, i.isComplete])).toEqual([[1, "team-1", 450, 10, true], [2, "team-2", 30, 1, false]]);
    expect(out[1]!.legalBalls).toBe(48);
    expect(out[1]!.batters).toEqual([]);
  });

  it("matches a team's second score line to its second innings and closes earlier innings", () => {
    const prev = [inn(1, "1", 300, 10, 500), inn(2, "2", 200, 10, 400)];
    const out = mergeMultiDay(prev, list(["300 & 45/2", "20 ov, T:301"], ["200", null]), team);
    expect(out.map((i) => [i.number, i.battingTeamId, i.runs, i.wickets, i.isComplete])).toEqual([[1, "team-1", 300, 10, true], [2, "team-2", 200, 10, true], [3, "team-1", 45, 2, false]]);
    expect(out[2]!.target).toBe(301);
  });

  it("does not guess the order when nothing is held and both sides have scores", () => {
    expect(mergeMultiDay([], list(["120/3", "30 ov"], ["95", null]), team)).toEqual([]);
  });

  it("starts the first innings when only one side has batted", () => {
    const out = mergeMultiDay([], list(["", null], ["88/2", "25 ov"]), team);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ battingTeamId: "team-2", runs: 88, wickets: 2, legalBalls: 150 });
  });

  it("completes every innings once the match is finished", () => {
    const out = mergeMultiDay([inn(1, "1", 300, 10, 500), inn(2, "2", 280, 4, 400)], list(["300", null], ["280/4", null], "Finished"), team);
    expect(out.every((i) => i.isComplete)).toBe(true);
  });
});

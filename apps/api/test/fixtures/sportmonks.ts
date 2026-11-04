import type { SmFixture } from "../../src/feed/sportmonks.js";

/** Sportmonks "score" objects, copied field-for-field from the provider's documented examples. */
export const S = {
  dot: { name: "No Run", runs: 0, four: false, six: false, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: false, ball: true, out: false },
  one: { name: "1 Run", runs: 1, four: false, six: false, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: false, ball: true, out: false },
  four: { name: "FOUR", runs: 4, four: true, six: false, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: false, ball: true, out: false },
  six: { name: "SIX", runs: 6, four: false, six: true, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: false, ball: true, out: false },
  wide: { name: "1 Wide", runs: 1, four: false, six: false, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: false, ball: false, out: false },
  fiveWides: { name: "5 Wide", runs: 5, four: false, six: false, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: false, ball: false, out: false },
  noBallPlusOne: { name: "1 No Ball + 1 Run", runs: 2, four: false, six: false, bye: 0, leg_bye: 0, noball: 1, noball_runs: 1, is_wicket: false, ball: true, out: false },
  bye: { name: "1 Bye", runs: 0, four: false, six: false, bye: 1, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: false, ball: true, out: false },
  legBye: { name: "1 Leg Bye", runs: 0, four: false, six: false, bye: 0, leg_bye: 1, noball: 0, noball_runs: 0, is_wicket: false, ball: true, out: false },
  byeRunOut: { name: "1 Bye + Run Out", runs: 0, four: false, six: false, bye: 1, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: true, ball: true, out: true },
  caught: { name: "Catch Out", runs: 0, four: false, six: false, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: true, ball: true, out: true },
  lbw: { name: "LBW OUT", runs: 0, four: false, six: false, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: true, ball: true, out: true },
  penalty: { name: "5 Penalty", runs: 5, four: false, six: false, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: false, ball: false, out: false },
};

/** Builds a small Sportmonks fixture: team 1 (players 1–11) bats first, team 2 (players 21–31) second. */
export function smFixture(over: Partial<SmFixture> = {}, extraBalls: SmFixture["balls"] = []): SmFixture {
  let id = 1000;
  const ball = (sb: string, team: number, ballNo: number, striker: number, non: number, bowler: number, score: object, more: object = {}) =>
    ({ id: id++, team_id: team, ball: ballNo, scoreboard: sb, batsman_one_on_creeze_id: striker, batsman_two_on_creeze_id: non, batsman_id: striker, bowler_id: bowler, batsmanout_id: null, catchstump_id: null, score, ...more });
  const person = (pid: number, team: number) => ({ id: pid, fullname: `Feed Player ${pid}`, lineup: { team_id: team, captain: pid === 1, wicketkeeper: pid === 2 } });
  return {
    id: 777001, type: "T20I", status: "2nd Innings", note: "", round: "1st T20I", starting_at: "2026-10-27T10:00:00.000000Z",
    localteam_id: 501, visitorteam_id: 502, toss_won_team_id: 501, elected: "batting", winner_team_id: null,
    localteam: { id: 501, name: "Feedland", code: "FDL", national_team: true }, visitorteam: { id: 502, name: "Synctopia", code: "SYN", national_team: true },
    venue: { id: 9, name: "Feed Oval", city: "Feedville" }, league: { id: 3, name: "Feed Series" }, season: { id: 2026, name: "2026" },
    lineup: [...Array.from({ length: 11 }, (_, k) => person(k + 1, 501)), ...Array.from({ length: 11 }, (_, k) => person(k + 21, 502))],
    balls: [
      ball("S1", 501, 0.1, 1, 2, 21, S.four),
      ball("S1", 501, 0.1, 1, 2, 21, S.wide), // wide shares the ball number with the next delivery
      ball("S1", 501, 0.2, 1, 2, 21, S.noBallPlusOne),
      ball("S1", 501, 0.2, 2, 1, 21, S.caught, { batsmanout_id: 2, catchstump_id: 22 }),
      ball("S1", 501, 0.3, 3, 1, 21, S.lbw), // no batsmanout_id: the striker is out
      ball("S1", 501, 0.4, 4, 1, 21, S.six),
      ball("S1", 501, 0.5, 4, 1, 21, S.legBye),
      ball("S1", 501, 0.6, 1, 4, 21, S.dot),
      ball("S2", 502, 0.1, 21, 22, 1, S.one),
      ball("S3", 502, 0.1, 21, 22, 1, S.six), // super over: excluded
      ...extraBalls as object[],
    ] as SmFixture["balls"],
    ...over,
  };
}


/** Same fixture, with team/player/venue/league ids offset so they're unique to this test run. */
export function uniqueFixture(base: number, tag: string, over: Partial<SmFixture> = {}, extra: SmFixture["balls"] = []) {
  const f = smFixture(over, extra);
  const off = (n: number | null) => (n == null ? null : n + base);
  const raw = f as unknown as Record<string, unknown>;
  const t = (x: { id: number; name: string }) => ({ ...x, id: x.id + base, name: `${x.name} ${tag}` });
  return {
    ...f,
    localteam_id: f.localteam_id + base, visitorteam_id: f.visitorteam_id + base, toss_won_team_id: off(f.toss_won_team_id ?? null), winner_team_id: off(f.winner_team_id ?? null),
    localteam: t(raw.localteam as { id: number; name: string }), visitorteam: t(raw.visitorteam as { id: number; name: string }),
    venue: { id: base, name: `Feed Oval ${tag}`, city: "Feedville" }, league: { id: base, name: `Feed Series ${tag}` },
    lineup: (f.lineup as { id: number; fullname: string; lineup: { team_id: number } }[]).map((p) => ({ ...p, id: p.id + base, fullname: `${p.fullname} ${tag}`, lineup: { ...p.lineup, team_id: p.lineup.team_id + base } })),
    balls: (f.balls as unknown as Record<string, number | null | object>[]).map((b) => ({
      ...b, id: (b.id as number) + base, team_id: (b.team_id as number) + base,
      batsman_one_on_creeze_id: off(b.batsman_one_on_creeze_id as number), batsman_two_on_creeze_id: off(b.batsman_two_on_creeze_id as number),
      batsman_id: off(b.batsman_id as number), bowler_id: off(b.bowler_id as number), batsmanout_id: off(b.batsmanout_id as number | null), catchstump_id: off(b.catchstump_id as number | null),
    })),
  } as unknown as SmFixture;
}

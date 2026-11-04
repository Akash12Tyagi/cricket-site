import type { HlRawMatch } from "../../src/feed/highlightly.js";

/** Synthetic Highlightly responses, field-for-field in the shape the real API returned on 27 Oct 2026. */
export function hlRaw(id: string, home: { id: number; name: string; abbr: string }, away: { id: number; name: string; abbr: string }, over: Partial<HlRawMatch> = {}): HlRawMatch {
  return {
    id, format: "T20", startTime: "2026-10-27T10:00:00.000Z", dayType: "SINGLE",
    state: { teams: { home: { info: null, score: null }, away: { info: null, score: null } }, report: "Match yet to begin", description: "Scheduled" },
    homeTeam: { id: home.id, name: home.name, abbreviation: home.abbr }, awayTeam: { id: away.id, name: away.name, abbreviation: away.abbr },
    league: { id: "777", name: "Highlight Cup", season: 2026 },
    ...over,
  };
}

const p = (id: string, name: string) => ({ id, name, roles: ["batter"], battingStyles: ["right-hand bat"], bowlingStyles: [] });

/** Full detail: home bats first (152/7 in 20 ov), away chasing 153 is 60/2 after 8 overs. */
export function hlDetail(id: string, home: { id: number; name: string; abbr: string }, away: { id: number; name: string; abbr: string }, tag: string): HlRawMatch {
  const H = (n: number) => p(`h${n}-${tag}`, `Home Bat ${n} ${tag}`), A = (n: number) => p(`a${n}-${tag}`, `Away Bat ${n} ${tag}`);
  return hlRaw(id, home, away, {
    state: { teams: { home: { info: "20/20 ov", score: "152/7" }, away: { info: "8/20 ov, T:153", score: "60/2" } }, report: "Away need 93 runs", description: "In play" },
    statistics: [
      { inningNumber: 2, team: { id: away.id, name: away.name, byes: 0, legByes: 1, wides: 1, noBalls: 0, extras: 2,
        inningBatsmen: [
          { runs: 30, balls: 20, fours: 3, sixes: 1, player: A(1), dismissalStatus: "bowled", dismissalBowler: { name: `Home Bat 9 ${tag}` }, dismissalFielders: [] },
          { runs: 20, balls: 18, fours: 2, sixes: 0, player: A(2), dismissalStatus: "caught", dismissalBowler: { name: `Home Bat 10 ${tag}` }, dismissalFielders: [{ name: `Home Bat 1 ${tag}` }] },
          { runs: 8, balls: 10, fours: 1, sixes: 0, player: A(3), dismissalStatus: "not out", dismissalBowler: null, dismissalFielders: [] },
        ],
        inningBowlers: [
          { overs: 4, player: { name: `Home Bat 9 ${tag}` }, maidens: 0, wickets: 1, concededRuns: 30 },
          { overs: 4, player: { name: `Home Bat 10 ${tag}` }, maidens: 0, wickets: 1, concededRuns: 28 },
        ],
        fallOfWickets: [{ runs: 35, order: 0, overs: 4.2, dismissalBatsman: { name: `Away Bat 1 ${tag}` } }, { runs: 52, order: 1, overs: 6.5, dismissalBatsman: { name: `Away Bat 2 ${tag}` } }],
      } },
      { inningNumber: 1, team: { id: home.id, name: home.name, byes: 1, legByes: 0, wides: 3, noBalls: 1, extras: 5,
        inningBatsmen: [
          { runs: 101, balls: 55, fours: 9, sixes: 6, player: H(1), dismissalStatus: "run out", dismissalBowler: { name: `Away Bat 9 ${tag}` }, dismissalFielders: [{ name: `Away Bat 4 ${tag}` }] },
          { runs: 46, balls: 65, fours: 3, sixes: 0, player: H(2), dismissalStatus: "lbw", dismissalBowler: { name: `Away Bat 9 ${tag}` }, dismissalFielders: [] },
        ],
        inningBowlers: [{ overs: 20, player: { name: `Away Bat 9 ${tag}` }, maidens: 1, wickets: 7, concededRuns: 152 }],
        fallOfWickets: [],
      } },
    ],
    squad: [
      { team: { id: home.id, name: home.name }, players: [1, 2, 9, 10].map((n) => ({ id: { id: `h${n}-${tag}` }, name: `Home Bat ${n} ${tag}`, roles: ["batter"], battingStyles: ["right-hand bat"], bowlingStyles: [] })) },
      { team: { id: away.id, name: away.name }, players: [1, 2, 3, 9].map((n) => ({ id: { id: `a${n}-${tag}` }, name: `Away Bat ${n} ${tag}`, roles: ["batter"], battingStyles: [], bowlingStyles: [] })) },
    ],
  });
}

import { readFile } from "node:fs/promises";
import type { DismissalType, ExtraType, MatchFormat, MatchStatus } from "@cricket/shared";
import { FeedError, type FeedBall, type FeedFixture, type FeedPlayer, type FeedProvider, type FeedTeam } from "./types.js";

/**
 * Sportmonks Cricket API v2.0 adapter (https://docs.sportmonks.com/v2/cricket-api), a licensed commercial feed.
 * Mapping verified against Sportmonks' published demo fixture (AUS v NZ T20I, id 20094): our engine reproduces
 * the provider's own innings totals (208/4 and 144/10). See test/feed-sportmonks.test.ts.
 */
const BASE = "https://cricket.sportmonks.com/api/v2.0";
const INCLUDE = "localteam,visitorteam,venue,league,season,lineup,balls.score,balls.batsman,balls.bowler,balls.catchstump,balls.batsmanout";

/* ───────────── Sportmonks JSON: only the fields we use ───────────── */
type SmList<T> = T[] | { data: T[] };
type SmScore = { name: string; runs: number; four: boolean; six: boolean; bye: number; leg_bye: number; noball: number; noball_runs: number; is_wicket: boolean; ball: boolean; out: boolean };
type SmPerson = { id: number; fullname: string; dateofbirth?: string | null; battingstyle?: string | null; bowlingstyle?: string | null; position?: { name?: string } | null; lineup?: { team_id: number; captain?: boolean; wicketkeeper?: boolean } };
type SmTeam = { id: number; name: string; code?: string | null; national_team?: boolean };
type SmBall = {
  id: number; team_id: number; ball: number; scoreboard: string;
  batsman_one_on_creeze_id: number | null; batsman_two_on_creeze_id: number | null;
  batsman_id: number; bowler_id: number; batsmanout_id: number | null; catchstump_id: number | null;
  score: SmScore | { data: SmScore };
  batsman?: SmPerson | { data: SmPerson }; bowler?: SmPerson | { data: SmPerson };
  catchstump?: SmPerson | { data: SmPerson } | null; batsmanout?: SmPerson | { data: SmPerson } | null;
};
export type SmFixture = {
  id: number; type: string; status: string; note?: string | null; round?: string | null; starting_at: string;
  localteam_id: number; visitorteam_id: number; toss_won_team_id?: number | null; elected?: string | null;
  winner_team_id?: number | null; super_over?: boolean; league_id?: number; season_id?: number;
  localteam?: SmTeam | { data: SmTeam }; visitorteam?: SmTeam | { data: SmTeam };
  venue?: { id: number; name: string; city?: string | null } | { data: { id: number; name: string; city?: string | null } } | null;
  league?: { id: number; name: string } | { data: { id: number; name: string } } | null;
  season?: { id: number; name: string } | { data: { id: number; name: string } } | null;
  lineup?: SmList<SmPerson>;
  balls?: SmList<SmBall>;
};

const one = <T>(v: T | { data: T } | null | undefined): T | null => (v == null ? null : typeof v === "object" && "data" in (v as object) ? (v as { data: T }).data : (v as T));
const list = <T>(v: SmList<T> | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : v.data ?? []);
const sid = (n: number | null | undefined) => (n == null ? null : String(n));

const FORMATS: Record<string, MatchFormat> = { T20I: "T20I", T20: "T20", T10: "T10", ODI: "ODI", Test: "TEST", "Test/5day": "TEST", "4day": "FIRST_CLASS", "List A": "LIST_A" };
const OVERS: Partial<Record<MatchFormat, number>> = { T20I: 20, T20: 20, T10: 10, ODI: 50, LIST_A: 50 };

export function mapStatus(s: string): MatchStatus {
  if (s === "NS") return "SCHEDULED";
  if (s === "Finished") return "COMPLETED";
  if (s === "Innings Break") return "INNINGS_BREAK";
  if (s.startsWith("Stump")) return "STUMPS";
  if (s === "Int." || s === "Delayed" || s === "Postp.") return "DELAYED";
  if (s === "Aban.") return "ABANDONED";
  if (s.startsWith("Cancl")) return "CANCELLED";
  return "LIVE"; // "1st Innings" … "4th Innings", Lunch, Tea Break, Dinner
}

const DISMISSALS: [RegExp, DismissalType][] = [
  [/^catch/i, "CAUGHT"], [/bowled/i, "BOWLED"], [/^lbw/i, "LBW"], [/stump/i, "STUMPED"], [/run out/i, "RUN_OUT"],
  [/hit wicket/i, "HIT_WICKET"], [/retired hurt|absent hurt/i, "RETIRED_HURT"], [/retired out/i, "RETIRED_OUT"],
  [/obstruct/i, "OBSTRUCTING_FIELD"], [/handled/i, "HANDLED_BALL"], [/timed out/i, "TIMED_OUT"], [/hit.*twice/i, "HIT_BALL_TWICE"],
];

/** One Sportmonks "score" event → our delivery fields. */
export function mapScore(s: SmScore, warnings: string[]): Pick<FeedBall, "runsBat" | "extraType" | "extraRuns" | "isBoundary" | "dismissal"> {
  let extraType: ExtraType | null = null, extraRuns = 0, runsBat = s.runs;
  if (/penalty/i.test(s.name)) { extraType = "PENALTY"; extraRuns = s.runs; runsBat = 0; }
  else if (s.noball > 0) { extraType = "NO_BALL"; extraRuns = s.noball_runs + s.bye + s.leg_bye; runsBat = Math.max(0, s.runs - s.noball_runs); }
  else if (/wide/i.test(s.name) || (!s.ball && s.runs > 0 && !s.is_wicket)) { extraType = "WIDE"; extraRuns = Math.max(1, s.runs); runsBat = 0; }
  else if (s.bye > 0) { extraType = "BYE"; extraRuns = s.bye; runsBat = 0; }
  else if (s.leg_bye > 0) { extraType = "LEG_BYE"; extraRuns = s.leg_bye; runsBat = 0; }
  let dismissal: DismissalType | null = null;
  if (s.is_wicket || /retired|absent/i.test(s.name)) {
    dismissal = DISMISSALS.find(([re]) => re.test(s.name))?.[1] ?? null;
    if (!dismissal) warnings.push(`unknown dismissal "${s.name}"`);
  }
  return { runsBat, extraType, extraRuns, isBoundary: (s.four && runsBat === 4) || (s.six && runsBat === 6), dismissal };
}

const person = (p: SmPerson, teamExtId: string | null): FeedPlayer => ({
  extId: String(p.id), fullName: p.fullname.trim(), teamExtId,
  dateOfBirth: p.dateofbirth ?? null,
  battingStyle: p.battingstyle?.replace(/-/g, " ") ?? null,
  bowlingStyle: p.bowlingstyle?.replace(/-/g, " ") ?? null,
  role: p.position?.name ?? null,
  isCaptain: !!p.lineup?.captain, isKeeper: !!p.lineup?.wicketkeeper,
});

const team = (t: SmTeam | null, id: number): FeedTeam => ({
  extId: String(id), name: t?.name ?? `Team ${id}`, shortName: (t?.code ?? t?.name?.slice(0, 3) ?? "TBC").toUpperCase().slice(0, 12), national: !!t?.national_team,
});

/** Full Sportmonks fixture (with INCLUDE) → provider-neutral fixture. Pure: no I/O, unit-tested. */
export function toFeedFixture(f: SmFixture): FeedFixture {
  const warnings: string[] = [];
  const format = FORMATS[f.type] ?? "T20";
  if (!FORMATS[f.type]) warnings.push(`unknown match type "${f.type}", treated as T20`);
  const limited = OVERS[format] != null;
  const local = team(one(f.localteam), f.localteam_id), visitor = team(one(f.visitorteam), f.visitorteam_id);
  const other = (teamExtId: string) => (teamExtId === local.extId ? visitor.extId : local.extId);

  const players = new Map<string, FeedPlayer>();
  for (const p of list(f.lineup)) players.set(String(p.id), person(p, sid(p.lineup?.team_id)));
  const addPlayer = (p: SmPerson | null, teamExtId: string) => { if (p && !players.has(String(p.id))) players.set(String(p.id), person(p, teamExtId)); };

  // Provider ids increase in the order deliveries were recorded; sort defensively (wides share a "ball" number).
  const raw = list(f.balls).slice().sort((a, b) => a.id - b.id);
  const balls: FeedBall[] = [];
  for (const b of raw) {
    const inningsNumber = Number(/^S(\d+)$/.exec(b.scoreboard)?.[1] ?? 0);
    if (!inningsNumber) { warnings.push(`unknown scoreboard "${b.scoreboard}"`); continue; }
    if (limited && inningsNumber > 2) continue; // super over: not shown (same rule as the Cricsheet import)
    const batting = String(b.team_id), bowling = other(batting);
    addPlayer(one(b.batsman), batting);
    addPlayer(one(b.bowler), bowling);
    addPlayer(one(b.catchstump ?? null), bowling);
    addPlayer(one(b.batsmanout ?? null), batting);
    const score = one(b.score);
    if (!score) { warnings.push(`ball ${b.id} has no score`); continue; }
    const mapped = mapScore(score, warnings);
    const striker = String(b.batsman_id);
    const pair = [sid(b.batsman_one_on_creeze_id), sid(b.batsman_two_on_creeze_id)];
    const nonStriker = pair.find((x) => x && x !== striker) ?? null;
    if (!nonStriker) { warnings.push(`ball ${b.id} has no non-striker`); continue; }
    balls.push({
      extId: String(b.id), inningsNumber, battingTeamExtId: batting,
      strikerExtId: striker, nonStrikerExtId: nonStriker, bowlerExtId: String(b.bowler_id),
      ...mapped,
      // Not every wicket names the batter out (e.g. LBW): then it is the striker.
      dismissedExtId: mapped.dismissal ? sid(b.batsmanout_id) ?? striker : null,
      fielderExtId: mapped.dismissal && ["CAUGHT", "STUMPED", "RUN_OUT"].includes(mapped.dismissal) ? sid(b.catchstump_id) : null,
    });
  }

  const venue = one(f.venue ?? null), league = one(f.league ?? null), season = one(f.season ?? null);
  const status = mapStatus(f.status);
  return {
    provider: "sportmonks",
    extId: String(f.id),
    format, status,
    startsAt: new Date(f.starting_at),
    oversPerInnings: OVERS[format] ?? null,
    round: f.round ?? null,
    teams: [local, visitor],
    venue: venue ? { extId: String(venue.id), name: venue.name, city: venue.city ?? null } : null,
    series: league ? { extId: `${league.id}-${season?.id ?? f.season_id ?? ""}`, name: league.name, season: season?.name ?? null } : null,
    tossWinnerExtId: sid(f.toss_won_team_id),
    tossDecision: f.elected === "batting" ? "bat" : f.elected === "bowling" ? "bowl" : null,
    winnerExtId: sid(f.winner_team_id),
    resultText: f.note?.trim() || null,
    players: [...players.values()],
    balls,
    warnings,
  };
}

export function createSportmonksProvider(token: string, fetchImpl: typeof fetch = fetch): FeedProvider {
  const get = async <T>(path: string, params: Record<string, string>): Promise<T> => {
    const qs = new URLSearchParams({ ...params, api_token: token });
    const res = await fetchImpl(`${BASE}${path}?${qs}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new FeedError("sportmonks", res.status, Number(res.headers.get("retry-after")) || null);
    return (await res.json()) as T;
  };
  return {
    name: "sportmonks",
    async liveFixtures() {
      const body = await get<{ data: SmFixture[] }>("/livescores", { include: INCLUDE });
      return (body.data ?? []).map(toFeedFixture);
    },
    async fixture(extId) {
      if (!/^\d+$/.test(extId)) return null;
      try { return toFeedFixture((await get<{ data: SmFixture }>(`/fixtures/${extId}`, { include: INCLUDE })).data); }
      catch (err) { if (err instanceof FeedError && err.status === 404) return null; throw err; }
    },
  };
}

/** Development/testing: replays a saved Sportmonks response file (single fixture or livescores list) as if live. */
export function createSportmonksFileProvider(path: string): FeedProvider {
  const load = async () => {
    const body = JSON.parse(await readFile(path, "utf8")) as { data: SmFixture | SmFixture[] };
    return (Array.isArray(body.data) ? body.data : [body.data]).map(toFeedFixture);
  };
  return {
    name: "sportmonks",
    liveFixtures: load,
    async fixture(extId) { return (await load()).find((f) => f.extId === extId) ?? null; },
  };
}

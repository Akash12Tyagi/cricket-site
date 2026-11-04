import type { DismissalType, MatchStatus } from "@cricket/shared";
import { FeedError } from "./types.js";

/**
 * Highlightly Cricket API (https://highlightly.net/cricket-api, OpenAPI at /cricket-api/documentation/docs.json).
 * Licensed provider with a free plan (100 requests/day). It sends fixtures, live state (score, overs, target) and full
 * scorecards, but not deliveries, so these matches run in "scorecard mode" (see scorecard-sync.ts).
 * Shapes below were verified against real responses on 27 Oct 2026.
 */
const BASE = "https://cricket.highlightly.net";

/* ───────────── Raw response types (only the fields we use) ───────────── */
type HlTeam = { id: string | number; name: string; abbreviation?: string | null };
type HlSideState = { info: string | null; score: string | null };
export type HlRawMatch = {
  id: string; format: string; startTime: string; startDate?: string; dayType?: string;
  state: { teams: { home: HlSideState; away: HlSideState }; report: string | null; description: string };
  homeTeam: HlTeam; awayTeam: HlTeam;
  league?: { id: string; name: string; season?: number | null } | null;
  venue?: { name: string | null; city: string | null; country: string | null } | null;
  statistics?: HlRawInnings[] | null;
  squad?: { team: HlTeam; players: { id: { id: string } | string; name: string; roles?: string[]; battingStyles?: string[]; bowlingStyles?: string[] }[] }[] | null;
};
type HlPlayerRef = { id?: string; name: string; roles?: string[]; battingStyles?: string[]; bowlingStyles?: string[] };
type HlRawInnings = {
  inningNumber?: number;
  team: HlTeam & {
    byes?: number; legByes?: number; wides?: number; noBalls?: number; extras?: number;
    inningBatsmen?: { runs: number; balls: number; fours: number; sixes: number; player: HlPlayerRef; dismissalStatus?: string | null; dismissalBowler?: { name: string } | null; dismissalFielders?: { name: string }[] | null }[];
    inningBowlers?: { overs: number; player: HlPlayerRef; maidens: number; wickets: number; concededRuns: number }[];
    fallOfWickets?: { runs: number; order: number; overs: number; dismissalBatsman: { name: string } }[];
  };
};

/* ───────────── Normalised shapes ───────────── */
export type HlSide = { extId: string; name: string; abbreviation: string; scores: { runs: number; wickets: number; declared: boolean }[]; overs: string | null; maxOvers: number | null; target: number | null };
export type HlMatch = {
  extId: string; formatRaw: string; status: MatchStatus; startsAt: Date; multiDay: boolean;
  league: { extId: string; name: string; season: string | null } | null;
  venue: { name: string; city: string | null } | null;
  home: HlSide; away: HlSide;
  resultText: string | null; winnerExtId: string | null; description: string;
};
export type HlBatter = { name: string; extId: string | null; runs: number; balls: number; fours: number; sixes: number; out: DismissalType | null; bowlerName: string | null; fielderName: string | null };
export type HlBowler = { name: string; extId: string | null; legalBalls: number; maidens: number; runs: number; wickets: number };
export type HlInnings = {
  number: number; battingExtId: string;
  extras: { byes: number; legByes: number; wides: number; noBalls: number; total: number };
  batters: HlBatter[]; bowlers: HlBowler[];
  fallOfWickets: { wicket: number; runs: number; legalBalls: number; name: string }[];
};
export type HlPlayer = { extId: string; name: string; teamExtId: string; role: string | null; battingStyle: string | null; bowlingStyle: string | null };
export type HlDetail = HlMatch & { innings: HlInnings[]; players: HlPlayer[]; warnings: string[] };

/** "8.4" overs → 52 balls. */
export const oversToBalls = (overs: number | string, perOver = 6) => {
  const [o, b] = String(overs).split(".");
  return Number(o || 0) * perOver + Number(b || 0);
};

/** "243/9", "241", "250/8d", "350 & 120/3" → innings scores (no wicket count = all out). */
export function parseScore(score: string | null): HlSide["scores"] {
  if (!score) return [];
  return score.split("&").map((part) => {
    const m = /(\d+)(?:\/(\d+))?\s*(d)?/.exec(part.trim());
    return m ? { runs: Number(m[1]), wickets: m[2] != null ? Number(m[2]) : 10, declared: !!m[3] } : null;
  }).filter((x): x is HlSide["scores"][number] => !!x);
}

/** "47.1/50 ov, T:242" → overs "47.1", maxOvers 50, target 242. */
export function parseInfo(info: string | null) {
  const overs = info ? /(\d+(?:\.\d)?)(?:\/(\d+))?\s*ov/.exec(info) : null;
  const target = info ? /T:\s*(\d+)/.exec(info) : null;
  return { overs: overs?.[1] ?? null, maxOvers: overs?.[2] ? Number(overs[2]) : null, target: target ? Number(target[1]) : null };
}

export function mapHlStatus(description: string, report: string | null): MatchStatus {
  const d = description.toLowerCase();
  if (d === "finished" || d === "completed" || d === "result") return /no result|abandon/i.test(report ?? "") ? "ABANDONED" : "COMPLETED";
  if (d.includes("abandon")) return "ABANDONED";
  if (d.includes("cancel")) return "CANCELLED";
  if (d.includes("innings break")) return "INNINGS_BREAK";
  if (d.includes("stump")) return "STUMPS";
  if (d.includes("postpon")) return /no result/i.test(report ?? "") ? "ABANDONED" : "DELAYED";
  if (d.includes("delay") || d.includes("rain") || d.includes("interrupt") || d.includes("bad light")) return "DELAYED";
  if (d.includes("toss")) return "TOSS";
  if (d === "scheduled" || d.includes("not started") || d === "no live coverage") return "SCHEDULED";
  return "LIVE"; // "In play", "Lunch", "Tea", "Drinks", …
}

const DISMISSALS: [RegExp, DismissalType][] = [
  [/^caught|^c\b/i, "CAUGHT"], [/^bowled/i, "BOWLED"], [/^lbw/i, "LBW"], [/run ?out/i, "RUN_OUT"], [/stumped/i, "STUMPED"],
  [/hit wicket/i, "HIT_WICKET"], [/retired hurt|retired not out/i, "RETIRED_HURT"], [/retired out|retired$/i, "RETIRED_OUT"],
  [/obstruct/i, "OBSTRUCTING_FIELD"], [/handled/i, "HANDLED_BALL"], [/timed out/i, "TIMED_OUT"], [/hit.*twice/i, "HIT_BALL_TWICE"],
];
export function mapDismissal(status: string | null | undefined, warnings: string[]): DismissalType | null {
  if (!status || /not out|did not bat|^dnb$|batting/i.test(status)) return null;
  const hit = DISMISSALS.find(([re]) => re.test(status.trim()))?.[1];
  if (!hit) warnings.push(`unknown dismissal "${status}"`);
  return hit ?? null;
}

/** "Skyhawks won by 4 wickets" → which side won (matches full name, last word of name, or abbreviation). */
function winner(report: string | null, home: HlTeam, away: HlTeam): string | null {
  const who = report ? /^(.+?)\s+won\b/i.exec(report.trim())?.[1]?.toLowerCase() : null;
  if (!who) return null;
  const fits = (t: HlTeam) => [t.name, t.name.split(" ").at(-1) ?? "", t.abbreviation ?? ""].some((n) => n && n.toLowerCase() === who) || t.name.toLowerCase().startsWith(who);
  const h = fits(home), a = fits(away);
  return h && !a ? String(home.id) : a && !h ? String(away.id) : null;
}

/** When the result names a team by a short form we can't match ("P.N.G."), the winner has the higher aggregate (not under DLS). */
function winnerByScore(report: string | null, home: HlSide, away: HlSide): string | null {
  if (!report || !/\bwon\b/i.test(report) || /DLS|D\/L|VJD|super over|awarded|forfeit/i.test(report)) return null;
  const sum = (x: HlSide) => x.scores.reduce((n, sc) => n + sc.runs, 0);
  return sum(home) > sum(away) ? home.extId : sum(away) > sum(home) ? away.extId : null;
}

function side(t: HlTeam, st: HlSideState): HlSide {
  const info = parseInfo(st.info);
  return { extId: String(t.id), name: t.name.trim(), abbreviation: (t.abbreviation ?? t.name.slice(0, 3)).toUpperCase().slice(0, 12), scores: parseScore(st.score), ...info };
}

/** List item (or detail) → normalised match. Pure; unit-tested. */
export function toHlMatch(m: HlRawMatch): HlMatch {
  const status = mapHlStatus(m.state.description, m.state.report);
  const home = side(m.homeTeam, m.state.teams.home), away = side(m.awayTeam, m.state.teams.away);
  return {
    extId: String(m.id), formatRaw: m.format, status, startsAt: new Date(m.startTime), multiDay: m.dayType === "MULTI" || /test|first/i.test(m.format),
    league: m.league ? { extId: String(m.league.id), name: m.league.name.trim(), season: m.league.season != null ? String(m.league.season) : null } : null,
    venue: m.venue?.name ? { name: m.venue.name, city: m.venue.city } : null,
    home, away,
    resultText: status === "COMPLETED" || status === "ABANDONED" ? m.state.report?.trim() || null : null,
    winnerExtId: status === "COMPLETED" ? winner(m.state.report, m.homeTeam, m.awayTeam) ?? winnerByScore(m.state.report, home, away) : null,
    description: m.state.description,
  };
}

const playerId = (p: { id?: unknown }) => (typeof p.id === "string" ? p.id : (p.id as { id?: string } | undefined)?.id ?? null);

/** Match detail with scorecard → normalised detail. Pure; unit-tested. */
export function toHlDetail(m: HlRawMatch): HlDetail {
  const base = toHlMatch(m);
  const warnings: string[] = [];
  const innings: HlInnings[] = (m.statistics ?? []).map((s, k) => ({
    number: s.inningNumber != null ? s.inningNumber + (s.inningNumber === 0 ? 1 : 0) : k + 1,
    battingExtId: String(s.team.id),
    extras: { byes: s.team.byes ?? 0, legByes: s.team.legByes ?? 0, wides: s.team.wides ?? 0, noBalls: s.team.noBalls ?? 0, total: s.team.extras ?? 0 },
    batters: (s.team.inningBatsmen ?? []).map((b) => ({
      name: b.player.name.trim(), extId: playerId(b.player), runs: b.runs ?? 0, balls: b.balls ?? 0, fours: b.fours ?? 0, sixes: b.sixes ?? 0,
      out: mapDismissal(b.dismissalStatus, warnings), bowlerName: b.dismissalBowler?.name?.trim() ?? null, fielderName: b.dismissalFielders?.[0]?.name?.trim() ?? null,
    })),
    bowlers: (s.team.inningBowlers ?? []).map((b) => ({
      name: b.player.name.trim(), extId: playerId(b.player), legalBalls: oversToBalls(b.overs ?? 0), maidens: b.maidens ?? 0, runs: b.concededRuns ?? 0, wickets: b.wickets ?? 0,
    })),
    fallOfWickets: (s.team.fallOfWickets ?? []).map((f) => ({ wicket: f.order + 1, runs: f.runs, legalBalls: oversToBalls(f.overs), name: f.dismissalBatsman.name.trim() })),
  }));
  // Statistics may come in either order; sort by innings number so the batting order is right.
  innings.sort((a, b) => a.number - b.number);
  innings.forEach((inn, k) => { inn.number = k + 1; });
  const players: HlPlayer[] = [];
  for (const sq of m.squad ?? []) for (const p of sq.players) {
    const extId = playerId(p);
    if (extId) players.push({ extId, name: p.name.trim(), teamExtId: String(sq.team.id), role: (p.roles ?? [])[0] ?? null, battingStyle: (p.battingStyles ?? [])[0] ?? null, bowlingStyle: (p.bowlingStyles ?? [])[0] ?? null });
  }
  return { ...base, innings, players, warnings };
}

/** HTTP client. The key travels only in a header; errors never include it. Tracks the plan's remaining daily requests. */
export function createHighlightlyClient(key: string, fetchImpl: typeof fetch = fetch) {
  const quota = { limit: null as number | null, remaining: null as number | null, at: 0 };
  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetchImpl(`${BASE}${path}${qs ? `?${qs}` : ""}`, { headers: { accept: "application/json", "x-rapidapi-key": key }, signal: AbortSignal.timeout(15_000) });
    const lim = res.headers.get("x-ratelimit-requests-limit"), rem = res.headers.get("x-ratelimit-requests-remaining");
    if (rem != null) { quota.remaining = Number(rem); quota.limit = lim != null ? Number(lim) : quota.limit; quota.at = Date.now(); }
    if (!res.ok) throw new FeedError("highlightly", res.status, Number(res.headers.get("retry-after")) || null);
    return (await res.json()) as T;
  }
  return {
    quota,
    /** All matches starting on a UTC date (fixtures, live state and results in one request). */
    async matchesOn(date: string): Promise<HlMatch[]> {
      const out: HlMatch[] = [];
      for (let offset = 0; offset < 500; offset += 100) {
        const r = await get<{ data: HlRawMatch[]; pagination?: { totalCount?: number } }>("/matches", { date, limit: "100", offset: String(offset) });
        out.push(...(r.data ?? []).map(toHlMatch));
        if ((r.pagination?.totalCount ?? 0) <= offset + 100) break;
      }
      return out;
    },
    async detail(extId: string): Promise<HlDetail | null> {
      if (!/^\d+$/.test(extId)) return null;
      try {
        const r = await get<HlRawMatch[] | { data: HlRawMatch | HlRawMatch[] } | HlRawMatch>(`/matches/${extId}`);
        const raw = Array.isArray(r) ? r[0] : "data" in r ? (Array.isArray(r.data) ? r.data[0] : r.data) : r;
        return raw ? toHlDetail(raw as HlRawMatch) : null;
      } catch (err) { if (err instanceof FeedError && err.status === 404) return null; throw err; }
    },
  };
}
export type HighlightlyClient = ReturnType<typeof createHighlightlyClient>;

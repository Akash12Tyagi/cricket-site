import { and, between, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { innings, matches, matchPlayers, teams, type Database } from "@cricket/db";
import type { BatterLine, BowlerLine, FallOfWicket, MatchFormat, StoredInnings, StoredScorecard } from "@cricket/shared";
import { refreshSnapshot } from "../services/snapshot.js";
import { oversToBalls, type HlDetail, type HlMatch, type HlSide } from "./highlightly.js";
import { resolveBySlug, resolvePlayer, resolveTeam, slugify } from "./sync.js";

const PROVIDER = "highlightly";
const DONE = new Set(["COMPLETED", "ABANDONED", "CANCELLED"]);
const LIMITED_OVERS: Record<string, number> = { T20: 20, T10: 10, ODI: 50, HUNDRED: 20 };

export type ScorecardSyncResult = { matchId: string | null; slug: string | null; changed: boolean; skipped?: "paused" | "duplicate" | "not_linked" };

/** Provider format + whether both sides are international teams in our database → our format. */
export function mapFormat(raw: string, international: boolean): MatchFormat {
  const f = raw.toUpperCase();
  if (f.includes("TEST")) return international ? "TEST" : "FIRST_CLASS";
  if (f === "ODI" || f.includes("LIST")) return international ? "ODI" : "LIST_A";
  if (f === "T10") return "T10";
  if (f.includes("HUNDRED") || f === "100") return "HUNDRED";
  return international ? "T20I" : "T20";
}

/**
 * Innings from the live state only (before or between full scorecards): limited-overs order is known from the target
 * (the chasing side bats second). Multi-day matches need the full scorecard for the order, so none are guessed here.
 */
export function stateInnings(m: HlMatch, teamId: (ext: string) => string, maxOvers: number | null): StoredInnings[] {
  if (m.multiDay) return [];
  const sides = [m.home, m.away].filter((s) => s.scores.length);
  if (!sides.length) return [];
  const second = sides.find((s) => s.target != null) ?? (sides.length === 2 ? null : undefined);
  const order: HlSide[] = sides.length === 1 ? sides : second ? [sides.find((s) => s !== second)!, second] : sides;
  if (sides.length === 2 && !second) return []; // can't tell who batted first: wait for the scorecard
  const done = DONE.has(m.status);
  return order.map((s, k) => {
    const other = s === m.home ? m.away : m.home;
    const sc = s.scores[0]!;
    const balls = s.overs ? oversToBalls(s.overs) : 0;
    return {
      number: k + 1, battingTeamId: teamId(s.extId), bowlingTeamId: teamId(other.extId),
      isComplete: done || k < order.length - 1 || sc.wickets >= 10 || (maxOvers != null && balls >= (s.maxOvers ?? maxOvers) * 6),
      isDeclared: sc.declared, target: s.target, runs: sc.runs, wickets: sc.wickets, legalBalls: balls,
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0, total: 0 }, batters: [], bowlers: [], fallOfWickets: [],
    };
  });
}

/**
 * Multi-day matches (Tests, first-class): updates the innings we already hold from the list view's score lines, so a
 * live Ranji scoreline keeps moving between the rare full-scorecard fetches. A team's k-th score line is its k-th
 * innings. An innings that began since the last full scorecard is added with totals only (its batting card fills in on
 * the next scorecard fetch); the order of new innings follows the game: sides alternate, so the next to bat is the one
 * that did not bat last. When the order can't be told (nothing held yet, both teams already batting) nothing is guessed.
 */
export function mergeMultiDay(prev: StoredInnings[], m: HlMatch, teamId: (ext: string) => string): StoredInnings[] {
  const out = prev.map((i) => ({ ...i }));
  const sides = [m.home, m.away];
  const added: { side: HlSide; teamId: string; sc: HlSide["scores"][number] }[] = [];
  for (const side of sides) {
    const tid = teamId(side.extId);
    const mine = out.filter((i) => i.battingTeamId === tid);
    side.scores.forEach((sc, k) => {
      const inn = mine[k];
      if (inn) { inn.runs = sc.runs; inn.wickets = sc.wickets; inn.isDeclared = sc.declared; }
      else added.push({ side, teamId: tid, sc });
    });
  }
  const sequence: typeof added = [];
  let lastBatting = out.at(-1)?.battingTeamId ?? null;
  const pending = [...added];
  if (out.length === 0 && pending.length > 1) return out; // both sides have scores but we don't know who batted first
  while (pending.length) {
    const k = Math.max(0, pending.findIndex((a) => a.teamId !== lastBatting));
    const [next] = pending.splice(k, 1);
    sequence.push(next!); lastBatting = next!.teamId;
  }
  for (const a of sequence) {
    const bowling = a.side === m.home ? m.away : m.home;
    out.push({
      number: out.length + 1, battingTeamId: a.teamId, bowlingTeamId: teamId(bowling.extId), isComplete: false, isDeclared: a.sc.declared, target: null,
      runs: a.sc.runs, wickets: a.sc.wickets, legalBalls: 0, extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0, total: 0 },
      batters: [], bowlers: [], fallOfWickets: [],
    });
  }
  // The side at the crease has the live "overs / target" line; it belongs to the latest innings.
  const last = out.at(-1);
  if (last) {
    const batting = sides.find((sd) => teamId(sd.extId) === last.battingTeamId);
    if (batting?.overs) last.legalBalls = Math.max(last.legalBalls, oversToBalls(batting.overs));
    if (batting?.target != null) last.target = batting.target;
  }
  const done = DONE.has(m.status);
  out.forEach((i, k) => { i.isComplete = k < out.length - 1 || done || i.wickets >= 10 || i.isDeclared; });
  return out;
}

/**
 * Writes one Highlightly match (list item, or detail with scorecard) idempotently.
 * Skips matches we already hold from another source (e.g. the same match imported ball by ball from Cricsheet).
 */
export async function syncHlMatch(db: Database, redis: Redis, m: HlMatch | HlDetail, opts: { autoCreate: boolean }): Promise<ScorecardSyncResult> {
  const [existing] = await db.select({ id: matches.id, slug: matches.slug, paused: matches.feedPaused }).from(matches)
    .where(and(eq(matches.feedProvider, PROVIDER), eq(matches.feedMatchId, m.extId))).limit(1);
  if (existing?.paused) return { matchId: existing.id, slug: existing.slug, changed: false, skipped: "paused" };
  if (!existing && !opts.autoCreate) return { matchId: null, slug: null, changed: false, skipped: "not_linked" };

  const homeId = await resolveTeam(db, PROVIDER, { extId: m.home.extId, name: m.home.name, shortName: m.home.abbreviation, national: false });
  const awayId = await resolveTeam(db, PROVIDER, { extId: m.away.extId, name: m.away.name, shortName: m.away.abbreviation, national: false });
  if (homeId === awayId) return { matchId: null, slug: null, changed: false, skipped: "duplicate" };
  const teamId = (ext: string) => (ext === m.home.extId ? homeId : awayId);

  if (!existing) {
    // Same two teams within a day from any other source (Cricsheet, another feed, a scorer) → that match wins.
    const [dup] = await db.select({ id: matches.id }).from(matches).where(and(
      or(and(eq(matches.team1Id, homeId), eq(matches.team2Id, awayId)), and(eq(matches.team1Id, awayId), eq(matches.team2Id, homeId))),
      between(matches.startsAt, new Date(m.startsAt.getTime() - 36 * 3600_000), new Date(m.startsAt.getTime() + 36 * 3600_000)),
      or(isNull(matches.feedProvider), ne(matches.feedProvider, PROVIDER)),
    )).limit(1);
    if (dup) return { matchId: dup.id, slug: null, changed: false, skipped: "duplicate" };
  }

  const kinds = await db.select({ id: teams.id, kind: teams.kind }).from(teams).where(or(eq(teams.id, homeId), eq(teams.id, awayId)));
  const international = kinds.length === 2 && kinds.every((k) => k.kind.startsWith("INTERNATIONAL"));
  const format = mapFormat(m.formatRaw, international);
  const oversPerInnings = m.multiDay ? null : (m.home.maxOvers ?? m.away.maxOvers ?? LIMITED_OVERS[m.formatRaw.toUpperCase()] ?? null);
  const seriesId = m.league
    ? await resolveBySlug(db, PROVIDER, "series", `${m.league.extId}`, slugify(`${m.league.name}-${m.league.season ?? ""}`), { name: m.league.name.slice(0, 160), season: m.league.season })
    : null;
  const venueId = m.venue ? await resolveBySlug(db, PROVIDER, "venue", slugify(m.venue.name), slugify(m.venue.name), { name: m.venue.name.slice(0, 160), city: m.venue.city?.slice(0, 80) ?? null }) : null;

  // Players (only details carry them). Bowlers come with names only: matched within that innings' bowling side.
  const playerIds = new Map<string, string>(); // `${teamExt}|${lower name}` → our id
  const key = (teamExt: string, name: string) => `${teamExt}|${name.toLowerCase()}`;
  let scorecard: StoredScorecard | null = null;
  if ("innings" in m && (m.players.length || m.innings.length)) {
    for (const p of m.players) {
      playerIds.set(key(p.teamExtId, p.name), await resolvePlayer(db, PROVIDER, { extId: p.extId, fullName: p.name, teamExtId: p.teamExtId, dateOfBirth: null, battingStyle: p.battingStyle, bowlingStyle: p.bowlingStyle, role: p.role }));
    }
    const ensure = async (teamExt: string, name: string, extId: string | null) => {
      const k = key(teamExt, name);
      if (!playerIds.has(k)) {
        const id = extId ?? `name:${teamExt}:${slugify(name)}`.slice(0, 40);
        playerIds.set(k, await resolvePlayer(db, PROVIDER, { extId: id, fullName: name, teamExtId: teamExt, dateOfBirth: null, battingStyle: null, bowlingStyle: null, role: null }));
      }
      return playerIds.get(k)!;
    };
    const stored: StoredInnings[] = [];
    for (const inn of m.innings) {
      const batExt = inn.battingExtId, bowlExt = batExt === m.home.extId ? m.away.extId : m.home.extId;
      const batters: BatterLine[] = [];
      for (const b of inn.batters) {
        batters.push({
          playerId: await ensure(batExt, b.name, b.extId), runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, out: b.out,
          outBowlerId: b.out && b.bowlerName && !["RUN_OUT", "RETIRED_HURT", "RETIRED_OUT", "TIMED_OUT", "OBSTRUCTING_FIELD", "HANDLED_BALL"].includes(b.out) ? await ensure(bowlExt, b.bowlerName, null) : null,
          outFielderId: b.out && b.fielderName ? await ensure(bowlExt, b.fielderName, null) : null,
        });
      }
      const bowlers: BowlerLine[] = [];
      for (const b of inn.bowlers) bowlers.push({ playerId: await ensure(bowlExt, b.name, b.extId), legalBalls: b.legalBalls, maidens: b.maidens, runs: b.runs, wickets: b.wickets, wides: 0, noBalls: 0 });
      const fallOfWickets: FallOfWicket[] = [];
      for (const f of inn.fallOfWickets) fallOfWickets.push({ wicket: f.wicket, runs: f.runs, legalBalls: f.legalBalls, playerId: await ensure(batExt, f.name, null) });
      const side = batExt === m.home.extId ? m.home : m.away;
      const nthForSide = m.innings.filter((x) => x.battingExtId === batExt && x.number <= inn.number).length;
      const live = side.scores[nthForSide - 1]; // the state line is the authority for totals
      const runs = live?.runs ?? batters.reduce((n, b) => n + b.runs, 0) + inn.extras.total;
      const wickets = live?.wickets ?? batters.filter((b) => b.out && b.out !== "RETIRED_HURT").length;
      const legalBalls = bowlers.reduce((n, b) => n + b.legalBalls, 0);
      const isLast = inn.number === m.innings.length;
      stored.push({
        number: inn.number, battingTeamId: teamId(batExt), bowlingTeamId: teamId(bowlExt),
        isComplete: !isLast || DONE.has(m.status) || wickets >= 10 || (oversPerInnings != null && legalBalls >= oversPerInnings * 6) || (live?.declared ?? false),
        isDeclared: live?.declared ?? false, target: isLast ? side.target : null,
        runs, wickets, legalBalls,
        extras: { wides: inn.extras.wides, noBalls: inn.extras.noBalls, byes: inn.extras.byes, legByes: inn.extras.legByes, penalty: 0, total: inn.extras.total },
        batters, bowlers, fallOfWickets,
      });
    }
    scorecard = { source: PROVIDER, updatedAt: new Date().toISOString(), innings: stored };
  }

  const title = `${m.home.name} vs ${m.away.name}${m.league ? `, ${m.league.name}` : ""}`.slice(0, 160);
  const values = {
    seriesId, venueId, format, status: m.status, startsAt: m.startsAt, oversPerInnings,
    resultText: m.resultText?.slice(0, 200) ?? null, winnerId: m.winnerExtId ? teamId(m.winnerExtId) : null,
  };

  return db.transaction(async (tx) => {
    let matchId = existing?.id;
    const created = !matchId;
    if (!matchId) {
      const slug = `${slugify(`${m.home.name}-vs-${m.away.name}-${m.league?.name ?? ""}`).slice(0, 180)}-hl${m.extId}`;
      const [row] = await tx.insert(matches).values({ ...values, team1Id: homeId, team2Id: awayId, title, slug, feedProvider: PROVIDER, feedMatchId: m.extId })
        .onConflictDoNothing().returning({ id: matches.id });
      if (!row) return { matchId: null, slug: null, changed: false };
      matchId = row.id;
    }
    const [cur] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
    if (cur!.feedPaused) return { matchId, slug: cur!.slug, changed: false, skipped: "paused" as const };
    // Keep the last full scorecard if this round only had the list view; refresh its totals from the live state.
    const previous = (cur!.scorecard as StoredScorecard | null) ?? null;
    const base = scorecard ?? (previous ? { ...previous } : null);
    let inns = base?.innings ?? stateInnings(m, teamId, oversPerInnings);
    if (!scorecard && m.multiDay) {
      inns = mergeMultiDay(inns, m, teamId);
    } else if (!scorecard && previous) {
      const fromState = stateInnings(m, teamId, oversPerInnings);
      inns = inns.map((i) => {
        const s = fromState.find((x) => x.battingTeamId === i.battingTeamId && x.number === i.number);
        return s ? { ...i, runs: s.runs, wickets: s.wickets, legalBalls: Math.max(i.legalBalls, s.legalBalls), isComplete: s.isComplete || i.isComplete, target: s.target ?? i.target } : i;
      });
      for (const s of fromState) if (!inns.some((i) => i.number === s.number)) inns.push(s);
    }
    const nextCard: StoredScorecard | null = inns.length ? { source: PROVIDER, updatedAt: (scorecard ?? previous)?.updatedAt ?? new Date().toISOString(), innings: inns } : null;

    const sameCard = JSON.stringify(previous?.innings ?? null) === JSON.stringify(nextCard?.innings ?? null);
    const sameMeta = Object.entries(values).every(([k, v]) => {
      const c = (cur as Record<string, unknown>)[k];
      return c instanceof Date && v instanceof Date ? c.getTime() === v.getTime() : (c ?? null) === (v ?? null);
    });
    if (sameCard && sameMeta && !created) {
      await tx.update(matches).set({ feedSyncedAt: new Date() }).where(eq(matches.id, matchId));
      return { matchId, slug: cur!.slug, changed: false };
    }

    await tx.update(matches).set({ ...values, scorecard: nextCard, feedSyncedAt: new Date(), version: sql`${matches.version} + 1` }).where(eq(matches.id, matchId));
    // Innings rows mirror the totals (lists and other queries read these).
    for (const i of nextCard?.innings ?? []) {
      const row = { battingTeamId: i.battingTeamId, bowlingTeamId: i.bowlingTeamId, runs: i.runs, wickets: Math.min(i.wickets, 10), legalBalls: i.legalBalls, extras: i.extras.total, target: i.target, isDeclared: i.isDeclared, isComplete: i.isComplete };
      await tx.insert(innings).values({ matchId, number: i.number, ...row }).onConflictDoUpdate({ target: [innings.matchId, innings.number], set: row });
    }
    const squad = new Map<string, string>();
    for (const i of nextCard?.innings ?? []) {
      for (const b of i.batters) squad.set(b.playerId, i.battingTeamId);
      for (const b of i.bowlers) squad.set(b.playerId, i.bowlingTeamId);
    }
    if ("players" in m) for (const p of m.players) { const id = playerIds.get(key(p.teamExtId, p.name)); if (id) squad.set(id, teamId(p.teamExtId)); }
    if (squad.size) await tx.insert(matchPlayers).values([...squad].map(([playerId, t]) => ({ matchId: matchId!, playerId, teamId: t, isPlayingXi: true }))).onConflictDoNothing();
    return { matchId, slug: cur!.slug, changed: true };
  }).then(async (r) => {
    if (r.changed && r.matchId) await refreshSnapshot(db, redis, r.matchId);
    return r;
  });
}

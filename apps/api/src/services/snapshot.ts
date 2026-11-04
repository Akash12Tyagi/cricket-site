import { asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Redis } from "ioredis";
import { balls, innings, matches, matchPlayers, players, teams, venues, type Database } from "@cricket/db";
import { listBalls } from "./balls.js";
import { createMemo } from "../lib/memo.js";
import { chase, computeInnings, formatOvers, type Delivery, type InningsLimits, type LiveSnapshot, type StoredScorecard } from "@cricket/shared";

const KEY = (matchId: string) => `match:${matchId}:live`;
const TTL_SECONDS = 6 * 3600;

/**
 * Builds the public "live view" of a match (plan §3.1 point 4): one JSON document per match,
 * rebuilt once per ball and served to every viewer from Redis/CDN.
 */
export async function buildSnapshot(db: Database, matchId: string): Promise<LiveSnapshot | null> {
  const t1 = alias(teams, "t1");
  const t2 = alias(teams, "t2");
  const [m] = await db
    .select({ match: matches, team1: t1, team2: t2, venue: venues })
    .from(matches)
    .innerJoin(t1, eq(t1.id, matches.team1Id))
    .innerJoin(t2, eq(t2.id, matches.team2Id))
    .leftJoin(venues, eq(venues.id, matches.venueId))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!m) return null;

  const [squad, inns, recentBalls] = await Promise.all([
    db.select({ playerId: matchPlayers.playerId, teamId: matchPlayers.teamId, name: players.fullName, knownAs: players.knownAs, slug: players.slug,
      isPlayingXi: matchPlayers.isPlayingXi, isCaptain: matchPlayers.isCaptain, isKeeper: matchPlayers.isKeeper, battingOrder: matchPlayers.battingOrder })
      .from(matchPlayers).innerJoin(players, eq(players.id, matchPlayers.playerId))
      .where(eq(matchPlayers.matchId, matchId)).orderBy(asc(matchPlayers.battingOrder)),
    db.select().from(innings).where(eq(innings.matchId, matchId)).orderBy(asc(innings.number)),
    listBalls(db, matchId, { limit: 30 }),
  ]);
  const allBalls = inns.length
    ? await db.select().from(balls).where(inArray(balls.inningsId, inns.map((i) => i.id))).orderBy(asc(balls.inningsId), asc(balls.seq))
    : [];

  const limitsFor = (i: (typeof inns)[number]): InningsLimits => ({
    ballsPerOver: m.match.ballsPerOver, maxOvers: m.match.oversPerInnings, target: i.target,
  });

  // Scorecard-only feed (no deliveries): innings come from the stored scorecard, in the same shape.
  const card = m.match.scorecard as StoredScorecard | null;
  if (allBalls.length === 0 && card?.innings.length) {
    const fromCard = card.innings.map((i) => {
      const limits: InningsLimits = { ballsPerOver: m.match.ballsPerOver, maxOvers: m.match.oversPerInnings, target: i.target };
      const id = inns.find((x) => x.number === i.number)?.id ?? `${m.match.id}-${i.number}`;
      return {
        id, number: i.number, battingTeamId: i.battingTeamId, bowlingTeamId: i.bowlingTeamId, isComplete: i.isComplete, isDeclared: i.isDeclared, target: i.target,
        chase: i.isComplete ? null : chase(i, limits),
        runs: i.runs, wickets: i.wickets, legalBalls: i.legalBalls, overs: formatOvers(i.legalBalls, m.match.ballsPerOver), extras: i.extras,
        batters: i.batters, bowlers: i.bowlers, fallOfWickets: i.fallOfWickets, partnership: { runs: 0, balls: 0 }, thisOver: [],
        runRate: i.legalBalls ? Math.round((i.runs * m.match.ballsPerOver * 100) / i.legalBalls) / 100 : null,
        next: { strikerId: null, nonStrikerId: null, overComplete: false, lastBowlerId: null },
      };
    });
    return { ...snapshotBase(m, squad, recentBalls), innings: fromCard };
  }

  const inningsOut = inns.map((i) => {
    const list = allBalls.filter((b) => b.inningsId === i.id);
    const state = computeInnings(list as Delivery[], limitsFor(i));
    return {
      id: i.id, number: i.number, battingTeamId: i.battingTeamId, bowlingTeamId: i.bowlingTeamId,
      isComplete: i.isComplete, isDeclared: i.isDeclared, target: i.target,
      chase: chase(state, limitsFor(i)),
      ...state,
    };
  });

  return { ...snapshotBase(m, squad, recentBalls), innings: inningsOut };
}

type Row = { match: typeof matches.$inferSelect; team1: typeof teams.$inferSelect; team2: typeof teams.$inferSelect; venue: typeof venues.$inferSelect | null };
function snapshotBase(m: Row, squad: LiveSnapshot["players"], recentBalls: LiveSnapshot["recentBalls"]): Omit<LiveSnapshot, "innings"> {
  return {
    version: m.match.version,
    generatedAt: new Date().toISOString(),
    match: {
      id: m.match.id, slug: m.match.slug, title: m.match.title, format: m.match.format, status: m.match.status,
      startsAt: m.match.startsAt.toISOString(), resultText: m.match.resultText, oversPerInnings: m.match.oversPerInnings,
      ballsPerOver: m.match.ballsPerOver, tossWinnerId: m.match.tossWinnerId, tossDecision: m.match.tossDecision,
      source: m.match.feedProvider && !m.match.feedPaused ? "feed" : m.match.cricsheetId ? "archive" : "scorer",
    },
    teams: [m.team1, m.team2].map((t) => ({ id: t.id, name: t.name, shortName: t.shortName, logoUrl: t.logoUrl })),
    venue: m.venue ? { name: m.venue.name, city: m.venue.city, timezone: m.venue.timezone } : null,
    players: squad,
    recentBalls,
  };
}

/**
 * Layer 1: per-process memory (1 s fresh, up to 5 min stale if Redis AND Postgres fail).
 * Layer 2: Redis (shared by all API instances, rebuilt on every ball).
 * Layer 3: Postgres (source of truth).
 */
const memory = createMemo<LiveSnapshot | null>({ ttlMs: 1000, staleMs: 300_000, max: 500 });

export async function refreshSnapshot(db: Database, redis: Redis, matchId: string) {
  const snap = await buildSnapshot(db, matchId);
  if (snap) {
    memory.set(matchId, snap);
    await redis.set(KEY(matchId), JSON.stringify(snap), "EX", TTL_SECONDS).catch(() => undefined);
  }
  return snap;
}

/** Never throws because of Redis; serves stale memory if both stores fail. */
export async function getSnapshot(db: Database, redis: Redis, matchId: string): Promise<LiveSnapshot | null> {
  return memory.get(matchId, async () => {
    const cached = await redis.get(KEY(matchId)).catch(() => null);
    if (cached) return JSON.parse(cached) as LiveSnapshot;
    const snap = await buildSnapshot(db, matchId);
    if (snap) await redis.set(KEY(matchId), JSON.stringify(snap), "EX", TTL_SECONDS).catch(() => undefined);
    return snap;
  });
}

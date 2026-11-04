import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import { auditLogs, balls, commentary, innings, matches, matchPlayers, type Database } from "@cricket/db";
import {
  CACHE, DISMISSAL_TYPES, EXTRA_TYPES, MATCH_STATUSES, computeInnings, isInningsComplete, isLegal, validateDelivery,
  type Delivery, type InningsLimits,
} from "@cricket/shared";
import { requireRole } from "../plugins/roles.js";
import { getSnapshot, refreshSnapshot } from "../services/snapshot.js";

const uuid = z.uuid();
const deliverySchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  strikerId: uuid, nonStrikerId: uuid, bowlerId: uuid,
  runsBat: z.number().int().min(0).max(12),
  extraType: z.enum(EXTRA_TYPES).nullable(),
  extraRuns: z.number().int().min(0).max(12),
  isBoundary: z.boolean(),
  dismissal: z.enum(DISMISSAL_TYPES).nullable(),
  dismissedPlayerId: uuid.nullable(),
  fielderId: uuid.nullable(),
  commentary: z.string().trim().max(1000).optional(),
});
const startInningsSchema = z.object({ battingTeamId: uuid, followOn: z.boolean().default(false) });
const statusSchema = z.object({
  status: z.enum(MATCH_STATUSES),
  resultText: z.string().trim().max(200).nullable().optional(),
  winnerId: uuid.nullable().optional(),
  tossWinnerId: uuid.nullable().optional(),
  tossDecision: z.enum(["bat", "bowl"]).nullable().optional(),
});

/** Errors raised inside a transaction that should reach the scorer as a 4xx, not a 500. */
class ScoringError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message = code) { super(message); }
}

/** A match synced from a licensed feed is owned by the feed worker; an admin pauses the feed to score manually. */
function assertManual(m: { feedProvider: string | null; feedPaused: boolean }) {
  if (m.feedProvider && !m.feedPaused) throw new ScoringError(409, "feed_active", "This match is scored by the live data feed. Pause the feed to score manually.");
}

export async function scoringRoutes(app: FastifyInstance, deps: { db: Database; redis: Redis }) {
  const { db, redis } = deps;
  const guard = requireRole("scorer", "admin");

  app.addHook("onSend", async (_req, reply) => { reply.header("cache-control", CACHE.private); });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ScoringError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    throw err; // falls through to the global handler (validation → 400, others → 500 with reference)
  });

  const limitsOf = (m: typeof matches.$inferSelect, i: typeof innings.$inferSelect): InningsLimits =>
    ({ ballsPerOver: m.ballsPerOver, maxOvers: m.oversPerInnings, target: i.target });

  /** Start the next innings. Sets the chase target automatically for limited-overs matches. */
  app.post<{ Params: { matchId: string } }>("/v1/admin/matches/:matchId/innings", { preHandler: guard }, async (req) => {
    const matchId = uuid.parse(req.params.matchId);
    const body = startInningsSchema.parse(req.body);
    const created = await db.transaction(async (tx) => {
      const [m] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
      if (!m) throw new ScoringError(404, "match_not_found");
      assertManual(m);
      if (![m.team1Id, m.team2Id].includes(body.battingTeamId)) throw new ScoringError(400, "team_not_in_match");
      const prev = await tx.select().from(innings).where(eq(innings.matchId, matchId)).orderBy(desc(innings.number));
      if (prev[0] && !prev[0].isComplete) throw new ScoringError(409, "previous_innings_open");
      const maxInnings = m.oversPerInnings == null ? 4 : 2;
      if (prev.length >= maxInnings) throw new ScoringError(409, "all_innings_played");
      const number = prev.length + 1;
      const bowlingTeamId = body.battingTeamId === m.team1Id ? m.team2Id : m.team1Id;
      // Limited overs: target = first-innings total + 1. (Tests: set manually later via DLS/admin tools.)
      const target = m.oversPerInnings != null && number === 2 ? prev[0]!.runs + 1 : null;
      const [row] = await tx.insert(innings).values({ matchId, number, battingTeamId: body.battingTeamId, bowlingTeamId, target, isFollowOn: body.followOn }).returning();
      await tx.update(matches).set({ status: "LIVE", version: sql`${matches.version} + 1` }).where(eq(matches.id, matchId));
      await tx.insert(auditLogs).values({ actorId: req.user!.id, action: "innings.start", entity: "innings", entityId: row!.id, changes: { number, battingTeamId: body.battingTeamId, target } });
      return row!;
    });
    await refreshSnapshot(db, redis, matchId);
    return { innings: created };
  });

  /**
   * Record one delivery (plan §4.3). Row-locks the innings so two scorers can't interleave,
   * validates against the derived state, and is idempotent on `idempotencyKey`.
   */
  app.post<{ Params: { inningsId: string } }>("/v1/admin/innings/:inningsId/balls", { preHandler: guard, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const inningsId = uuid.parse(req.params.inningsId);
    const { idempotencyKey, commentary: commText, ...delivery } = deliverySchema.parse(req.body);

    const existing = await db.select({ id: balls.id }).from(balls).where(eq(balls.idempotencyKey, idempotencyKey)).limit(1);
    if (existing[0]) return reply.code(200).send({ ballId: existing[0].id, duplicate: true });

    const result = await db.transaction(async (tx) => {
      const [inn] = await tx.select().from(innings).where(eq(innings.id, inningsId)).for("update");
      if (!inn) throw new ScoringError(404, "innings_not_found");
      // Re-check under the lock: a concurrent retry with the same key may have just committed.
      const dup = await tx.select({ id: balls.id }).from(balls).where(eq(balls.idempotencyKey, idempotencyKey)).limit(1);
      if (dup[0]) return { duplicate: true as const, ballId: dup[0].id };
      if (inn.isComplete) throw new ScoringError(409, "innings_complete");
      const [m] = await tx.select().from(matches).where(eq(matches.id, inn.matchId));
      assertManual(m!);
      const limits = limitsOf(m!, inn);

      // Every player in the delivery must be in this match on the right side.
      const squad = await tx.select({ playerId: matchPlayers.playerId, teamId: matchPlayers.teamId }).from(matchPlayers).where(eq(matchPlayers.matchId, inn.matchId));
      const teamOf = new Map(squad.map((p) => [p.playerId, p.teamId]));
      if (teamOf.get(delivery.strikerId) !== inn.battingTeamId || teamOf.get(delivery.nonStrikerId) !== inn.battingTeamId) throw new ScoringError(400, "batter_not_in_batting_team");
      if (teamOf.get(delivery.bowlerId) !== inn.bowlingTeamId) throw new ScoringError(400, "bowler_not_in_bowling_team");
      if (delivery.fielderId && teamOf.get(delivery.fielderId) !== inn.bowlingTeamId) throw new ScoringError(400, "fielder_not_in_bowling_team");

      const prior = await tx.select().from(balls).where(eq(balls.inningsId, inningsId)).orderBy(asc(balls.seq));
      const before = computeInnings(prior as Delivery[], limits);
      const error = validateDelivery(delivery, before, limits);
      if (error) throw new ScoringError(422, error.toLowerCase());

      const bpo = m!.ballsPerOver;
      const [row] = await tx.insert(balls).values({
        ...delivery, inningsId, idempotencyKey, createdBy: req.user!.id,
        seq: prior.length + 1,
        overNumber: Math.floor(before.legalBalls / bpo),
        ballInOver: (before.legalBalls % bpo) + (isLegal(delivery) ? 1 : 0),
        isLegal: isLegal(delivery),
      }).returning({ id: balls.id });
      if (commText) await tx.insert(commentary).values({ matchId: inn.matchId, ballId: row!.id, text: commText });

      const after = computeInnings([...prior, delivery] as Delivery[], limits);
      const complete = isInningsComplete(after, limits);
      await tx.update(innings).set({
        runs: after.runs, wickets: after.wickets, legalBalls: after.legalBalls, extras: after.extras.total, isComplete: complete,
      }).where(eq(innings.id, inningsId));
      await tx.update(matches).set({ version: sql`${matches.version} + 1`, ...(complete ? { status: "INNINGS_BREAK" as const } : {}) }).where(eq(matches.id, inn.matchId));
      await tx.insert(auditLogs).values({ actorId: req.user!.id, action: "ball.create", entity: "ball", entityId: row!.id, changes: { inningsId, ...delivery } });
      return { duplicate: false as const, ballId: row!.id, matchId: inn.matchId, inningsComplete: complete, state: { runs: after.runs, wickets: after.wickets, overs: after.overs, next: after.next } };
    });

    if (result.duplicate) return reply.code(200).send(result);
    await refreshSnapshot(db, redis, result.matchId);
    return reply.code(201).send(result);
  });

  /** Undo the last delivery. The deleted ball is kept in the audit log. */
  app.delete<{ Params: { inningsId: string } }>("/v1/admin/innings/:inningsId/balls/last", { preHandler: guard }, async (req) => {
    const inningsId = uuid.parse(req.params.inningsId);
    const matchId = await db.transaction(async (tx) => {
      const [inn] = await tx.select().from(innings).where(eq(innings.id, inningsId)).for("update");
      if (!inn) throw new ScoringError(404, "innings_not_found");
      const [last] = await tx.select().from(balls).where(eq(balls.inningsId, inningsId)).orderBy(desc(balls.seq)).limit(1);
      if (!last) throw new ScoringError(409, "no_balls_to_undo");
      const [m] = await tx.select().from(matches).where(eq(matches.id, inn.matchId));
      assertManual(m!);
      await tx.delete(balls).where(eq(balls.id, last.id)); // commentary cascades
      const remaining = await tx.select().from(balls).where(eq(balls.inningsId, inningsId)).orderBy(asc(balls.seq));
      const s = computeInnings(remaining as Delivery[], limitsOf(m!, inn));
      await tx.update(innings).set({ runs: s.runs, wickets: s.wickets, legalBalls: s.legalBalls, extras: s.extras.total, isComplete: false }).where(eq(innings.id, inningsId));
      await tx.update(matches).set({ version: sql`${matches.version} + 1`, ...(m!.status === "INNINGS_BREAK" ? { status: "LIVE" as const } : {}) }).where(eq(matches.id, inn.matchId));
      await tx.insert(auditLogs).values({ actorId: req.user!.id, action: "ball.undo", entity: "ball", entityId: last.id, changes: last });
      return inn.matchId;
    });
    const snap = await refreshSnapshot(db, redis, matchId);
    return { ok: true, version: snap?.version };
  });

  app.post<{ Params: { matchId: string } }>("/v1/admin/matches/:matchId/status", { preHandler: guard }, async (req) => {
    const matchId = uuid.parse(req.params.matchId);
    const body = statusSchema.parse(req.body);
    const [cur] = await db.select({ feedProvider: matches.feedProvider, feedPaused: matches.feedPaused }).from(matches).where(eq(matches.id, matchId));
    if (cur) assertManual(cur);
    const [row] = await db.update(matches).set({ ...body, version: sql`${matches.version} + 1` }).where(eq(matches.id, matchId)).returning({ id: matches.id });
    if (!row) throw new ScoringError(404, "match_not_found");
    await db.insert(auditLogs).values({ actorId: req.user!.id, action: "match.status", entity: "match", entityId: matchId, changes: body });
    await refreshSnapshot(db, redis, matchId);
    return { ok: true };
  });

  /** Scorers always see the freshest state (never CDN-cached), straight from Redis/DB. */
  app.get<{ Params: { matchId: string } }>("/v1/admin/matches/:matchId/live", { preHandler: guard }, async (req, reply) => {
    const snap = await getSnapshot(db, redis, uuid.parse(req.params.matchId));
    if (!snap) return reply.code(404).send({ error: "match_not_found" });
    return snap;
  });

  /** Lightweight check used by the scorer UI to recover after a dropped connection. */
  app.get<{ Params: { inningsId: string } }>("/v1/admin/innings/:inningsId/last", { preHandler: guard }, async (req) => {
    const inningsId = uuid.parse(req.params.inningsId);
    const [last] = await db.select({ id: balls.id, seq: balls.seq, idempotencyKey: balls.idempotencyKey }).from(balls)
      .where(and(eq(balls.inningsId, inningsId))).orderBy(desc(balls.seq)).limit(1);
    return { last: last ?? null };
  });
}

import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditLogs, authCodes, players, sessions, teams, userFollows, users, type Database } from "@cricket/db";
import { CACHE } from "@cricket/shared";
import { requireRole } from "../plugins/roles.js";
import { clearSessionCookie } from "../plugins/session.js";

const MAX_FOLLOWS = 200;
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N} ._'-]+$/u, "Letters, numbers, spaces and . _ ' - only").nullable() });
const followSchema = z.object({ kind: z.enum(["team", "player"]), id: z.uuid() });

/** Everything about "me". Every route is private, never cached, and only for the signed-in user. */
export async function meRoutes(app: FastifyInstance, deps: { db: Database }) {
  const { db } = deps;
  const signedIn = requireRole("fan", "scorer", "editor", "admin");
  app.addHook("onSend", async (_req, reply) => { reply.header("cache-control", CACHE.private); });

  app.get("/v1/me", { preHandler: signedIn }, async (req) => {
    const [u] = await db.select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, createdAt: users.createdAt })
      .from(users).where(eq(users.id, req.user!.id));
    return { user: u };
  });

  app.patch("/v1/me", { preHandler: signedIn }, async (req) => {
    const body = profileSchema.parse(req.body);
    await db.update(users).set({ displayName: body.displayName }).where(eq(users.id, req.user!.id));
    return { ok: true };
  });

  app.get("/v1/me/follows", { preHandler: signedIn }, async (req) => {
    const rows = await db.select({
      teamId: userFollows.teamId, playerId: userFollows.playerId,
      teamName: teams.name, teamSlug: teams.slug, playerName: players.fullName, playerSlug: players.slug,
    }).from(userFollows)
      .leftJoin(teams, eq(teams.id, userFollows.teamId))
      .leftJoin(players, eq(players.id, userFollows.playerId))
      .where(eq(userFollows.userId, req.user!.id))
      .orderBy(userFollows.createdAt);
    return {
      follows: rows.map((r) => r.teamId
        ? { kind: "team" as const, id: r.teamId, name: r.teamName, slug: r.teamSlug }
        : { kind: "player" as const, id: r.playerId!, name: r.playerName, slug: r.playerSlug }),
    };
  });

  app.post("/v1/me/follows", { preHandler: signedIn, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { kind, id } = followSchema.parse(req.body);
    const exists = kind === "team"
      ? await db.select({ id: teams.id }).from(teams).where(eq(teams.id, id)).limit(1)
      : await db.select({ id: players.id }).from(players).where(eq(players.id, id)).limit(1);
    if (!exists[0]) return reply.code(404).send({ error: "not_found" });
    const count = await db.$count(userFollows, eq(userFollows.userId, req.user!.id));
    if (count >= MAX_FOLLOWS) return reply.code(409).send({ error: "too_many_follows" });
    await db.insert(userFollows).values({ userId: req.user!.id, ...(kind === "team" ? { teamId: id } : { playerId: id }) }).onConflictDoNothing();
    return reply.code(201).send({ ok: true });
  });

  app.delete<{ Params: { kind: string; id: string } }>("/v1/me/follows/:kind/:id", { preHandler: signedIn }, async (req) => {
    const { kind, id } = followSchema.parse(req.params);
    await db.delete(userFollows).where(and(eq(userFollows.userId, req.user!.id), kind === "team" ? eq(userFollows.teamId, id) : eq(userFollows.playerId, id)));
    return { ok: true };
  });

  /** Data export (privacy law: right of access). */
  app.get("/v1/me/export", { preHandler: signedIn, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const [u] = await db.select({ email: users.email, displayName: users.displayName, role: users.role, createdAt: users.createdAt, emailVerifiedAt: users.emailVerifiedAt })
      .from(users).where(eq(users.id, req.user!.id));
    const follows = await db.select({ teamId: userFollows.teamId, playerId: userFollows.playerId, createdAt: userFollows.createdAt })
      .from(userFollows).where(eq(userFollows.userId, req.user!.id));
    const activeSessions = await db.select({ createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, userAgent: sessions.userAgent })
      .from(sessions).where(eq(sessions.userId, req.user!.id));
    reply.header("content-disposition", 'attachment; filename="cricketlive-my-data.json"');
    return { exportedAt: new Date().toISOString(), profile: u, follows, sessions: activeSessions };
  });

  /**
   * Account deletion (right to erasure). Removes the user (sessions and follows cascade) and their login
   * codes. Audit entries keep only an anonymous marker. Staff accounts must be demoted first.
   */
  app.delete("/v1/me", { preHandler: signedIn, config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req, reply) => {
    z.object({ confirm: z.literal("DELETE") }).parse(req.body);
    if (req.user!.role !== "fan") return reply.code(409).send({ error: "staff_account", message: "Staff accounts must be removed by an admin." });
    const id = req.user!.id;
    await db.transaction(async (tx) => {
      const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, id));
      if (u) await tx.delete(authCodes).where(eq(authCodes.email, u.email));
      await tx.delete(users).where(eq(users.id, id));
      await tx.insert(auditLogs).values({ action: "user.self_delete", entity: "user", entityId: null, changes: null });
    });
    clearSessionCookie(reply);
    return { ok: true };
  });
}

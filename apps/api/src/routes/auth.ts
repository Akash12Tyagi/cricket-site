import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { authCodes, sessions, users, type Database } from "@cricket/db";
import { CACHE, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS, requestCodeSchema, verifyCodeSchema } from "@cricket/shared";
import { generateCode, hmac, safeEqualHex } from "../lib/crypto.js";
import type { Mailer } from "../lib/mailer.js";
import { clearSessionCookie, createSession } from "../plugins/session.js";

const MAX_CODES_PER_EMAIL_PER_15_MIN = 3;
const INVALID = { error: "invalid_code", message: "That code is wrong or has expired." };

export async function authRoutes(app: FastifyInstance, deps: { db: Database; mailer: Mailer; secret: string }) {
  const { db, mailer, secret } = deps;
  const codeHash = (email: string, code: string) => hmac(secret, "otp", `${email}:${code}`);

  app.addHook("onSend", async (_req, reply) => { reply.header("cache-control", CACHE.private); });

  // Same response whether or not the account exists, so attackers can't discover who is registered.
  app.post("/v1/auth/code", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { email } = requestCodeSchema.parse(req.body);
    const [{ recent } = { recent: 0 }] = await db
      .select({ recent: sql<number>`count(*)::int` })
      .from(authCodes)
      .where(and(eq(authCodes.email, email), gt(authCodes.createdAt, new Date(Date.now() - 15 * 60_000))));
    if (recent < MAX_CODES_PER_EMAIL_PER_15_MIN) {
      const code = generateCode();
      await db.insert(authCodes).values({ email, codeHash: codeHash(email, code), expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000) });
      await mailer.sendLoginCode(email, code);
    }
    return reply.code(202).send({ ok: true, message: "If that email is valid, a code is on its way." });
  });

  app.post("/v1/auth/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { email, code } = verifyCodeSchema.parse(req.body);
    const [row] = await db.select().from(authCodes)
      .where(and(eq(authCodes.email, email), isNull(authCodes.consumedAt), gt(authCodes.expiresAt, new Date())))
      .orderBy(desc(authCodes.createdAt)).limit(1);
    if (!row || row.attempts >= OTP_MAX_ATTEMPTS) return reply.code(400).send(INVALID);

    if (!safeEqualHex(row.codeHash, codeHash(email, code))) {
      await db.update(authCodes).set({ attempts: sql`${authCodes.attempts} + 1` }).where(eq(authCodes.id, row.id));
      return reply.code(400).send(INVALID);
    }
    // Conditional update: if two verify requests race, only one can consume the code.
    const consumed = await db.update(authCodes).set({ consumedAt: new Date() })
      .where(and(eq(authCodes.id, row.id), isNull(authCodes.consumedAt))).returning({ id: authCodes.id });
    if (consumed.length === 0) return reply.code(400).send(INVALID);

    const [user] = await db.insert(users).values({ email, emailVerifiedAt: new Date() })
      .onConflictDoUpdate({ target: users.email, set: { emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` } })
      .returning({ id: users.id, displayName: users.displayName, role: users.role, disabledAt: users.disabledAt });
    if (!user || user.disabledAt) return reply.code(403).send({ error: "account_disabled" });

    await createSession(db, secret, reply, user.id, req.headers["user-agent"]);
    return { user: { id: user.id, displayName: user.displayName, role: user.role } };
  });

  app.get("/v1/auth/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    return { user: req.user };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    if (req.sessionId) await db.delete(sessions).where(eq(sessions.id, req.sessionId));
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post("/v1/auth/logout-all", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    await db.delete(sessions).where(eq(sessions.userId, req.user.id));
    clearSessionCookie(reply);
    return { ok: true };
  });
}

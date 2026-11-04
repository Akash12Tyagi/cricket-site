import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sessions, users, type Database } from "@cricket/db";
import { SESSION_COOKIE, SESSION_TTL_DAYS, type PublicUser } from "@cricket/shared";
import { generateSessionToken, hmac } from "../lib/crypto.js";
import { isPublicRead } from "./public.js";

declare module "fastify" {
  interface FastifyRequest {
    user: PublicUser | null;
    sessionId: string | null;
  }
}

const SESSION_MS = SESSION_TTL_DAYS * 86_400_000;
const TOUCH_EVERY_MS = 10 * 60_000;

export const sessionCookieOptions = {
  httpOnly: true, // JavaScript can never read it (plan §5.1)
  secure: true, // `__Host-` requires Secure; browsers allow it on http://localhost for development
  sameSite: "lax" as const,
  path: "/",
};

/**
 * Non-secret "signed in" hint (value "1") readable by page JavaScript. It lets cached, identical-for-everyone
 * pages decide whether to ask /v1/auth/me at all; it carries no identity and grants nothing.
 */
export const SIGNED_IN_HINT = "signed_in";
const hintOptions = { httpOnly: false, secure: true, sameSite: "lax" as const, path: "/" };

export async function createSession(db: Database, secret: string, reply: FastifyReply, userId: string, userAgent?: string) {
  const token = generateSessionToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: hmac(secret, "session", token),
    expiresAt: new Date(Date.now() + SESSION_MS),
    userAgent: userAgent?.slice(0, 300),
  });
  reply.setCookie(SESSION_COOKIE, token, { ...sessionCookieOptions, maxAge: SESSION_MS / 1000 });
  reply.setCookie(SIGNED_IN_HINT, "1", { ...hintOptions, maxAge: SESSION_MS / 1000 });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, sessionCookieOptions);
  reply.clearCookie(SIGNED_IN_HINT, hintOptions);
}

/** Resolves the cookie to a user on every request. Unknown/expired cookies are simply ignored. */
export function registerSession(app: FastifyInstance, db: Database, secret: string) {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);

  app.addHook("onRequest", async (req: FastifyRequest) => {
    // Public reads are identical for everyone: never look up the session for them. This saves a DB query on
    // every poll from logged-in fans and keeps live scores working during a database outage (found in drills).
    if (isPublicRead(req.method, req.url)) return;
    const token = req.cookies[SESSION_COOKIE];
    if (!token || token.length > 100) return;
    const [row] = await db
      .select({ sessionId: sessions.id, lastSeenAt: sessions.lastSeenAt, id: users.id, displayName: users.displayName, role: users.role })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hmac(secret, "session", token)), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt)))
      .limit(1);
    if (!row) return;
    req.user = { id: row.id, displayName: row.displayName, role: row.role };
    req.sessionId = row.sessionId;
    if (Date.now() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      // Sliding expiry, written at most every 10 minutes to keep DB writes low.
      await db.update(sessions)
        .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_MS) })
        .where(eq(sessions.id, row.sessionId));
    }
  });
}

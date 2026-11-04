import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { authCodes, createDb, sessions, users } from "@cricket/db";
import { SESSION_COOKIE } from "@cricket/shared";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";

// Integration test: needs Postgres + Redis (docker compose locally, service containers in CI).
const env = loadEnv();
const ORIGIN = env.WEB_ORIGIN;
const sent: { to: string; code: string }[] = [];
const { db, client } = createDb(env.DATABASE_URL, { max: 2 });
const redis = new Redis(env.REDIS_URL);
const app = await buildApp({ env, db, redis, mailer: { sendLoginCode: async (to, code) => { sent.push({ to, code }); } }, logger: false });
const email = `test-${Date.now()}@example.com`;

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload: payload as object, headers: { origin: ORIGIN, ...headers } });

/** Resets only the rate-limit counters this suite depends on (never the whole Redis: the feed worker keeps state there). */
async function resetRateLimits() {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(...keys);
}

beforeAll(async () => { await resetRateLimits(); });
afterAll(async () => {
  await db.delete(users).where(eq(users.email, email));
  await db.delete(authCodes).where(eq(authCodes.email, email));
  await app.close(); await client.end(); await redis.quit();
});

describe("passwordless login", () => {
  let cookie = "";

  it("rejects cross-site POSTs (CSRF guard)", async () => {
    const res = await post("/v1/auth/code", { email }, { origin: "https://evil.example" });
    expect(res.statusCode).toBe(403);
  });

  it("sends a code without revealing whether the account exists", async () => {
    const res = await post("/v1/auth/code", { email: email.toUpperCase() });
    expect(res.statusCode).toBe(202);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(sent.at(-1)?.to).toBe(email);
    const [stored] = await db.select().from(authCodes).where(eq(authCodes.email, email));
    expect(stored?.codeHash).not.toContain(sent.at(-1)!.code); // only a keyed hash is stored
  });

  it("rejects a wrong code", async () => {
    const wrong = sent.at(-1)!.code === "000000" ? "111111" : "000000";
    const res = await post("/v1/auth/verify", { email, code: wrong });
    expect(res.statusCode).toBe(400);
  });

  it("logs in with the right code and sets a locked-down cookie", async () => {
    const res = await post("/v1/auth/verify", { email, code: sent.at(-1)!.code });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(res.json().user).not.toHaveProperty("email"); // email never sent back
    expect(setCookie).toMatch(/signed_in=1;/); // non-secret hint for cached pages
    cookie = setCookie.split(";")[0]!;
    const token = cookie.split("=")[1]!;
    const [s] = await db.select().from(sessions).limit(50);
    expect(JSON.stringify(s)).not.toContain(token); // DB stores only an HMAC of the token
  });

  it("a code works only once", async () => {
    const res = await post("/v1/auth/verify", { email, code: sent.at(-1)!.code });
    expect(res.statusCode).toBe(400);
  });

  it("returns the current user from the cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe("fan");
  });

  it("logout invalidates the session server-side", async () => {
    expect((await post("/v1/auth/logout", {}, { cookie })).statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });
});

describe("rate limiting can't be dodged", () => {
  it("ignores spoofed X-Forwarded-For (TRUST_PROXY_HOPS=0)", async () => {
    await resetRateLimits();
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const r = await app.inject({ method: "POST", url: "/v1/auth/code", payload: { email: `rl-${i}-${Date.now()}@example.com` }, headers: { origin: ORIGIN, "x-forwarded-for": `203.0.113.${i}` } });
      statuses.push(r.statusCode);
    }
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    await resetRateLimits();
  });
});

describe("platform", () => {
  it("health and readiness", async () => {
    expect((await app.inject("/healthz")).statusCode).toBe(200);
    expect((await app.inject("/readyz")).json()).toEqual({ db: true, redis: true });
  });
  it("public match list is CDN-cacheable", async () => {
    const res = await app.inject("/v1/matches?status=upcoming");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("s-maxage=60");
  });
  it("hides internals on bad input", async () => {
    const res = await app.inject("/v1/matches?status=bogus");
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/at .*\.ts/); // no stack traces
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { eq, inArray, like } from "drizzle-orm";
import { articles, createDb, players, sessions, teams, users } from "@cricket/db";
import { SESSION_COOKIE } from "@cricket/shared";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";
import { generateSessionToken, hmac } from "../src/lib/crypto.js";

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL, { max: 2 });
const redis = new Redis(env.REDIS_URL);
const app = await buildApp({ env, db, redis, mailer: { sendLoginCode: async () => {} }, logger: false });
const tag = randomUUID().slice(0, 8);

async function login(role: "fan" | "editor") {
  const [u] = await db.insert(users).values({ email: `${role}3-${tag}@example.com`, role }).returning();
  const token = generateSessionToken();
  await db.insert(sessions).values({ userId: u!.id, tokenHash: hmac(env.AUTH_SECRET, "session", token), expiresAt: new Date(Date.now() + 3600_000) });
  return { cookie: `${SESSION_COOKIE}=${token}`, id: u!.id };
}
const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, cookie = "", payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie, origin: env.WEB_ORIGIN } });

let fan: { cookie: string; id: string }, editor: { cookie: string; id: string }, teamId = "", playerId = "";

beforeAll(async () => {
  fan = await login("fan");
  editor = await login("editor");
  const [t] = await db.insert(teams).values({ name: `Zephyr Strikers ${tag}`, shortName: "ZEP", slug: `zephyr-${tag}`, kind: "LEAGUE" }).returning();
  const [p] = await db.insert(players).values({ fullName: `Quentin Zarkov ${tag}`, slug: `quentin-zarkov-${tag}` }).returning();
  teamId = t!.id; playerId = p!.id;
});
afterAll(async () => {
  await db.delete(articles).where(like(articles.title, `%${tag}%`));
  await db.delete(players).where(eq(players.id, playerId));
  await db.delete(teams).where(eq(teams.id, teamId));
  await db.delete(users).where(inArray(users.email, [`fan3-${tag}@example.com`, `editor3-${tag}@example.com`]));
  await app.close(); await client.end(); await redis.quit();
});

describe("account", () => {
  it("updates display name with validation", async () => {
    expect((await req("PATCH", "/v1/me", fan.cookie, { displayName: "Cricket Fan" })).statusCode).toBe(200);
    expect((await req("PATCH", "/v1/me", fan.cookie, { displayName: "<script>" })).statusCode).toBe(400);
    expect((await req("GET", "/v1/me", fan.cookie)).json().user.displayName).toBe("Cricket Fan");
    expect((await req("GET", "/v1/me")).statusCode).toBe(401);
  });

  it("follows and unfollows teams and players", async () => {
    expect((await req("POST", "/v1/me/follows", fan.cookie, { kind: "team", id: teamId })).statusCode).toBe(201);
    expect((await req("POST", "/v1/me/follows", fan.cookie, { kind: "team", id: teamId })).statusCode).toBe(201); // idempotent
    expect((await req("POST", "/v1/me/follows", fan.cookie, { kind: "player", id: playerId })).statusCode).toBe(201);
    expect((await req("POST", "/v1/me/follows", fan.cookie, { kind: "player", id: randomUUID() })).statusCode).toBe(404);
    let list = (await req("GET", "/v1/me/follows", fan.cookie)).json().follows;
    expect(list).toHaveLength(2);
    await req("DELETE", `/v1/me/follows/team/${teamId}`, fan.cookie);
    list = (await req("GET", "/v1/me/follows", fan.cookie)).json().follows;
    expect(list).toEqual([expect.objectContaining({ kind: "player", id: playerId })]);
  });

  it("exports the user's data privately", async () => {
    const res = await req("GET", "/v1/me/export", fan.cookie);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.json()).toMatchObject({ profile: { email: `fan3-${tag}@example.com` }, follows: [expect.any(Object)] });
  });
});

describe("news", () => {
  let id = "", slug = "";
  it("only editors can write", async () => {
    const body = { title: `Comets edge Hawks ${tag}`, bodyMarkdown: "x", tags: [] };
    expect((await req("POST", "/v1/admin/articles", fan.cookie, body)).statusCode).toBe(403);
  });

  it("editor creates an article; dangerous HTML is neutralised on save", async () => {
    const res = await req("POST", "/v1/admin/articles", editor.cookie, {
      title: `Comets edge Hawks in thriller ${tag}`, summary: "A last-over finish.",
      bodyMarkdown: "## Report\n\nGreat game.<script>alert('x')</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))",
      tags: ["Coastal Comets", "T20"],
    });
    expect(res.statusCode).toBe(201);
    ({ id, slug } = res.json().article);
    const stored = (await req("GET", `/v1/admin/articles/${id}`, editor.cookie)).json().article;
    expect(stored.bodyHtml).toContain("<h2>Report</h2>");
    expect(stored.bodyHtml).not.toMatch(/script|onerror|javascript:/i);
  });

  it("drafts are invisible to the public until published", async () => {
    expect((await req("GET", `/v1/articles/${slug}`)).statusCode).toBe(404);
    expect((await req("GET", `/v1/search?q=${tag}`)).json().articles).toHaveLength(0);
    expect((await req("POST", `/v1/admin/articles/${id}/publish`, editor.cookie, { publish: true })).statusCode).toBe(200);
    const pub = await req("GET", `/v1/articles/${slug}`);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().article.tags.map((t: { slug: string }) => t.slug)).toEqual(expect.arrayContaining(["coastal-comets", "t20"]));
    expect(pub.headers["cache-control"]).toContain("s-maxage");
    const list = (await req("GET", "/v1/articles?tag=t20")).json().articles;
    expect(list.some((a: { slug: string }) => a.slug === slug)).toBe(true);
  });
});

describe("search", () => {
  it("finds players and teams by partial and slightly misspelled names", async () => {
    const r1 = (await req("GET", `/v1/search?q=zarkov`)).json();
    expect(r1.players.some((p: { slug: string }) => p.slug === `quentin-zarkov-${tag}`)).toBe(true);
    const r2 = (await req("GET", `/v1/search?q=zephyr strikrs ${tag}`)).json(); // typo
    expect(r2.teams.some((t: { slug: string }) => t.slug === `zephyr-${tag}`)).toBe(true);
  });
  it("treats LIKE wildcards literally and validates length", async () => {
    expect((await req("GET", "/v1/search?q=%25%25")).json().players).toHaveLength(0);
    expect((await req("GET", "/v1/search?q=a")).statusCode).toBe(400);
  });
});

describe("account deletion", () => {
  it("requires explicit confirmation, then removes the account and its session", async () => {
    expect((await req("DELETE", "/v1/me", fan.cookie, {})).statusCode).toBe(400);
    const res = await req("DELETE", "/v1/me", fan.cookie, { confirm: "DELETE" });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["set-cookie"])).toMatch(/__Host-sid=;/);
    expect((await req("GET", "/v1/me", fan.cookie)).statusCode).toBe(401);
    expect(await db.$count(users, eq(users.id, fan.id))).toBe(0);
  });
  it("staff accounts cannot self-delete", async () => {
    expect((await req("DELETE", "/v1/me", editor.cookie, { confirm: "DELETE" })).statusCode).toBe(409);
  });
});

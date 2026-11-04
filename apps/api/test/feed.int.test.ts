import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { and, eq, inArray, like } from "drizzle-orm";
import { balls, createDb, externalIds, innings, matches, players, series, sessions, teams, users, venues, videos, watchOptions } from "@cricket/db";
import { SESSION_COOKIE } from "@cricket/shared";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";
import { toFeedFixture, type SmFixture } from "../src/feed/sportmonks.js";
import { syncFixture } from "../src/feed/sync.js";
import { generateSessionToken, hmac } from "../src/lib/crypto.js";
import { S, uniqueFixture } from "./fixtures/sportmonks.js";

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL, { max: 2 });
const redis = new Redis(env.REDIS_URL);
const app = await buildApp({ env, db, redis, mailer: { sendLoginCode: async () => {} }, logger: false });
const tag = randomUUID().slice(0, 8);
// Unique provider ids per run so parallel/previous runs never collide.
const base = Number(`9${Date.now() % 1e7}`);
const fixtureId = base;

async function login(role: "editor" | "scorer" | "admin" | "fan") {
  const [u] = await db.insert(users).values({ email: `${role}-feed-${tag}@example.com`, role }).returning();
  const token = generateSessionToken();
  await db.insert(sessions).values({ userId: u!.id, tokenHash: hmac(env.AUTH_SECRET, "session", token), expiresAt: new Date(Date.now() + 3600_000) });
  return `${SESSION_COOKIE}=${token}`;
}
const call = (method: "POST" | "DELETE" | "GET" | "PATCH", url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie, origin: env.WEB_ORIGIN } });

const fixture = (over: Partial<SmFixture> = {}, extra: SmFixture["balls"] = []) => uniqueFixture(base, tag, { id: fixtureId, ...over }, extra);
const sync = (f: SmFixture, autoCreate = true) => syncFixture(db, redis, toFeedFixture(f), { autoCreate });

let admin = "", editor = "", scorer = "", fan = "", matchId = "", slug = "";

beforeAll(async () => {
  [admin, editor, scorer, fan] = await Promise.all([login("admin"), login("editor"), login("scorer"), login("fan")]);
});

afterAll(async () => {
  const ext = await db.select().from(externalIds).where(eq(externalIds.provider, "sportmonks"));
  const mine = ext.filter((e) => Number(e.externalId.split("-")[0]) >= base);
  if (matchId) await db.delete(matches).where(eq(matches.id, matchId));
  await db.delete(players).where(inArray(players.id, mine.filter((e) => e.kind === "player").map((e) => e.entityId)));
  await db.delete(teams).where(inArray(teams.id, mine.filter((e) => e.kind === "team").map((e) => e.entityId)));
  await db.delete(venues).where(like(venues.name, `%${tag}`));
  await db.delete(series).where(like(series.name, `%${tag}`));
  if (mine.length) await db.delete(externalIds).where(and(eq(externalIds.provider, "sportmonks"), inArray(externalIds.externalId, mine.map((e) => e.externalId))));
  await db.delete(videos).where(like(videos.title, `%${tag}%`));
  await db.delete(users).where(like(users.email, `%-feed-${tag}@example.com`));
  await app.close(); await client.end(); await redis.quit();
});

describe("live feed sync", () => {
  it("creates the match, squads and deliveries, with totals from our engine", async () => {
    const r = await sync(fixture());
    expect(r.changed).toBe(true);
    expect(r.ballsWritten).toBe(9);
    matchId = r.matchId!; slug = r.slug!;
    const live = (await app.inject(`/v1/matches/${slug}/live`)).json();
    expect(live.match).toMatchObject({ status: "LIVE", format: "T20I", source: "feed" });
    expect(live.players).toHaveLength(22);
    expect(live.innings[0]).toMatchObject({ runs: 14, wickets: 2, isComplete: true });
    expect(live.innings[1]).toMatchObject({ runs: 1, target: 15, isComplete: false });
  });

  it("is idempotent: the same feed again changes nothing", async () => {
    const [before] = await db.select({ v: matches.version }).from(matches).where(eq(matches.id, matchId));
    const r = await sync(fixture());
    expect(r).toMatchObject({ changed: false, ballsWritten: 0 });
    const [after] = await db.select({ v: matches.version }).from(matches).where(eq(matches.id, matchId));
    expect(after!.v).toBe(before!.v);
  });

  it("appends new deliveries without rewriting old ones", async () => {
    const next = { id: 5000, team_id: 502, ball: 0.2, scoreboard: "S2", batsman_one_on_creeze_id: 22, batsman_two_on_creeze_id: 21, batsman_id: 22, bowler_id: 1, batsmanout_id: null, catchstump_id: null, score: S.four };
    const r = await sync(fixture({}, [next] as SmFixture["balls"]));
    expect(r).toMatchObject({ changed: true, ballsWritten: 1, rebuiltInnings: [] });
    const live = (await app.inject(`/v1/matches/${slug}/live`)).json();
    expect(live.innings[1].runs).toBe(5);
  });

  it("rebuilds an innings when the provider corrects an earlier ball", async () => {
    const f = fixture();
    (f.balls as { score: object }[])[0]!.score = S.one; // the opening four was actually a single
    const r = await sync(f);
    expect(r.rebuiltInnings).toContain(1);
    const [inn] = await db.select().from(innings).where(and(eq(innings.matchId, matchId), eq(innings.number, 1)));
    expect(inn!.runs).toBe(11);
    const rows = await db.select().from(balls).where(eq(balls.inningsId, inn!.id));
    expect(rows.map((b) => b.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("refuses manual scoring while the feed owns the match, allows it when paused", async () => {
    const [inn] = await db.select().from(innings).where(and(eq(innings.matchId, matchId), eq(innings.number, 2)));
    const undo = await call("DELETE", `/v1/admin/innings/${inn!.id}/balls/last`, scorer);
    expect(undo.statusCode).toBe(409);
    expect(undo.json().error).toBe("feed_active");
    expect((await call("POST", `/v1/admin/matches/${matchId}/feed`, scorer, { paused: true })).statusCode).toBe(403); // admins only
    expect((await call("POST", `/v1/admin/matches/${matchId}/feed`, admin, { paused: true })).statusCode).toBe(200);
    expect((await call("DELETE", `/v1/admin/innings/${inn!.id}/balls/last`, scorer)).statusCode).toBe(200);
    // While paused, the worker leaves the match alone.
    expect((await sync(fixture())).skipped).toBe("paused");
    expect((await app.inject(`/v1/matches/${slug}/live`)).json().match.source).toBe("scorer");
    // Resuming hands it back: the next sync restores the feed's version of the innings.
    await call("POST", `/v1/admin/matches/${matchId}/feed`, admin, { paused: false });
    const r = await sync(fixture());
    expect(r.changed).toBe(true);
  });

  it("only syncs unknown fixtures when auto-create is on", async () => {
    const r = await sync(fixture({ id: fixtureId + 1 }), false);
    expect(r.skipped).toBe("not_linked");
  });

  it("shows the feed status to operators only", async () => {
    expect((await call("GET", "/v1/admin/feed/status", fan)).statusCode).toBe(403);
    const res = await call("GET", "/v1/admin/feed/status", scorer);
    expect(res.statusCode).toBe(200);
    expect(res.json().linked.some((m: { id: string }) => m.id === matchId)).toBe(true);
  });
});

describe("where to watch & videos", () => {
  it("lets editors add official links; validates them", async () => {
    const ok = { matchId, region: "IN", name: "JioHotstar", url: "https://www.hotstar.com/in/sports/cricket", kind: "stream" };
    expect((await call("POST", "/v1/admin/watch-options", fan, ok)).statusCode).toBe(403);
    expect((await call("POST", "/v1/admin/watch-options", editor, { ...ok, url: "http://insecure.example" })).statusCode).toBe(400);
    expect((await call("POST", "/v1/admin/watch-options", editor, { ...ok, url: "javascript:alert(1)" })).statusCode).toBe(400);
    expect((await call("POST", "/v1/admin/watch-options", editor, { ...ok, region: "india" })).statusCode).toBe(400);
    expect((await call("POST", "/v1/admin/watch-options", editor, { ...ok, matchId: undefined })).statusCode).toBe(400);
    expect((await call("POST", "/v1/admin/watch-options", editor, ok)).statusCode).toBe(201);
    const [m] = await db.select({ seriesId: matches.seriesId }).from(matches).where(eq(matches.id, matchId));
    expect((await call("POST", "/v1/admin/watch-options", editor, { seriesId: m!.seriesId, region: "GB", name: "Sky Sports", url: "https://www.skysports.com/cricket", kind: "tv" })).statusCode).toBe(201);
  });

  it("serves match media publicly, cacheable, with only embeddable visible videos", async () => {
    await db.insert(videos).values([
      { youtubeId: `A${tag}xx`.slice(0, 11).padEnd(11, "x"), title: `Highlights ${tag}`, publishedAt: new Date(), embeddable: true, matchId },
      { youtubeId: `B${tag}xx`.slice(0, 11).padEnd(11, "x"), title: `Blocked ${tag}`, publishedAt: new Date(), embeddable: false, matchId },
      { youtubeId: `C${tag}xx`.slice(0, 11).padEnd(11, "x"), title: `Hidden ${tag}`, publishedAt: new Date(), embeddable: true, hidden: true, matchId },
    ]);
    const res = await app.inject(`/v1/matches/${slug}/media`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("s-maxage");
    const body = res.json();
    expect(body.watch.map((w: { name: string }) => w.name).sort()).toEqual(["JioHotstar", "Sky Sports"]);
    expect(body.videos.map((v: { title: string }) => v.title)).toEqual([`Highlights ${tag}`]);
    expect((await app.inject("/v1/matches/no-such-match/media")).statusCode).toBe(404);
    const list = (await app.inject("/v1/videos?limit=48")).json();
    expect(list.videos.some((v: { title: string }) => v.title === `Blocked ${tag}`)).toBe(false);
  });

  it("removes a watch option", async () => {
    const [w] = await db.select().from(watchOptions).where(eq(watchOptions.matchId, matchId));
    expect((await call("DELETE", `/v1/admin/watch-options/${w!.id}`, editor)).statusCode).toBe(200);
    expect((await app.inject(`/v1/matches/${slug}/media`)).json().watch.map((x: { name: string }) => x.name)).toEqual(["Sky Sports"]);
  });

  it("rejects non-YouTube URLs when adding a video", async () => {
    expect((await call("POST", "/v1/admin/videos", editor, { url: "https://evil.example/watch?v=dQw4w9WgXcQ", matchId })).json().error).toBe("invalid_youtube_url");
  });
});

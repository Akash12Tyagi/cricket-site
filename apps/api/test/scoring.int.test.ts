import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { eq, inArray } from "drizzle-orm";
import { createDb, matches, matchPlayers, players, sessions, teams, users } from "@cricket/db";
import { SESSION_COOKIE } from "@cricket/shared";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";
import { generateSessionToken, hmac } from "../src/lib/crypto.js";

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL, { max: 2 });
const redis = new Redis(env.REDIS_URL);
const app = await buildApp({ env, db, redis, mailer: { sendLoginCode: async () => {} }, logger: false });
const tag = randomUUID().slice(0, 8);

/** Creates a user with a role and returns a session cookie for it. */
async function login(role: "fan" | "scorer") {
  const [u] = await db.insert(users).values({ email: `${role}-${tag}@example.com`, role }).returning();
  const token = generateSessionToken();
  await db.insert(sessions).values({ userId: u!.id, tokenHash: hmac(env.AUTH_SECRET, "session", token), expiresAt: new Date(Date.now() + 3600_000) });
  return `${SESSION_COOKIE}=${token}`;
}

let scorer = "", fan = "", matchId = "", inningsId = "";
const home: string[] = [], away: string[] = [];
let homeId = "", awayId = "";

const call = (method: "POST" | "DELETE" | "GET", url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie, origin: env.WEB_ORIGIN } });
const ball = (p: Record<string, unknown> = {}) => ({
  idempotencyKey: randomUUID(), strikerId: home[0], nonStrikerId: home[1], bowlerId: away[10],
  runsBat: 0, extraType: null, extraRuns: 0, isBoundary: false, dismissal: null, dismissedPlayerId: null, fielderId: null, ...p,
});

beforeAll(async () => {
  scorer = await login("scorer");
  fan = await login("fan");
  const [h, a] = await db.insert(teams).values([
    { name: `Home ${tag}`, shortName: "HOM", slug: `home-${tag}`, kind: "DOMESTIC" },
    { name: `Away ${tag}`, shortName: "AWY", slug: `away-${tag}`, kind: "DOMESTIC" },
  ]).returning();
  homeId = h!.id; awayId = a!.id;
  for (const [team, list] of [[h!, home], [a!, away]] as const) {
    const ps = await db.insert(players).values(Array.from({ length: 11 }, (_, i) => ({ fullName: `${team.shortName} P${i + 1}`, slug: `${team.slug}-p${i + 1}` }))).returning();
    list.push(...ps.map((p) => p.id));
  }
  const [m] = await db.insert(matches).values({ team1Id: homeId, team2Id: awayId, title: `T ${tag}`, slug: `t-${tag}`, format: "T20", oversPerInnings: 2, startsAt: new Date() }).returning();
  matchId = m!.id;
  await db.insert(matchPlayers).values([
    ...home.map((playerId) => ({ matchId, playerId, teamId: homeId, isPlayingXi: true })),
    ...away.map((playerId) => ({ matchId, playerId, teamId: awayId, isPlayingXi: true })),
  ]);
});

afterAll(async () => {
  await db.delete(matches).where(eq(matches.id, matchId));
  await db.delete(players).where(inArray(players.id, [...home, ...away]));
  await db.delete(teams).where(inArray(teams.id, [homeId, awayId]));
  await db.delete(users).where(inArray(users.email, [`scorer-${tag}@example.com`, `fan-${tag}@example.com`]));
  await app.close(); await client.end(); await redis.quit();
});

describe("scoring API", () => {
  it("fans and anonymous users cannot score", async () => {
    expect((await call("POST", `/v1/admin/matches/${matchId}/innings`, "", { battingTeamId: homeId })).statusCode).toBe(401);
    expect((await call("POST", `/v1/admin/matches/${matchId}/innings`, fan, { battingTeamId: homeId })).statusCode).toBe(403);
  });

  it("starts the first innings and sets the match live", async () => {
    const res = await call("POST", `/v1/admin/matches/${matchId}/innings`, scorer, { battingTeamId: homeId });
    expect(res.statusCode).toBe(200);
    inningsId = res.json().innings.id;
    const live = await app.inject(`/v1/matches/${matchId}/live`);
    expect(live.json().match.status).toBe("LIVE");
  });

  it("records balls and updates the live snapshot", async () => {
    expect((await call("POST", `/v1/admin/innings/${inningsId}/balls`, scorer, ball({ runsBat: 4, isBoundary: true, commentary: "Driven through covers" }))).statusCode).toBe(201);
    const r = await call("POST", `/v1/admin/innings/${inningsId}/balls`, scorer, ball({ runsBat: 1 }));
    expect(r.json().state).toMatchObject({ runs: 5, wickets: 0, overs: "0.2", next: { strikerId: home[1] } });
    const snap = (await app.inject(`/v1/matches/t-${tag}/live`)).json(); // by slug
    expect(snap.innings[0]).toMatchObject({ runs: 5, overs: "0.2", thisOver: ["4", "1"] });
    expect(snap.recentBalls[0]).toMatchObject({ over: "0.2", label: "1", runs: 1 });
    expect(snap.recentBalls[1]).toMatchObject({ over: "0.1", label: "4", isBoundary: true, text: "Driven through covers" });
  });

  it("is idempotent: retrying the same submission doesn't add a ball", async () => {
    const b = ball({ strikerId: home[1], nonStrikerId: home[0], runsBat: 2 });
    expect((await call("POST", `/v1/admin/innings/${inningsId}/balls`, scorer, b)).statusCode).toBe(201);
    const again = await call("POST", `/v1/admin/innings/${inningsId}/balls`, scorer, b);
    expect(again.statusCode).toBe(200);
    expect(again.json().duplicate).toBe(true);
    const snap = (await app.inject(`/v1/matches/${matchId}/live`)).json();
    expect(snap.innings[0].runs).toBe(7);
  });

  it("rejects illegal deliveries with a clear code", async () => {
    const r1 = await call("POST", `/v1/admin/innings/${inningsId}/balls`, scorer, ball({ bowlerId: home[5] }));
    expect(r1.json().error).toBe("bowler_not_in_bowling_team");
    const r2 = await call("POST", `/v1/admin/innings/${inningsId}/balls`, scorer, ball({ strikerId: home[1], nonStrikerId: home[0], extraType: "NO_BALL", extraRuns: 1, dismissal: "BOWLED" }));
    expect(r2.statusCode).toBe(422);
    expect(r2.json().error).toBe("invalid_dismissal_on_extra");
  });

  it("undo removes the last ball", async () => {
    expect((await call("DELETE", `/v1/admin/innings/${inningsId}/balls/last`, scorer)).statusCode).toBe(200);
    expect((await app.inject(`/v1/matches/${matchId}/live`)).json().innings[0].runs).toBe(5);
  });

  it("serves 304 when nothing changed (cheap polling)", async () => {
    const first = await app.inject(`/v1/matches/${matchId}/live`);
    expect(first.headers["cache-control"]).toContain("s-maxage=5");
    const again = await app.inject({ url: `/v1/matches/${matchId}/live`, headers: { "if-none-match": String(first.headers.etag) } });
    expect(again.statusCode).toBe(304);
  });

  it("closes the innings when overs run out and sets the chase target", async () => {
    // 2-over match with 2 legal balls bowled: 4 more finish over 1 (bowler X), 6 more by a new bowler finish over 2.
    let striker = home[1]!, non = home[0]!;
    for (let i = 0; i < 10; i++) {
      const bowler = i < 4 ? away[10] : away[9];
      const r = await call("POST", `/v1/admin/innings/${inningsId}/balls`, scorer, ball({ strikerId: striker, nonStrikerId: non, bowlerId: bowler }));
      expect(r.statusCode, r.body).toBe(201);
      const next = r.json().state.next;
      striker = next.strikerId; non = next.nonStrikerId;
    }
    const snap = (await app.inject(`/v1/matches/${matchId}/live`)).json();
    expect(snap.match.status).toBe("INNINGS_BREAK");
    expect(snap.innings[0]).toMatchObject({ overs: "2.0", isComplete: true });
    const second = await call("POST", `/v1/admin/matches/${matchId}/innings`, scorer, { battingTeamId: awayId });
    expect(second.json().innings.target).toBe(6);
  });
});

describe("catalog API (uses the match scored above)", () => {
  it("pages ball-by-ball commentary with a keyset cursor", async () => {
    const p1 = (await app.inject(`/v1/matches/${matchId}/balls?limit=5`)).json();
    expect(p1.balls).toHaveLength(5);
    expect(p1.balls[0].inningsNumber).toBe(1); // innings 2 has no balls yet
    const p2 = (await app.inject(`/v1/matches/${matchId}/balls?limit=5&beforeInnings=${p1.nextBefore.inningsNumber}&beforeSeq=${p1.nextBefore.seq}`));
    expect(p2.headers["cache-control"]).toContain("s-maxage=86400"); // old pages are immutable
    const p3 = (await app.inject(`/v1/matches/${matchId}/balls?limit=5&beforeInnings=1&beforeSeq=${p2.json().nextBefore.seq}`)).json();
    expect(p3.balls).toHaveLength(2); // 12 balls total
    expect(p3.nextBefore).toBeNull();
    expect(p3.balls.at(-1).over).toBe("0.1");
  });

  it("player profile aggregates batting and bowling from the ball log", async () => {
    const opener = (await app.inject(`/v1/players/home-${tag}-p1`)).json();
    expect(opener.batting[0]).toMatchObject({ format: "T20", innings: 1, fours: 1, outs: 0 });
    expect(opener.batting[0].runs).toBeGreaterThanOrEqual(5);
    const bowlerA = (await app.inject(`/v1/players/away-${tag}-p11`)).json().bowling[0];
    const bowlerB = (await app.inject(`/v1/players/away-${tag}-p10`)).json().bowling[0];
    expect(bowlerA).toMatchObject({ balls: 6, runs: 5, wickets: 0, maidens: 0 });
    expect(bowlerB).toMatchObject({ balls: 6, runs: 0, maidens: 1 });
  });

  it("team page lists fixtures and the playing squad", async () => {
    const res = await app.inject(`/v1/teams/home-${tag}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.upcoming.map((m: { id: string }) => m.id)).toContain(matchId);
    expect(body.squad).toHaveLength(11);
  });

  it("schedule filters by team, rejects bad slugs, and sitemap lists slugs", async () => {
    const sched = (await app.inject(`/v1/schedule?team=home-${tag}`)).json();
    expect(sched.matches.some((m: { id: string }) => m.id === matchId)).toBe(true);
    expect((await app.inject(`/v1/teams/NOT%20a%20slug`)).statusCode).toBe(400);
    expect((await app.inject(`/v1/series/does-not-exist`)).statusCode).toBe(404);
    const sm = (await app.inject("/v1/sitemap")).json();
    expect(sm.matches.some((m: { slug: string }) => m.slug === `t-${tag}`)).toBe(true);
  });
});

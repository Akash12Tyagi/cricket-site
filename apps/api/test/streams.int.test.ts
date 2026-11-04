import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { eq, inArray, like } from "drizzle-orm";
import { createDb, matches, sessions, streamSources, teams, users } from "@cricket/db";
import { SESSION_COOKIE } from "@cricket/shared";

// Set before the app reads its configuration.
process.env.STREAM_HLS_HOSTS = "media.example-cdn.com";
process.env.STREAM_EMBED_HOSTS = "player.board.example";
process.env.STREAM_TOKEN_TESTFEED = "tok-123";

const { buildApp } = await import("../src/app.js");
const { loadEnv } = await import("../src/env.js");
const { generateSessionToken, hmac } = await import("../src/lib/crypto.js");
const { streamConfig, streamsRound } = await import("../src/streams/index.js");

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL, { max: 2 });
const redis = new Redis(env.REDIS_URL);
const tag = randomUUID().slice(0, 8);

// The outside world: a YouTube oEmbed answer and one HLS playlist whose media sequence we control.
let sequence = 500;
const outbound: string[] = [];
const fakeFetch = (async (url: string) => {
  outbound.push(url);
  if (url.includes("youtube.com/oembed")) return new Response(JSON.stringify({ title: "Official stream", author_name: "Board" }), { status: 200 });
  if (url.startsWith("https://media.example-cdn.com/")) {
    const r = new Response(`#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n#EXTINF:6.0,\ns${sequence}.ts\n#EXTINF:6.0,\ns${sequence + 1}.ts\n`, { status: 200 });
    Object.defineProperty(r, "url", { value: url });
    return r;
  }
  return new Response("nope", { status: 404 });
}) as unknown as typeof fetch;

const app = await buildApp({ env, db, redis, mailer: { sendLoginCode: async () => {} }, logger: false, fetchImpl: fakeFetch });

async function login(role: "admin" | "editor" | "fan") {
  const [u] = await db.insert(users).values({ email: `${role}-stream-${tag}@example.com`, role }).returning();
  const token = generateSessionToken();
  await db.insert(sessions).values({ userId: u!.id, tokenHash: hmac(env.AUTH_SECRET, "session", token), expiresAt: new Date(Date.now() + 3600_000) });
  return `${SESSION_COOKIE}=${token}`;
}
const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, cookie: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie, origin: env.WEB_ORIGIN } });

let admin = "", editor = "", fan = "", matchId = "", slug = "", teamIds: string[] = [];
const hls = (over: object = {}) => ({ matchId, kind: "hls", label: "Server 1", url: "https://media.example-cdn.com/live/match.m3u8", region: "WW", rightsNote: "Licence agreement 2026-11, signed by the board", ...over });

beforeAll(async () => {
  [admin, editor, fan] = await Promise.all([login("admin"), login("editor"), login("fan")]);
  const ts = await db.insert(teams).values([{ name: `Str A ${tag}`, shortName: "SA", slug: `str-a-${tag}`, kind: "DOMESTIC" }, { name: `Str B ${tag}`, shortName: "SB", slug: `str-b-${tag}`, kind: "DOMESTIC" }]).returning();
  teamIds = ts.map((t) => t.id);
  const [m] = await db.insert(matches).values({ team1Id: ts[0]!.id, team2Id: ts[1]!.id, title: `Stream test ${tag}`, slug: `stream-test-${tag}`, format: "T20", oversPerInnings: 20, startsAt: new Date(Date.now() + 3600_000) }).returning();
  matchId = m!.id; slug = m!.slug;
});

afterAll(async () => {
  await db.delete(matches).where(eq(matches.id, matchId)); // sources cascade
  await db.delete(teams).where(inArray(teams.id, teamIds));
  await db.delete(users).where(like(users.email, `%-stream-${tag}@example.com`));
  await app.close(); await client.end(); await redis.quit();
});

describe("who may add sources, and what is validated", () => {
  it("rejects fans and anonymous users", async () => {
    expect((await call("POST", "/v1/admin/stream-sources", "", hls())).statusCode).toBe(401);
    expect((await call("POST", "/v1/admin/stream-sources", fan, hls())).statusCode).toBe(403);
  });
  it("lets an editor add an official YouTube stream but not a licensed HLS feed", async () => {
    const yt = await call("POST", "/v1/admin/stream-sources", editor, { matchId, kind: "youtube", label: "Official YouTube", url: "https://youtu.be/dQw4w9WgXcQ", rightsNote: "Official board channel, embedding enabled" });
    expect(yt.statusCode).toBe(201);
    expect(yt.json().source).toMatchObject({ kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", lastStatus: "unknown" }); // embeddable, liveness unproven without an API key
    expect((await call("POST", "/v1/admin/stream-sources", editor, hls())).statusCode).toBe(403);
  });
  it("requires a rights note, an allowed host, https and no embedded credentials", async () => {
    expect((await call("POST", "/v1/admin/stream-sources", admin, hls({ rightsNote: "ok" }))).statusCode).toBe(400);
    expect((await call("POST", "/v1/admin/stream-sources", admin, hls({ url: "https://not-allowed.test/a.m3u8" }))).json().message).toMatch(/STREAM_HLS_HOSTS/);
    expect((await call("POST", "/v1/admin/stream-sources", admin, hls({ url: "http://media.example-cdn.com/a.m3u8" }))).statusCode).toBe(400);
    expect((await call("POST", "/v1/admin/stream-sources", admin, hls({ url: "https://user:pw@media.example-cdn.com/a.m3u8" }))).statusCode).toBe(400);
    expect((await call("POST", "/v1/admin/stream-sources", admin, { matchId, kind: "youtube", label: "x y", url: "https://youtu.be/dQw4w9WgXcQ", rightsNote: "Official channel", authEnv: "STREAM_TOKEN_TESTFEED" })).statusCode).toBe(400);
    expect((await call("POST", "/v1/admin/stream-sources", admin, hls({ matchId: undefined }))).statusCode).toBe(400);
  });
});

describe("licensed HLS, verification and the public listing", () => {
  let openId = "", tokenId = "";
  it("adds an open and a token-protected HLS source; neither is called live on the first check", async () => {
    const a = await call("POST", "/v1/admin/stream-sources", admin, hls({ priority: 10 }));
    expect(a.statusCode).toBe(201);
    openId = a.json().source.id;
    expect(a.json().source.lastStatus).toBe("unknown");
    const b = await call("POST", "/v1/admin/stream-sources", admin, hls({ label: "Server 2", url: "https://media.example-cdn.com/live/backup.m3u8", authEnv: "STREAM_TOKEN_TESTFEED", priority: 5 }));
    expect(b.statusCode).toBe(201);
    tokenId = b.json().source.id;
    expect(outbound.some((u) => u.includes("token=tok-123"))).toBe(true); // the checker used the server-held token
  });
  it("becomes LIVE only after the playlist is seen advancing", async () => {
    sequence += 6;
    const r = await call("POST", `/v1/admin/stream-sources/${openId}/verify`, editor);
    expect(r.json()).toMatchObject({ status: "live" });
  });
  it("the public listing ranks live first and hides everything private", async () => {
    const res = await app.inject(`/v1/matches/${slug}/streams`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("s-maxage");
    const { sources } = res.json() as { sources: Record<string, unknown>[] };
    expect(sources[0]).toMatchObject({ id: openId, status: "live", url: "https://media.example-cdn.com/live/match.m3u8" });
    const tokenSource = sources.find((s) => s.id === tokenId)!;
    expect(tokenSource).toMatchObject({ needsToken: true, status: "unknown" });
    expect(tokenSource.url).toBeUndefined();
    const raw = res.body;
    expect(raw).not.toMatch(/Licence agreement|STREAM_TOKEN|tok-123|rightsNote|authEnv/);
    expect(sources.find((s) => s.kind === "youtube")).toMatchObject({ youtubeId: "dQw4w9WgXcQ" });
  });
  it("hands out the token URL only through the no-store playback endpoint", async () => {
    const res = await app.inject(`/v1/streams/${tokenId}/playback`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.json().url).toBe("https://media.example-cdn.com/live/backup.m3u8?token=tok-123");
    await db.update(streamSources).set({ authEnv: "STREAM_TOKEN_MISSING" }).where(eq(streamSources.id, tokenId));
    expect((await app.inject(`/v1/streams/${tokenId}/playback`)).statusCode).toBe(503); // credential not configured: unavailable, not an error page
    expect((await app.inject(`/v1/streams/${randomUUID()}/playback`)).statusCode).toBe(404);
  });
  it("shows missing credentials to admins as a configuration state, never the token", async () => {
    const list = (await call("GET", `/v1/admin/stream-sources?matchId=${matchId}`, admin)).json().sources as { id: string; authEnvConfigured: boolean | null }[];
    expect(list.find((s) => s.id === tokenId)!.authEnvConfigured).toBe(false);
    const cfgRes = (await call("GET", "/v1/admin/streams/config", admin)).json();
    expect(cfgRes.hlsHosts).toEqual(["media.example-cdn.com"]);
    expect(cfgRes.tokenVariables).toContain("STREAM_TOKEN_TESTFEED");
    expect(JSON.stringify(cfgRes)).not.toContain("tok-123");
  });
  it("disabled sources disappear from the public listing", async () => {
    expect((await call("PATCH", `/v1/admin/stream-sources/${openId}`, editor, { enabled: false })).statusCode).toBe(200);
    const { sources } = (await app.inject(`/v1/matches/${slug}/streams`)).json() as { sources: { id: string }[] };
    expect(sources.some((s) => s.id === openId)).toBe(false);
  });
  it("only admins delete sources", async () => {
    expect((await call("DELETE", `/v1/admin/stream-sources/${tokenId}`, editor)).statusCode).toBe(403);
    expect((await call("DELETE", `/v1/admin/stream-sources/${tokenId}`, admin)).statusCode).toBe(200);
  });
  it("unknown matches 404", async () => { expect((await app.inject("/v1/matches/no-such-match/streams")).statusCode).toBe(404); });
});

describe("worker round", () => {
  it("re-checks sources for matches that are about to start and reports changed matches", async () => {
    await db.update(streamSources).set({ enabled: true, lastCheckedAt: new Date(Date.now() - 3600_000), lastStatus: "unknown", checkState: { mediaSequence: sequence }, authEnv: null }).where(eq(streamSources.matchId, matchId));
    sequence += 6;
    const r = await streamsRound(db, streamConfig(env), fakeFetch, { minAgeMs: 0 });
    expect(r.checked).toBeGreaterThan(0);
    const rows = await db.select().from(streamSources).where(eq(streamSources.matchId, matchId));
    expect(rows.filter((s) => s.kind === "hls").every((s) => s.lastCheckedAt && s.lastCheckedAt.getTime() > Date.now() - 60_000)).toBe(true);
    expect(rows.find((s) => s.kind === "hls")!.lastStatus).toMatch(/live|unknown/);
  });
});

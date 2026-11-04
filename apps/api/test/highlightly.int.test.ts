import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { and, eq, inArray, like } from "drizzle-orm";
import { createDb, externalIds, matches, players, series, teams } from "@cricket/db";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";
import { toHlDetail, toHlMatch, type HighlightlyClient } from "../src/feed/highlightly.js";
import { createHighlightlyRunner } from "../src/feed/highlightly-runner.js";
import { syncHlMatch } from "../src/feed/scorecard-sync.js";
import { hlDetail, hlRaw } from "./fixtures/highlightly.js";

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL, { max: 2 });
const redis = new Redis(env.REDIS_URL);
const app = await buildApp({ env, db, redis, mailer: { sendLoginCode: async () => {} }, logger: false });
const tag = randomUUID().slice(0, 8);
const base = 7_000_000 + Math.floor(Math.random() * 1_000_000);
const H = { id: base + 1, name: `Hometown ${tag}`, abbr: "HOM" }, A = { id: base + 2, name: `Awayville ${tag}`, abbr: "AWV" };
const fid = String(base);
const sync = (m: Parameters<typeof syncHlMatch>[2]) => syncHlMatch(db, redis, m, { autoCreate: true });
let slug = "";

afterAll(async () => {
  const ext = (await db.select().from(externalIds).where(eq(externalIds.provider, "highlightly"))).filter((e) => e.externalId.includes(tag) || [String(H.id), String(A.id), "777"].includes(e.externalId));
  const teamIds = ext.filter((e) => e.kind === "team").map((e) => e.entityId);
  if (teamIds.length) await db.delete(matches).where(inArray(matches.team1Id, teamIds));
  const pl = ext.filter((e) => e.kind === "player").map((e) => e.entityId);
  if (pl.length) await db.delete(players).where(inArray(players.id, pl));
  if (teamIds.length) await db.delete(teams).where(inArray(teams.id, teamIds));
  await db.delete(series).where(like(series.slug, "highlight-cup-2026%")).catch(() => undefined);
  if (ext.length) await db.delete(externalIds).where(and(eq(externalIds.provider, "highlightly"), inArray(externalIds.externalId, ext.map((e) => e.externalId))));
  const keys = await redis.keys(`test-${tag}:*`); if (keys.length) await redis.del(...keys);
  await app.close(); await client.end(); await redis.quit();
});

describe("Highlightly scorecard sync", () => {
  it("creates a fixture from the list view", async () => {
    const r = await sync(toHlMatch(hlRaw(fid, H, A)));
    expect(r.changed).toBe(true);
    slug = r.slug!;
    const live = (await app.inject(`/v1/matches/${slug}/live`)).json();
    expect(live.match).toMatchObject({ status: "SCHEDULED", format: "T20", source: "feed", oversPerInnings: 20 });
    expect(live.innings).toEqual([]);
  });

  it("shows live totals from the list view, batting order from the target", async () => {
    await sync(toHlMatch(hlRaw(fid, H, A, { state: { teams: { home: { info: "20/20 ov", score: "152/7" }, away: { info: "8/20 ov, T:153", score: "60/2" } }, report: null, description: "In play" } })));
    const live = (await app.inject(`/v1/matches/${slug}/live`)).json();
    expect(live.match.status).toBe("LIVE");
    expect(live.innings.map((i: { runs: number; wickets: number; overs: string; isComplete: boolean }) => [i.runs, i.wickets, i.overs, i.isComplete])).toEqual([[152, 7, "20.0", true], [60, 2, "8.0", false]]);
    expect(live.innings[1].chase).toMatchObject({ target: 153, runsNeeded: 93, ballsLeft: 72 });
  });

  it("adds the full scorecard (players resolved to our ids) and keeps it when only list updates follow", async () => {
    await sync(toHlDetail(hlDetail(fid, H, A, tag)));
    let live = (await app.inject(`/v1/matches/${slug}/live`)).json();
    const name = (id: string) => live.players.find((p: { playerId: string }) => p.playerId === id)?.name;
    expect(name(live.innings[0].batters[0].playerId)).toBe(`Home Bat 1 ${tag}`);
    expect(live.innings[0].batters[0]).toMatchObject({ runs: 101, out: "RUN_OUT" });
    expect(name(live.innings[1].bowlers[0].playerId)).toBe(`Home Bat 9 ${tag}`);
    expect(name(live.innings[1].batters[0].outBowlerId)).toBe(`Home Bat 9 ${tag}`);
    // Next list update: totals move on, batters stay.
    await sync(toHlMatch(hlRaw(fid, H, A, { state: { teams: { home: { info: "20/20 ov", score: "152/7" }, away: { info: "10/20 ov, T:153", score: "80/3" } }, report: null, description: "In play" } })));
    live = (await app.inject(`/v1/matches/${slug}/live`)).json();
    expect(live.innings[1]).toMatchObject({ runs: 80, wickets: 3, overs: "10.0" });
    expect(live.innings[1].batters).toHaveLength(3);
  });

  it("records the result and winner", async () => {
    await sync(toHlMatch(hlRaw(fid, H, A, { state: { teams: { home: { info: "20/20 ov", score: "152/7" }, away: { info: "20/20 ov, T:153", score: "140/9" } }, report: `Hometown ${tag} won by 12 runs`, description: "Finished" } })));
    const [m] = await db.select().from(matches).where(eq(matches.slug, slug));
    expect(m).toMatchObject({ status: "COMPLETED", resultText: `Hometown ${tag} won by 12 runs` });
    expect(m!.winnerId).toBe(m!.team1Id);
    const live = (await app.inject(`/v1/matches/${slug}/live`)).json();
    expect(live.innings.every((i: { isComplete: boolean }) => i.isComplete)).toBe(true);
  });

  it("skips a match we already hold from another source", async () => {
    const [m] = await db.select().from(matches).where(eq(matches.slug, slug));
    await db.update(matches).set({ feedProvider: null, feedMatchId: null }).where(eq(matches.id, m!.id)); // pretend it came from Cricsheet
    const r = await sync(toHlMatch(hlRaw(String(base + 9), H, A)));
    expect(r.skipped).toBe("duplicate");
    await db.update(matches).set({ feedProvider: "highlightly", feedMatchId: fid }).where(eq(matches.id, m!.id));
  });
});

describe("Highlightly request budget", () => {
  function fakeClient(remaining: number) {
    const calls: string[] = [];
    const c = {
      quota: { limit: 100, remaining, at: Date.now() },
      matchesOn: async (date: string) => { calls.push(`list:${date}`); return []; },
      detail: async (id: string) => { calls.push(`detail:${id}`); return null; },
    } as unknown as HighlightlyClient;
    return { c, calls };
  }
  const runner = (c: HighlightlyClient, now: Date) => createHighlightlyRunner({
    db, redis, client: c, log: { info: () => {}, warn: () => {} }, autoCreate: false, dailyRequests: 100, minListSeconds: 15,
    onChange: () => {}, now: () => now, keyPrefix: `test-${tag}`,
  });

  it("fetches fixtures for today and the next two days, then waits for its interval", async () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const { c, calls } = fakeClient(90);
    await runner(c, now)();
    expect(calls.filter((x) => x.startsWith("list:"))).toEqual(["list:2026-10-27", "list:2026-10-28", "list:2026-10-29", "list:2026-10-27"]);
    calls.length = 0;
    await runner(c, now)();
    expect(calls.filter((x) => x.startsWith("list:"))).toEqual([]); // fixtures done, list interval not reached
  });

  it("paces scorecard requests: never more than one per interval, however many matches are live", async () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const { c, calls } = fakeClient(90);
    const tick = runner(c, now);
    for (let k = 0; k < 5; k++) await tick(); // same instant: at most one scorecard
    expect(calls.filter((x) => x.startsWith("detail:")).length).toBeLessThanOrEqual(1);
  });

  it("stops before the plan's quota runs out", async () => {
    const { c, calls } = fakeClient(2);
    expect(await runner(c, new Date())()).toEqual({ skipped: "quota" });
    expect(calls).toEqual([]);
  });
});

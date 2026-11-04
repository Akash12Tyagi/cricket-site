import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { and, eq, inArray, like } from "drizzle-orm";
import { articles, createDb, externalIds, matches, newsEvents, players, series, tags, teams, venues } from "@cricket/db";
import { loadEnv } from "../src/env.js";
import { newsroomRound } from "../src/feed/newsroom.js";
import { toFeedFixture, type SmFixture } from "../src/feed/sportmonks.js";
import { syncFixture } from "../src/feed/sync.js";
import { S, uniqueFixture } from "./fixtures/sportmonks.js";

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL, { max: 2 });
const redis = new Redis(env.REDIS_URL);
const tag = randomUUID().slice(0, 8);
const base = Number(`8${Date.now() % 1e7}`);

// Player 1 (Feedland) hits 17 sixes: a hundred off 17 balls. Synctopia's bowler 21 bowls them all.
const sixes = Array.from({ length: 17 }, (_, k) => ({ id: 2000 + k, team_id: 501, ball: k / 10, scoreboard: "S1", batsman_one_on_creeze_id: 1, batsman_two_on_creeze_id: 2, batsman_id: 1, bowler_id: 21, batsmanout_id: null, catchstump_id: null, score: S.six }));
const fx = (over: Partial<SmFixture>) => uniqueFixture(base, tag, { id: base, status: "1st Innings", balls: sixes as unknown as SmFixture["balls"], ...over });
let matchId = "", previewId = "";

afterAll(async () => {
  const ids = [matchId, previewId].filter(Boolean);
  const events = ids.length ? await db.select().from(newsEvents).where(inArray(newsEvents.matchId, ids)) : [];
  const articleIds = events.map((e) => e.articleId).filter((x): x is string => !!x);
  if (articleIds.length) await db.delete(articles).where(inArray(articles.id, articleIds));
  await db.delete(articles).where(like(articles.title, `%${tag}%`)); // includes stories whose event row a test removed
  if (ids.length) await db.delete(matches).where(inArray(matches.id, ids));
  const ext = (await db.select().from(externalIds).where(eq(externalIds.provider, "sportmonks"))).filter((e) => Number(e.externalId.split("-")[0]) >= base && Number(e.externalId.split("-")[0]) < base + 1e6);
  await db.delete(players).where(inArray(players.id, ext.filter((e) => e.kind === "player").map((e) => e.entityId)));
  await db.delete(teams).where(inArray(teams.id, ext.filter((e) => e.kind === "team").map((e) => e.entityId)));
  await db.delete(venues).where(like(venues.name, `%${tag}`));
  await db.delete(series).where(like(series.name, `%${tag}`));
  if (ext.length) await db.delete(externalIds).where(and(eq(externalIds.provider, "sportmonks"), inArray(externalIds.externalId, ext.map((e) => e.externalId))));
  await db.delete(tags).where(like(tags.name, `%${tag}%`));
  await client.end(); await redis.quit();
});

describe("automated newsroom", () => {
  it("publishes a hundred the moment it happens, exactly once", async () => {
    const r = await syncFixture(db, redis, toFeedFixture(fx({})), { autoCreate: true });
    matchId = r.matchId!;
    const first = await newsroomRound(db, redis, { matchIds: [matchId] });
    expect(first).toHaveLength(1);
    const [a] = await db.select().from(articles).where(eq(articles.slug, first[0]!));
    expect(a!.title).toBe(`Feed Player 1 ${tag} hits hundred for Feedland ${tag} against Synctopia ${tag}`);
    expect(a!.bodyMarkdown).toContain("102 not out from 17 balls, with 0 fours and 17 sixes");
    expect(a!.bodyMarkdown).toContain("generated automatically");
    expect(a!.bodyHtml).not.toContain("<script");
    expect(a!.publishedAt).not.toBeNull();
    expect(await newsroomRound(db, redis, { matchIds: [matchId] })).toEqual([]); // no duplicate
  });

  it("writes the match report when the result comes in", async () => {
    await syncFixture(db, redis, toFeedFixture(fx({ status: "Finished", note: `Feedland ${tag} won by 50 runs`, winner_team_id: 501 })), { autoCreate: true });
    const slugs = await newsroomRound(db, redis, { matchIds: [matchId] });
    expect(slugs).toHaveLength(1);
    const [a] = await db.select().from(articles).where(eq(articles.slug, slugs[0]!));
    expect(a!.title.startsWith(`Feedland ${tag} won by 50 runs: Feedland ${tag} v Synctopia ${tag}`)).toBe(true);
    expect(a!.bodyMarkdown).toContain(`**Feedland ${tag}** 102/0 (2.5 ov): Feed Player 1 ${tag} 102* (17)`);
    expect(a!.bodyMarkdown).toContain("top-scored with 102 not out off 17 balls");
    expect(a!.bodyHtml).toContain('href="/match/');
  });

  it("previews a match starting within 24 hours, with head-to-head from our records", async () => {
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    const [p] = await db.insert(matches).values({
      team1Id: m!.team1Id, team2Id: m!.team2Id, title: `Feedland v Synctopia, 2nd T20I ${tag}`, slug: `preview-${tag}`, format: "T20I",
      oversPerInnings: 20, startsAt: new Date(Date.now() + 3 * 3600_000),
    }).returning();
    previewId = p!.id;
    const slugs = await newsroomRound(db, redis, { matchIds: [previewId] });
    expect(slugs).toHaveLength(1);
    const [a] = await db.select().from(articles).where(eq(articles.slug, slugs[0]!));
    expect(a!.title).toBe(`Preview: Feedland ${tag} v Synctopia ${tag}, 2nd T20I ${tag}`);
    expect(a!.bodyMarkdown).toContain(`have met 1 time: Feedland ${tag} won 1 and Synctopia ${tag} won 0`);
    expect(await newsroomRound(db, redis, { matchIds: [previewId] })).toEqual([]);
  });

  it("ignores matches outside the windows (the archive never triggers stories)", async () => {
    await db.update(matches).set({ startsAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(matches.id, matchId));
    await db.delete(newsEvents).where(eq(newsEvents.key, `result:${matchId}`));
    expect(await newsroomRound(db, redis, { matchIds: [matchId] })).toEqual([]);
  });
});

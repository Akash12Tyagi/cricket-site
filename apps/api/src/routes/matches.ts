import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { matches, series, teams, venues, type Database } from "@cricket/db";
import { CACHE } from "@cricket/shared";
import type { Redis } from "ioredis";
import { getSnapshot } from "../services/snapshot.js";
import { createMemo } from "../lib/memo.js";
import { withInnings } from "../services/summaries.js";

/** slug → match id. Slugs never change, so this can live long in memory (survives a DB outage). */
const slugToId = createMemo<string | null>({ ttlMs: 10 * 60_000, staleMs: 24 * 3600_000, max: 5000 });

const LIVE_STATUSES = ["TOSS", "LIVE", "INNINGS_BREAK", "STUMPS", "DELAYED"] as const;
const querySchema = z.object({ status: z.enum(["live", "upcoming", "recent"]).default("live") });

export async function matchRoutes(app: FastifyInstance, deps: { db: Database; redis: Redis }) {
  const t1 = alias(teams, "t1");
  const t2 = alias(teams, "t2");

  // Public, identical for every visitor → cached by the CDN (plan §1 traffic maths).
  app.get("/v1/matches", async (req, reply) => {
    const { status } = querySchema.parse(req.query);
    const now = new Date();
    const where =
      status === "live" ? inArray(matches.status, [...LIVE_STATUSES])
      : status === "upcoming" ? and(eq(matches.status, "SCHEDULED"), gte(matches.startsAt, now))
      : and(inArray(matches.status, ["COMPLETED", "ABANDONED"]), lt(matches.startsAt, now));
    const rows = await deps.db
      .select({
        id: matches.id, slug: matches.slug, title: matches.title, format: matches.format, status: matches.status,
        startsAt: matches.startsAt, resultText: matches.resultText, version: matches.version, oversPerInnings: matches.oversPerInnings,
        team1: { id: t1.id, name: t1.name, shortName: t1.shortName }, team2: { id: t2.id, name: t2.name, shortName: t2.shortName },
        venue: { name: venues.name, city: venues.city },
        series: { name: series.name, slug: series.slug },
      })
      .from(matches)
      .innerJoin(t1, eq(t1.id, matches.team1Id))
      .innerJoin(t2, eq(t2.id, matches.team2Id))
      .leftJoin(venues, eq(venues.id, matches.venueId))
      .leftJoin(series, eq(series.id, matches.seriesId))
      .where(where)
      .orderBy(status === "recent" ? desc(matches.startsAt) : asc(matches.startsAt))
      .limit(50);
    reply.header("cache-control", status === "live" ? CACHE.live : CACHE.short);
    return { matches: await withInnings(deps.db, rows) };
  });

  /**
   * Live snapshot, polled by every viewer (plan §4.2). Identical for everyone → CDN-cached for 5 s.
   * ETag = match version, so a poll with no new ball costs a 304 with no body.
   */
  app.get<{ Params: { key: string } }>("/v1/matches/:key/live", async (req, reply) => {
    const key = z.string().min(1).max(200).parse(req.params.key);
    let matchId = key;
    if (!z.uuid().safeParse(key).success) {
      const id = await slugToId.get(key, async () => {
        const [row] = await deps.db.select({ id: matches.id }).from(matches).where(eq(matches.slug, key)).limit(1);
        return row?.id ?? null;
      });
      if (!id) { slugToId.delete(key); return reply.code(404).send({ error: "not_found" }); } // never cache a miss: the match may be created later
      matchId = id;
    }
    const snap = await getSnapshot(deps.db, deps.redis, matchId);
    if (!snap) return reply.code(404).send({ error: "not_found" });
    const etag = `"m${snap.version}"`;
    const done = ["COMPLETED", "ABANDONED", "CANCELLED"].includes(snap.match.status);
    reply.header("etag", etag).header("cache-control", done ? CACHE.short : CACHE.live);
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return snap;
  });
}

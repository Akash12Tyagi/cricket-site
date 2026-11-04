import { and, desc, isNotNull, lte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { articles, players, series, teams, type Database } from "@cricket/db";
import { CACHE } from "@cricket/shared";

/**
 * Site search over names/titles using trigram indexes (handles partial words and small typos).
 * Results are public and identical for everyone, so each query string is CDN-cached.
 */
export async function searchRoutes(app: FastifyInstance, deps: { db: Database }) {
  const { db } = deps;
  app.get("/v1/search", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(80) }).parse(req.query);
    // Escape LIKE wildcards so user input is matched literally.
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const match = (col: AnyPgColumn) => sql`(${col} ilike ${like} or ${col} % ${q})`;
    const rank = (col: AnyPgColumn) => sql`similarity(${col}, ${q})`;
    const [p, t, s, a] = await Promise.all([
      db.select({ name: players.fullName, slug: players.slug, extra: players.country }).from(players).where(match(players.fullName)).orderBy(desc(rank(players.fullName))).limit(8),
      db.select({ name: teams.name, slug: teams.slug, extra: teams.shortName }).from(teams).where(match(teams.name)).orderBy(desc(rank(teams.name))).limit(8),
      db.select({ name: series.name, slug: series.slug, extra: series.season }).from(series).where(match(series.name)).orderBy(desc(rank(series.name))).limit(8),
      db.select({ name: articles.title, slug: articles.slug, extra: articles.summary }).from(articles)
        .where(and(match(articles.title), isNotNull(articles.publishedAt), lte(articles.publishedAt, sql`now()`))).orderBy(desc(rank(articles.title))).limit(8),
    ]);
    reply.header("cache-control", CACHE.short);
    return { query: q, players: p, teams: t, series: s, articles: a };
  });
}

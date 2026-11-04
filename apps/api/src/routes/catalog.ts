import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { articles, matches, matchPlayers, players, series, teams, venues, type Database } from "@cricket/db";
import { CACHE, LIVE_STATUSES, type BallPage } from "@cricket/shared";
import { listBalls } from "../services/balls.js";
import { withInnings } from "../services/summaries.js";

const slug = z.string().min(1).max(200).regex(/^[a-z0-9-]+$/);
const DONE = ["COMPLETED", "ABANDONED", "CANCELLED"] as const;

export async function catalogRoutes(app: FastifyInstance, deps: { db: Database }) {
  const { db } = deps;
  const t1 = alias(teams, "t1");
  const t2 = alias(teams, "t2");

  /** Shared match-summary select, used by lists on every page. */
  const matchList = async (where: SQL | undefined, order: "asc" | "desc", limit: number) => withInnings(db, await db.select({
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
      .orderBy(order === "asc" ? asc(matches.startsAt) : desc(matches.startsAt))
      .limit(limit));

  /** Schedule: fixtures/results in a date window, optionally by series or team. */
  app.get("/v1/schedule", async (req, reply) => {
    const q = z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      series: slug.optional(),
      team: slug.optional(),
      kind: z.enum(["upcoming", "results"]).default("upcoming"),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    const now = new Date();
    const filters = [];
    if (q.kind === "upcoming") filters.push(or(eq(matches.status, "SCHEDULED"), inArray(matches.status, [...LIVE_STATUSES])), gte(matches.startsAt, q.from ?? new Date(now.getTime() - 86_400_000)));
    else filters.push(inArray(matches.status, [...DONE]), lt(matches.startsAt, q.to ?? now));
    if (q.series) {
      const [s] = await db.select({ id: series.id }).from(series).where(eq(series.slug, q.series)).limit(1);
      if (!s) return reply.code(404).send({ error: "not_found" });
      filters.push(eq(matches.seriesId, s.id));
    }
    if (q.team) {
      const [t] = await db.select({ id: teams.id }).from(teams).where(eq(teams.slug, q.team)).limit(1);
      if (!t) return reply.code(404).send({ error: "not_found" });
      filters.push(or(eq(matches.team1Id, t.id), eq(matches.team2Id, t.id)));
    }
    const rows = await matchList(and(...filters), q.kind === "upcoming" ? "asc" : "desc", q.limit);
    reply.header("cache-control", CACHE.short);
    return { matches: rows };
  });

  /** Older ball-by-ball commentary, newest first, keyset-paginated. */
  app.get<{ Params: { key: string } }>("/v1/matches/:key/balls", async (req, reply) => {
    const key = z.string().min(1).max(200).parse(req.params.key);
    const q = z.object({
      beforeInnings: z.coerce.number().int().min(1).max(4).optional(),
      beforeSeq: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(60).default(30),
    }).parse(req.query);
    const [m] = await db.select({ id: matches.id, status: matches.status }).from(matches)
      .where(z.uuid().safeParse(key).success ? eq(matches.id, key) : eq(matches.slug, key)).limit(1);
    if (!m) return reply.code(404).send({ error: "not_found" });
    const before = q.beforeInnings && q.beforeSeq ? { inningsNumber: q.beforeInnings, seq: q.beforeSeq } : undefined;
    const list = await listBalls(db, m.id, { limit: q.limit, ...(before ? { before } : {}) });
    const last = list.at(-1);
    const page: BallPage = { balls: list, nextBefore: list.length === q.limit && last ? { inningsNumber: last.inningsNumber, seq: last.seq } : null };
    // Older pages never change once written; the first page of a live match changes every ball.
    reply.header("cache-control", before ? CACHE.long : (DONE as readonly string[]).includes(m.status) ? CACHE.short : CACHE.live);
    return page;
  });

  app.get("/v1/series", async (_req, reply) => {
    const rows = await db.select({
      id: series.id, name: series.name, slug: series.slug, season: series.season, startDate: series.startDate, endDate: series.endDate,
      matchCount: sql<number>`(select count(*)::int from ${matches} where ${matches.seriesId} = ${series.id})`,
    }).from(series).orderBy(desc(series.startDate), asc(series.name)).limit(200);
    reply.header("cache-control", CACHE.short);
    return { series: rows };
  });

  app.get<{ Params: { slug: string } }>("/v1/series/:slug", async (req, reply) => {
    const [s] = await db.select().from(series).where(eq(series.slug, slug.parse(req.params.slug))).limit(1);
    if (!s) return reply.code(404).send({ error: "not_found" });
    const fixtures = await matchList(eq(matches.seriesId, s.id), "asc", 200);
    reply.header("cache-control", CACHE.short);
    return { series: { id: s.id, name: s.name, slug: s.slug, season: s.season, startDate: s.startDate, endDate: s.endDate }, matches: fixtures };
  });

  app.get("/v1/teams", async (_req, reply) => {
    const rows = await db.select({ id: teams.id, name: teams.name, shortName: teams.shortName, slug: teams.slug, kind: teams.kind, logoUrl: teams.logoUrl })
      .from(teams).orderBy(asc(teams.kind), asc(teams.name)).limit(1000);
    reply.header("cache-control", CACHE.short);
    return { teams: rows };
  });

  app.get<{ Params: { slug: string } }>("/v1/teams/:slug", async (req, reply) => {
    const [t] = await db.select().from(teams).where(eq(teams.slug, slug.parse(req.params.slug))).limit(1);
    if (!t) return reply.code(404).send({ error: "not_found" });
    const involves = or(eq(matches.team1Id, t.id), eq(matches.team2Id, t.id));
    const [upcoming, results, squad] = await Promise.all([
      matchList(and(involves, inArray(matches.status, ["SCHEDULED", ...LIVE_STATUSES])), "asc", 20),
      matchList(and(involves, inArray(matches.status, [...DONE])), "desc", 20),
      // Recent squad: anyone in a playing XI for this team, most recent appearance first.
      db.select({ id: players.id, name: players.fullName, knownAs: players.knownAs, slug: players.slug, playingRole: players.playingRole,
        lastPlayed: sql<string>`max(${matches.startsAt})` })
        .from(matchPlayers)
        .innerJoin(players, eq(players.id, matchPlayers.playerId))
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(and(eq(matchPlayers.teamId, t.id), eq(matchPlayers.isPlayingXi, true)))
        .groupBy(players.id).orderBy(desc(sql`max(${matches.startsAt})`), asc(players.fullName)).limit(40),
    ]);
    reply.header("cache-control", CACHE.short);
    return { team: { id: t.id, name: t.name, shortName: t.shortName, slug: t.slug, kind: t.kind, logoUrl: t.logoUrl }, upcoming, results, squad };
  });

  /** Player profile with career batting/bowling by format, aggregated from the ball log. */
  app.get<{ Params: { slug: string } }>("/v1/players/:slug", async (req, reply) => {
    const [p] = await db.select().from(players).where(eq(players.slug, slug.parse(req.params.slug))).limit(1);
    if (!p) return reply.code(404).send({ error: "not_found" });

    const batting = await db.execute<{ format: string; innings: number; runs: number; balls: number; fours: number; sixes: number; outs: number; highest: number; fifties: number; hundreds: number }>(sql`
      with per_innings as (
        select m.format, i.id as innings_id,
          coalesce(sum(b.runs_bat) filter (where b.striker_id = ${p.id}), 0)::int as runs,
          count(*) filter (where b.striker_id = ${p.id} and b.extra_type is distinct from 'WIDE' and b.extra_type is distinct from 'PENALTY')::int as balls,
          count(*) filter (where b.striker_id = ${p.id} and b.is_boundary and b.runs_bat = 4)::int as fours,
          count(*) filter (where b.striker_id = ${p.id} and b.is_boundary and b.runs_bat = 6)::int as sixes,
          count(*) filter (where b.dismissed_player_id = ${p.id} and b.dismissal <> 'RETIRED_HURT')::int as outs
        from balls b
        join innings i on i.id = b.innings_id
        join matches m on m.id = i.match_id
        where ${p.id} in (b.striker_id, b.non_striker_id)
        group by m.format, i.id
      )
      select format, count(*)::int as innings, sum(runs)::int as runs, sum(balls)::int as balls, sum(fours)::int as fours,
        sum(sixes)::int as sixes, sum(outs)::int as outs, max(runs)::int as highest,
        count(*) filter (where runs between 50 and 99)::int as fifties, count(*) filter (where runs >= 100)::int as hundreds
      from per_innings group by format order by format`);

    const bowling = await db.execute<{ format: string; innings: number; balls: number; runs: number; wickets: number; maidens: number }>(sql`
      with per_over as (
        select m.format, b.innings_id, b.over_number, m.balls_per_over,
          count(*) filter (where b.is_legal)::int as legal,
          sum(case when b.extra_type in ('BYE','LEG_BYE','PENALTY') then b.runs_bat else b.runs_bat + b.extra_runs end)::int as runs,
          count(*) filter (where b.dismissal in ('BOWLED','CAUGHT','LBW','STUMPED','HIT_WICKET'))::int as wickets
        from balls b join innings i on i.id = b.innings_id join matches m on m.id = i.match_id
        where b.bowler_id = ${p.id}
        group by m.format, b.innings_id, b.over_number, m.balls_per_over
      )
      select format, count(distinct innings_id)::int as innings, sum(legal)::int as balls, sum(runs)::int as runs,
        sum(wickets)::int as wickets,
        -- a maiden is a complete over by this bowler with no runs charged to him
        count(*) filter (where legal = balls_per_over and runs = 0)::int as maidens
      from per_over group by format order by format`);

    // Career timeline: debut and most recent match per format (research gap vs Cricbuzz's profile).
    const timeline = await db.execute<{ format: string; matches: number; debut: Record<string, string>; last: Record<string, string> }>(sql`
      with pm as (
        select m.format, m.starts_at, m.slug, v.name as venue,
          t.name as opponent
        from match_players mp
        join matches m on m.id = mp.match_id
        join teams t on t.id = case when m.team1_id = mp.team_id then m.team2_id else m.team1_id end
        left join venues v on v.id = m.venue_id
        where mp.player_id = ${p.id} and m.status = 'COMPLETED'
      )
      select format, count(*)::int as matches,
        (array_agg(json_build_object('date', starts_at, 'slug', slug, 'opponent', opponent, 'venue', venue) order by starts_at))[1] as debut,
        (array_agg(json_build_object('date', starts_at, 'slug', slug, 'opponent', opponent, 'venue', venue) order by starts_at desc))[1] as last
      from pm group by format order by format`);

    // Recent form: last 10 innings with the bat and last 10 spells with the ball.
    const formBat = await db.execute<{ runs: number; balls: number; out: boolean; format: string; date: string; slug: string; opponent: string }>(sql`
      select coalesce(sum(b.runs_bat) filter (where b.striker_id = ${p.id}), 0)::int as runs,
        count(*) filter (where b.striker_id = ${p.id} and b.extra_type is distinct from 'WIDE' and b.extra_type is distinct from 'PENALTY')::int as balls,
        bool_or(b.dismissed_player_id = ${p.id} and b.dismissal <> 'RETIRED_HURT') as out,
        m.format, m.starts_at as date, m.slug, t.name as opponent
      from balls b join innings i on i.id = b.innings_id join matches m on m.id = i.match_id join teams t on t.id = i.bowling_team_id
      where ${p.id} in (b.striker_id, b.non_striker_id)
      group by i.id, m.format, m.starts_at, m.slug, t.name, i.number
      order by m.starts_at desc, i.number desc limit 10`);
    const formBowl = await db.execute<{ wickets: number; runs: number; balls: number; format: string; date: string; slug: string; opponent: string }>(sql`
      select count(*) filter (where b.dismissal in ('BOWLED','CAUGHT','LBW','STUMPED','HIT_WICKET'))::int as wickets,
        sum(case when b.extra_type in ('BYE','LEG_BYE','PENALTY') then b.runs_bat else b.runs_bat + b.extra_runs end)::int as runs,
        count(*) filter (where b.is_legal)::int as balls,
        m.format, m.starts_at as date, m.slug, t.name as opponent
      from balls b join innings i on i.id = b.innings_id join matches m on m.id = i.match_id join teams t on t.id = i.batting_team_id
      where b.bowler_id = ${p.id}
      group by i.id, m.format, m.starts_at, m.slug, t.name, i.number
      order by m.starts_at desc, i.number desc limit 10`);

    const teamsPlayed = await db.execute<{ name: string; slug: string; matches: number }>(sql`
      select t.name, t.slug, count(*)::int as matches from match_players mp join teams t on t.id = mp.team_id
      where mp.player_id = ${p.id} group by t.id order by matches desc, t.name limit 20`);

    const recent = await matchList(
      sql`${matches.id} in (select ${matchPlayers.matchId} from ${matchPlayers} where ${matchPlayers.playerId} = ${p.id})`,
      "desc", 10);

    reply.header("cache-control", CACHE.short);
    return {
      player: {
        id: p.id, fullName: p.fullName, knownAs: p.knownAs, slug: p.slug, country: p.country,
        dateOfBirth: p.dateOfBirth, birthPlace: p.birthPlace, heightCm: p.heightCm,
        battingStyle: p.battingStyle, bowlingStyle: p.bowlingStyle, playingRole: p.playingRole, imageUrl: p.imageUrl,
        sources: { wikidata: p.wikidataId ? `https://www.wikidata.org/wiki/${p.wikidataId}` : null, cricsheet: !!p.cricsheetId },
      },
      batting: [...batting], bowling: [...bowling], timeline: [...timeline], form: { batting: [...formBat], bowling: [...formBowl] },
      teams: [...teamsPlayed], recentMatches: recent,
    };
  });

  /** Everything public that should be in sitemap.xml. */
  app.get("/v1/sitemap", async (_req, reply) => {
    const [m, s, t, p, a] = await Promise.all([
      db.select({ slug: matches.slug, updatedAt: matches.updatedAt }).from(matches).orderBy(desc(matches.updatedAt)).limit(20_000),
      db.select({ slug: series.slug, updatedAt: series.updatedAt }).from(series).limit(5_000),
      db.select({ slug: teams.slug, updatedAt: teams.updatedAt }).from(teams).limit(5_000),
      db.select({ slug: players.slug, updatedAt: players.updatedAt }).from(players).limit(40_000),
      db.select({ slug: articles.slug, updatedAt: articles.updatedAt }).from(articles)
        .where(sql`${articles.publishedAt} is not null and ${articles.publishedAt} <= now()`).orderBy(desc(articles.publishedAt)).limit(20_000),
    ]);
    reply.header("cache-control", CACHE.long);
    return { matches: m, series: s, teams: t, players: p, articles: a };
  });
}

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import { auditLogs, matches, videoChannels, videos, watchOptions, type Database } from "@cricket/db";
import { CACHE } from "@cricket/shared";
import { requireRole } from "../plugins/roles.js";
import { CHANNEL_ID, checkEmbeddable, youtubeIdFromUrl } from "../feed/youtube.js";
import { refreshSnapshot } from "../services/snapshot.js";

const uuid = z.uuid();
const slug = z.string().min(1).max(200).regex(/^[a-z0-9-]+$/);
const publicVideo = {
  id: videos.id, youtubeId: videos.youtubeId, title: videos.title, channelName: videos.channelName, publishedAt: videos.publishedAt,
  isShort: videos.isShort,
  // Without API statistics, "live" comes from the title only, so treat it as over after 12 h.
  isLive: sql<boolean>`${videos.isLive} and (${videos.statsFetchedAt} is not null or ${videos.publishedAt} > now() - interval '12 hours')`.as("is_live"),
  matchId: videos.matchId, viewCount: videos.viewCount, durationSeconds: videos.durationSeconds, statsFetchedAt: videos.statsFetchedAt,
};

/** Opaque keyset cursor: "<sort value>~<id>" in base64url. Deep pages cost the same as the first (no OFFSET). */
const encodeCursor = (value: string | number, id: string) => Buffer.from(`${value}~${id}`).toString("base64url");
function decodeCursor(c: string | undefined, kind: "date" | "number") {
  if (!c) return null;
  const [v, id] = Buffer.from(c, "base64url").toString().split("~");
  if (!v || !id || !z.uuid().safeParse(id).success) return null;
  if (kind === "number") { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? { v: n, id } : null; }
  const d = new Date(v); return Number.isNaN(d.getTime()) ? null : { v: d, id };
}
const showable = and(eq(videos.embeddable, true), eq(videos.hidden, false));

/** Only official/rights-holder pages; https only; no credentials or odd schemes in links we publish. */
const httpsUrl = z.url().max(500).refine((u) => { try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password; } catch { return false; } }, "must be an https:// link");
const watchSchema = z.object({
  matchId: uuid.optional(), seriesId: uuid.optional(),
  region: z.string().regex(/^([A-Z]{2})$/, "2-letter country code, or WW for worldwide"),
  name: z.string().trim().min(2).max(80),
  url: httpsUrl,
  kind: z.enum(["stream", "tv", "radio"]).default("stream"),
  note: z.string().trim().max(160).nullable().optional(),
  sort: z.number().int().min(0).max(100).default(0),
}).refine((v) => !!v.matchId !== !!v.seriesId, "give either matchId or seriesId");

export async function mediaRoutes(app: FastifyInstance, deps: { db: Database; redis: Redis; revalidate: (paths: string[]) => void }) {
  const { db, redis, revalidate } = deps;
  const editor = requireRole("editor", "admin");
  const operator = requireRole("scorer", "admin");
  const matchPaths = async (matchId: string) => {
    const [m] = await db.select({ slug: matches.slug }).from(matches).where(eq(matches.id, matchId));
    return m ? [`/match/${m.slug}`] : [];
  };

  /* ───────────── Public ───────────── */

  /** Where to watch + official videos for one match. Same for every visitor → CDN-cached. */
  app.get<{ Params: { key: string } }>("/v1/matches/:key/media", async (req, reply) => {
    const key = slug.parse(req.params.key);
    const [m] = await db.select({ id: matches.id, seriesId: matches.seriesId }).from(matches).where(eq(matches.slug, key)).limit(1);
    if (!m) return reply.code(404).send({ error: "not_found" });
    const [watch, vids] = await Promise.all([
      db.select({ id: watchOptions.id, region: watchOptions.region, name: watchOptions.name, url: watchOptions.url, kind: watchOptions.kind, note: watchOptions.note })
        .from(watchOptions)
        .where(or(eq(watchOptions.matchId, m.id), m.seriesId ? eq(watchOptions.seriesId, m.seriesId) : sql`false`))
        .orderBy(watchOptions.sort, watchOptions.region, watchOptions.name),
      db.select(publicVideo).from(videos).where(and(eq(videos.matchId, m.id), showable))
        .orderBy(desc(videos.isLive), videos.isShort, sql`${videos.viewCount} desc nulls last`, desc(videos.publishedAt)).limit(12),
    ]);
    reply.header("cache-control", CACHE.short);
    return { watch, videos: vids };
  });

  /**
   * Official videos, unlimited via cursor paging. sort=latest (publish time), popular (YouTube view count, all time),
   * week (most viewed among uploads from the last 7 days). Optional channel filter.
   */
  app.get("/v1/videos", async (req, reply) => {
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(48).default(24),
      sort: z.enum(["latest", "popular", "week"]).default("latest"),
      cursor: z.string().max(200).optional(),
      channel: z.string().regex(CHANNEL_ID).optional(),
      shorts: z.enum(["include", "exclude", "only"]).default("exclude"),
    }).parse(req.query);
    const byViews = q.sort !== "latest";
    const cur = decodeCursor(q.cursor, byViews ? "number" : "date");
    const keyset = !cur ? undefined : byViews
      ? sql`(${videos.viewCount}, ${videos.id}) < (${cur.v as number}, ${cur.id})`
      : sql`(${videos.publishedAt}, ${videos.id}) < (${(cur.v as Date).toISOString()}::timestamptz, ${cur.id})`;
    const rows = await db.select(publicVideo).from(videos)
      .where(and(
        showable, keyset,
        q.shorts === "exclude" ? eq(videos.isShort, false) : q.shorts === "only" ? eq(videos.isShort, true) : undefined,
        q.channel ? eq(videos.channelId, q.channel) : undefined,
        byViews ? sql`${videos.viewCount} is not null` : undefined,
        q.sort === "week" ? sql`${videos.publishedAt} > now() - interval '7 days'` : undefined,
      ))
      .orderBy(...(byViews ? [desc(videos.viewCount), desc(videos.id)] : [desc(videos.publishedAt), desc(videos.id)]))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const next = rows.length > q.limit && last ? encodeCursor(byViews ? last.viewCount! : last.publishedAt.toISOString(), last.id) : null;
    reply.header("cache-control", CACHE.short);
    return { videos: page, next };
  });

  /** Channels shown as filters on /videos. */
  app.get("/v1/videos/channels", async (_req, reply) => {
    const rows = await db.select({ channelId: videoChannels.channelId, name: videoChannels.name }).from(videoChannels).where(eq(videoChannels.enabled, true)).orderBy(videoChannels.name);
    reply.header("cache-control", CACHE.short);
    return { channels: rows };
  });

  /* ───────────── Admin: where to watch ───────────── */
  const adminScope = async (instance: FastifyInstance) => {
    instance.addHook("onSend", async (_req, reply) => { reply.header("cache-control", CACHE.private); });

    instance.get<{ Params: { matchId: string } }>("/v1/admin/media/matches/:matchId", { preHandler: editor }, async (req, reply) => {
      const matchId = uuid.parse(req.params.matchId);
      const [m] = await db.select({ id: matches.id, title: matches.title, slug: matches.slug, seriesId: matches.seriesId, status: matches.status,
        feedProvider: matches.feedProvider, feedMatchId: matches.feedMatchId, feedPaused: matches.feedPaused, feedSyncedAt: matches.feedSyncedAt })
        .from(matches).where(eq(matches.id, matchId));
      if (!m) return reply.code(404).send({ error: "not_found" });
      const [watch, vids] = await Promise.all([
        db.select().from(watchOptions).where(or(eq(watchOptions.matchId, matchId), m.seriesId ? eq(watchOptions.seriesId, m.seriesId) : sql`false`)).orderBy(watchOptions.sort, watchOptions.region),
        db.select().from(videos).where(eq(videos.matchId, matchId)).orderBy(desc(videos.publishedAt)).limit(50),
      ]);
      return { match: m, watch, videos: vids };
    });

    instance.post("/v1/admin/watch-options", { preHandler: editor }, async (req, reply) => {
      const body = watchSchema.parse(req.body);
      const [row] = await db.insert(watchOptions).values({ ...body, matchId: body.matchId ?? null, seriesId: body.seriesId ?? null, note: body.note ?? null }).returning();
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "watch.create", entity: "watch_option", entityId: row!.id, changes: body });
      if (row!.matchId) revalidate(await matchPaths(row!.matchId));
      return reply.code(201).send({ option: row });
    });

    instance.delete<{ Params: { id: string } }>("/v1/admin/watch-options/:id", { preHandler: editor }, async (req, reply) => {
      const [row] = await db.delete(watchOptions).where(eq(watchOptions.id, uuid.parse(req.params.id))).returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "watch.delete", entity: "watch_option", entityId: row.id, changes: row });
      if (row.matchId) revalidate(await matchPaths(row.matchId));
      return { ok: true };
    });

    /* ───────────── Admin: videos ───────────── */
    instance.get("/v1/admin/videos", { preHandler: editor }, async (req) => {
      const q = z.object({ unlinked: z.enum(["1", "0"]).default("0") }).parse(req.query);
      const rows = await db.select().from(videos).where(q.unlinked === "1" ? isNull(videos.matchId) : undefined).orderBy(desc(videos.publishedAt)).limit(100);
      return { videos: rows };
    });

    /** Add an official video by URL (e.g. a board's live stream). Refused unless YouTube confirms it can be embedded. */
    instance.post("/v1/admin/videos", { preHandler: editor }, async (req, reply) => {
      const body = z.object({ url: z.string().trim().min(11).max(300), matchId: uuid.nullable().optional(), isLive: z.boolean().default(false) }).parse(req.body);
      const youtubeId = youtubeIdFromUrl(body.url);
      if (!youtubeId) return reply.code(400).send({ error: "invalid_youtube_url" });
      const check = await checkEmbeddable(youtubeId);
      if (!check) return reply.code(502).send({ error: "youtube_unavailable", message: "Couldn't reach YouTube. Try again." });
      if (!check.embeddable) return reply.code(422).send({ error: "not_embeddable", message: "The owner doesn't allow this video to be embedded. Link to it instead." });
      let seriesId: string | null = null;
      if (body.matchId) {
        const [m] = await db.select({ seriesId: matches.seriesId }).from(matches).where(eq(matches.id, body.matchId));
        if (!m) return reply.code(404).send({ error: "match_not_found" });
        seriesId = m.seriesId;
      }
      const values = { matchId: body.matchId ?? null, seriesId, isLive: body.isLive, hidden: false, embeddable: true };
      const [row] = await db.insert(videos).values({
        youtubeId, title: (check.title ?? "Video").slice(0, 200), channelName: check.channelName?.slice(0, 80) ?? null,
        publishedAt: new Date(), source: "manual", ...values,
      }).onConflictDoUpdate({ target: videos.youtubeId, set: values }).returning();
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "video.add", entity: "video", entityId: row!.id, changes: { youtubeId, ...values } });
      if (row!.matchId) revalidate(await matchPaths(row!.matchId));
      return reply.code(201).send({ video: row });
    });

    instance.patch<{ Params: { id: string } }>("/v1/admin/videos/:id", { preHandler: editor }, async (req, reply) => {
      const body = z.object({ hidden: z.boolean().optional(), matchId: uuid.nullable().optional(), isLive: z.boolean().optional() }).parse(req.body);
      const [before] = await db.select().from(videos).where(eq(videos.id, uuid.parse(req.params.id)));
      if (!before) return reply.code(404).send({ error: "not_found" });
      let seriesId = before.seriesId;
      if (body.matchId !== undefined) {
        seriesId = null;
        if (body.matchId) {
          const [m] = await db.select({ seriesId: matches.seriesId }).from(matches).where(eq(matches.id, body.matchId));
          if (!m) return reply.code(404).send({ error: "match_not_found" });
          seriesId = m.seriesId;
        }
      }
      const [row] = await db.update(videos).set({ ...body, seriesId }).where(eq(videos.id, before.id)).returning();
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "video.update", entity: "video", entityId: before.id, changes: body });
      for (const id of new Set([before.matchId, row!.matchId].filter((x): x is string => !!x))) revalidate(await matchPaths(id));
      return { video: row };
    });

    /* ───────────── Admin: official channels ───────────── */
    instance.get("/v1/admin/video-channels", { preHandler: editor }, async () => ({ channels: await db.select().from(videoChannels).orderBy(videoChannels.name) }));

    instance.post("/v1/admin/video-channels", { preHandler: requireRole("admin") }, async (req, reply) => {
      const body = z.object({ channelId: z.string().regex(CHANNEL_ID, "a YouTube channel id (starts with UC, 24 characters)"), name: z.string().trim().min(2).max(80) }).parse(req.body);
      const [row] = await db.insert(videoChannels).values(body).onConflictDoUpdate({ target: videoChannels.channelId, set: { name: body.name, enabled: true } }).returning();
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "channel.add", entity: "video_channel", changes: body });
      return reply.code(201).send({ channel: row });
    });

    instance.patch<{ Params: { channelId: string } }>("/v1/admin/video-channels/:channelId", { preHandler: requireRole("admin") }, async (req, reply) => {
      const channelId = z.string().regex(CHANNEL_ID).parse(req.params.channelId);
      const body = z.object({ enabled: z.boolean() }).parse(req.body);
      const [row] = await db.update(videoChannels).set(body).where(eq(videoChannels.channelId, channelId)).returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "channel.update", entity: "video_channel", changes: { channelId, ...body } });
      return { channel: row };
    });

    /* ───────────── Admin: live-score feed ───────────── */

    /** Worker heartbeat + matches currently owned by a feed. */
    instance.get("/v1/admin/feed/status", { preHandler: operator }, async () => {
      const raw = await redis.get("feed:status").catch(() => null);
      const linked = await db.select({ id: matches.id, title: matches.title, slug: matches.slug, status: matches.status, feedProvider: matches.feedProvider,
        feedMatchId: matches.feedMatchId, feedPaused: matches.feedPaused, feedSyncedAt: matches.feedSyncedAt })
        .from(matches).where(and(sql`${matches.feedProvider} is not null`, inArray(matches.status, ["SCHEDULED", "TOSS", "LIVE", "INNINGS_BREAK", "STUMPS", "DELAYED"])))
        .orderBy(desc(matches.startsAt)).limit(50);
      return { worker: raw ? JSON.parse(raw) : null, linked };
    });

    /**
     * Link a match to a provider fixture, unlink it, or pause/resume the feed. Pausing hands the match to the
     * manual scorer (e.g. the provider is down or wrong); resuming hands it back and the feed re-syncs everything.
     */
    instance.post<{ Params: { matchId: string } }>("/v1/admin/matches/:matchId/feed", { preHandler: requireRole("admin") }, async (req, reply) => {
      const matchId = uuid.parse(req.params.matchId);
      const body = z.union([
        z.object({ provider: z.enum(["sportmonks"]), feedMatchId: z.string().regex(/^[0-9]{1,20}$/) }),
        z.object({ paused: z.boolean() }),
        z.object({ unlink: z.literal(true) }),
      ]).parse(req.body);
      const set = "provider" in body ? { feedProvider: body.provider, feedMatchId: body.feedMatchId, feedPaused: false }
        : "paused" in body ? { feedPaused: body.paused }
        : { feedProvider: null, feedMatchId: null, feedPaused: false };
      try {
        const [row] = await db.update(matches).set({ ...set, version: sql`${matches.version} + 1` }).where(eq(matches.id, matchId)).returning({ id: matches.id });
        if (!row) return reply.code(404).send({ error: "not_found" });
      } catch (err) {
        if ((err as { cause?: { code?: string } }).cause?.code === "23505") return reply.code(409).send({ error: "feed_already_linked", message: "Another match is already linked to that fixture." });
        throw err;
      }
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "match.feed", entity: "match", entityId: matchId, changes: body });
      await refreshSnapshot(db, redis, matchId);
      return { ok: true };
    });
  };
  await app.register(adminScope);
}

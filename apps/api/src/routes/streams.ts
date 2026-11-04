import { and, desc, eq, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditLogs, matches, streamSources, type Database } from "@cricket/db";
import { CACHE } from "@cricket/shared";
import { requireRole } from "../plugins/roles.js";
import { PROVIDERS, TOKEN_ENV, playbackUrl, rankOf, toPublic, verifyAndStore, youtubeUrl, type StreamConfig, type StreamKind } from "../streams/index.js";
import { youtubeIdFromUrl } from "../feed/youtube.js";

const uuid = z.uuid();
const slug = z.string().min(1).max(200).regex(/^[a-z0-9-]+$/);
const createSchema = z.object({
  matchId: uuid.optional(), seriesId: uuid.optional(),
  kind: z.enum(["youtube", "hls", "embed"]),
  label: z.string().trim().min(2).max(60),
  url: z.string().trim().min(8).max(600),
  region: z.string().regex(/^([A-Z]{2})$/, "2-letter country code, or WW for worldwide").default("WW"),
  priority: z.number().int().min(0).max(100).default(0),
  rightsNote: z.string().trim().min(10, "say who authorised this stream and on what basis").max(300),
  authEnv: z.string().regex(TOKEN_ENV, "must look like STREAM_TOKEN_NAME").nullable().optional(),
}).refine((v) => !!v.matchId !== !!v.seriesId, "give either matchId or seriesId");

/**
 * Live video: public listing for the Watch tab, and the admin tools that decide what may be played. Sources are
 * recorded by people who hold the right to use them; the worker verifies them; the player only claims LIVE for a
 * stream that was proven live.
 */
export async function streamRoutes(app: FastifyInstance, deps: { db: Database; cfg: StreamConfig; fetchImpl?: typeof fetch; revalidate: (paths: string[]) => void }) {
  const { db, cfg } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const editor = requireRole("editor", "admin");
  const admin = requireRole("admin");
  const refresh = async (matchId: string | null, seriesId: string | null) => {
    const rows = await db.select({ slug: matches.slug }).from(matches).where(matchId ? eq(matches.id, matchId) : eq(matches.seriesId, seriesId!)).limit(100);
    deps.revalidate(rows.map((r) => `/match/${r.slug}/watch`));
  };

  /* ───────── Public ───────── */

  /** Sources for one match (its own plus its series'), best first. Same for everyone → CDN-cacheable for a few seconds. */
  app.get<{ Params: { key: string } }>("/v1/matches/:key/streams", async (req, reply) => {
    const [m] = await db.select({ id: matches.id, seriesId: matches.seriesId }).from(matches).where(eq(matches.slug, slug.parse(req.params.key))).limit(1);
    if (!m) return reply.code(404).send({ error: "not_found" });
    const rows = await db.select().from(streamSources).where(and(eq(streamSources.enabled, true), or(eq(streamSources.matchId, m.id), m.seriesId ? eq(streamSources.seriesId, m.seriesId) : sql`false`)));
    rows.sort((a, b) => rankOf(a.lastStatus) - rankOf(b.lastStatus) || b.priority - a.priority);
    reply.header("cache-control", CACHE.live);
    return { sources: rows.map(toPublic) };
  });

  /** The playable URL for a source that needs a server-held access token. Never cached, never logged. */
  app.get<{ Params: { id: string } }>("/v1/streams/:id/playback", async (req, reply) => {
    reply.header("cache-control", CACHE.private);
    const [r] = await db.select().from(streamSources).where(and(eq(streamSources.id, uuid.parse(req.params.id)), eq(streamSources.enabled, true))).limit(1);
    if (!r || r.lastStatus === "offline") return reply.code(404).send({ error: "not_available" });
    const url = playbackUrl(r, cfg);
    if (!url) return reply.code(503).send({ error: "not_configured" }); // credential missing on the server: the viewer just sees "unavailable"
    return { url };
  });

  /* ───────── Admin ───────── */
  await app.register(async (a) => {
    a.addHook("onSend", async (_req, reply) => { reply.header("cache-control", CACHE.private); });

    /** What is configured, without exposing any secret: lets the admin page show "missing credentials" states. */
    a.get("/v1/admin/streams/config", { preHandler: editor }, async () => ({
      hlsHosts: cfg.hlsHosts, embedHosts: cfg.embedHosts, tokenParam: cfg.tokenParam, youtubeLiveCheck: !!cfg.youtubeApiKey,
      tokenVariables: Object.keys(cfg.secrets).filter((k) => TOKEN_ENV.test(k) && cfg.secrets[k]).sort(),
    }));

    a.get<{ Querystring: { matchId?: string; seriesId?: string } }>("/v1/admin/stream-sources", { preHandler: editor }, async (req) => {
      const q = z.object({ matchId: uuid.optional(), seriesId: uuid.optional() }).parse(req.query);
      const rows = await db.select().from(streamSources)
        .where(q.matchId ? eq(streamSources.matchId, q.matchId) : q.seriesId ? eq(streamSources.seriesId, q.seriesId) : undefined)
        .orderBy(desc(streamSources.priority)).limit(200);
      return { sources: rows.map((r) => ({ ...r, authEnvConfigured: r.authEnv ? !!cfg.secrets[r.authEnv] : null, checkState: undefined })) };
    });

    a.post("/v1/admin/stream-sources", { preHandler: editor }, async (req, reply) => {
      const body = createSchema.parse(req.body);
      // Licensed feeds and third-party embeds are rights-sensitive: only admins may add them. Editors may add official YouTube streams.
      if (body.kind !== "youtube" && req.user!.role !== "admin") return reply.code(403).send({ error: "forbidden", message: "Only admins can add licensed HLS or embedded sources." });
      if (body.authEnv && body.kind !== "hls") return reply.code(400).send({ error: "invalid_input", message: "Access tokens apply to HLS sources only." });
      const problem = PROVIDERS[body.kind as StreamKind].validate(body.url, cfg);
      if (problem) return reply.code(400).send({ error: "invalid_source", message: problem });
      const url = body.kind === "youtube" ? youtubeUrl(youtubeIdFromUrl(body.url)!) : body.url;
      const [row] = await db.insert(streamSources).values({
        matchId: body.matchId ?? null, seriesId: body.seriesId ?? null, kind: body.kind, label: body.label, url, region: body.region, priority: body.priority,
        rightsNote: body.rightsNote, authEnv: body.authEnv ?? null, createdBy: req.user!.id,
      }).returning();
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "stream.create", entity: "stream_source", entityId: row!.id, changes: { kind: body.kind, label: body.label, region: body.region, rightsNote: body.rightsNote } }); // never the URL or token
      const checked = await verifyAndStore(db, row!, cfg, fetchImpl);
      await refresh(row!.matchId, row!.seriesId);
      return reply.code(201).send({ source: { ...row, lastStatus: checked.status, lastDetail: checked.detail, checkState: undefined } });
    });

    a.patch<{ Params: { id: string } }>("/v1/admin/stream-sources/:id", { preHandler: editor }, async (req, reply) => {
      const body = z.object({ enabled: z.boolean().optional(), label: z.string().trim().min(2).max(60).optional(), priority: z.number().int().min(0).max(100).optional(), region: z.string().regex(/^[A-Z]{2}$/).optional() }).parse(req.body);
      const [row] = await db.update(streamSources).set(body).where(eq(streamSources.id, uuid.parse(req.params.id))).returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "stream.update", entity: "stream_source", entityId: row.id, changes: body });
      await refresh(row.matchId, row.seriesId);
      return { source: { ...row, checkState: undefined } };
    });

    a.delete<{ Params: { id: string } }>("/v1/admin/stream-sources/:id", { preHandler: admin }, async (req, reply) => {
      const [row] = await db.delete(streamSources).where(eq(streamSources.id, uuid.parse(req.params.id))).returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "stream.delete", entity: "stream_source", entityId: row.id, changes: { kind: row.kind, label: row.label } });
      await refresh(row.matchId, row.seriesId);
      return { ok: true };
    });

    a.post<{ Params: { id: string } }>("/v1/admin/stream-sources/:id/verify", { preHandler: editor, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
      const [row] = await db.select().from(streamSources).where(eq(streamSources.id, uuid.parse(req.params.id)));
      if (!row) return reply.code(404).send({ error: "not_found" });
      const r = await verifyAndStore(db, row, cfg, fetchImpl);
      if (r.changed) await refresh(row.matchId, row.seriesId);
      return { status: r.status, detail: r.detail };
    });
  });
}

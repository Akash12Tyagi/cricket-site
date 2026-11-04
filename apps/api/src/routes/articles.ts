import { and, desc, eq, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { articles, articleTags, auditLogs, tags, users, type Database } from "@cricket/db";
import { CACHE } from "@cricket/shared";
import { renderArticle } from "../lib/markdown.js";
import { requireRole } from "../plugins/roles.js";

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 120);
const articleInput = z.object({
  title: z.string().trim().min(5).max(200),
  summary: z.string().trim().max(400).nullable().optional(),
  bodyMarkdown: z.string().max(100_000),
  heroImageUrl: z.url({ protocol: /^https$/ }).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});
const published = and(isNotNull(articles.publishedAt), lte(articles.publishedAt, sql`now()`));

export async function articleRoutes(app: FastifyInstance, deps: { db: Database; revalidate?: (paths: string[]) => void }) {
  const { db } = deps;
  /** Pages that show a given story: refresh them immediately after any change. */
  const refresh = (slug: string) => deps.revalidate?.(["/news", `/news/${slug}`, "/news/tag/[tag]", "/sitemap.xml"]);
  const editor = requireRole("editor", "admin");

  const tagsFor = async (ids: string[]) => {
    if (!ids.length) return new Map<string, { name: string; slug: string }[]>();
    const rows = await db.select({ articleId: articleTags.articleId, name: tags.name, slug: tags.slug })
      .from(articleTags).innerJoin(tags, eq(tags.id, articleTags.tagId)).where(inArray(articleTags.articleId, ids));
    const map = new Map<string, { name: string; slug: string }[]>();
    for (const r of rows) map.set(r.articleId, [...(map.get(r.articleId) ?? []), { name: r.name, slug: r.slug }]);
    return map;
  };

  const setTags = async (tx: Database, articleId: string, names: string[]) => {
    await tx.delete(articleTags).where(eq(articleTags.articleId, articleId));
    const unique = [...new Map(names.map((n) => [slugify(n), n])).entries()].filter(([s]) => s);
    if (!unique.length) return;
    await tx.insert(tags).values(unique.map(([slug, name]) => ({ slug, name }))).onConflictDoNothing();
    const rows = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.slug, unique.map(([s]) => s)));
    await tx.insert(articleTags).values(rows.map((r) => ({ articleId, tagId: r.id }))).onConflictDoNothing();
  };

  /* ───── Public ───── */

  app.get("/v1/articles", async (req, reply) => {
    const q = z.object({ tag: z.string().regex(/^[a-z0-9-]+$/).max(120).optional(), before: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
    const filters = [published, q.before ? lt(articles.publishedAt, q.before) : undefined];
    if (q.tag) filters.push(sql`${articles.id} in (select ${articleTags.articleId} from ${articleTags} join ${tags} on ${tags.id} = ${articleTags.tagId} where ${tags.slug} = ${q.tag})`);
    const rows = await db.select({ id: articles.id, title: articles.title, slug: articles.slug, summary: articles.summary, heroImageUrl: articles.heroImageUrl, publishedAt: articles.publishedAt })
      .from(articles).where(and(...filters)).orderBy(desc(articles.publishedAt)).limit(q.limit);
    const t = await tagsFor(rows.map((r) => r.id));
    reply.header("cache-control", CACHE.short);
    return { articles: rows.map((r) => ({ ...r, tags: t.get(r.id) ?? [] })), nextBefore: rows.length === q.limit ? rows.at(-1)!.publishedAt : null };
  });

  app.get<{ Params: { slug: string } }>("/v1/articles/:slug", async (req, reply) => {
    const slug = z.string().regex(/^[a-z0-9-]+$/).max(220).parse(req.params.slug);
    const [a] = await db.select({
      id: articles.id, title: articles.title, slug: articles.slug, summary: articles.summary, bodyHtml: articles.bodyHtml,
      heroImageUrl: articles.heroImageUrl, publishedAt: articles.publishedAt, updatedAt: articles.updatedAt, author: users.displayName,
    }).from(articles).leftJoin(users, eq(users.id, articles.authorId)).where(and(eq(articles.slug, slug), published)).limit(1);
    if (!a) return reply.code(404).send({ error: "not_found" });
    reply.header("cache-control", CACHE.short);
    return { article: { ...a, tags: (await tagsFor([a.id])).get(a.id) ?? [] } };
  });

  /* ───── Editors ───── */

  app.register(async (admin) => {
    admin.addHook("onSend", async (_req, reply) => { reply.header("cache-control", CACHE.private); });

    admin.get("/v1/admin/articles", { preHandler: editor }, async () => {
      const rows = await db.select({ id: articles.id, title: articles.title, slug: articles.slug, publishedAt: articles.publishedAt, updatedAt: articles.updatedAt })
        .from(articles).orderBy(desc(articles.updatedAt)).limit(200);
      return { articles: rows };
    });

    admin.get<{ Params: { id: string } }>("/v1/admin/articles/:id", { preHandler: editor }, async (req, reply) => {
      const id = z.uuid().parse(req.params.id);
      const [a] = await db.select().from(articles).where(eq(articles.id, id));
      if (!a) return reply.code(404).send({ error: "not_found" });
      return { article: { ...a, tags: ((await tagsFor([id])).get(id) ?? []).map((t) => t.name) } };
    });

    admin.post("/v1/admin/articles", { preHandler: editor }, async (req, reply) => {
      const input = articleInput.parse(req.body);
      const base = slugify(input.title) || "article";
      const row = await db.transaction(async (tx) => {
        const taken = await tx.$count(articles, sql`${articles.slug} = ${base} or ${articles.slug} like ${base + "-%"}`);
        const [a] = await tx.insert(articles).values({
          title: input.title, slug: taken ? `${base}-${taken + 1}` : base, summary: input.summary ?? null,
          bodyMarkdown: input.bodyMarkdown, bodyHtml: renderArticle(input.bodyMarkdown), heroImageUrl: input.heroImageUrl ?? null, authorId: req.user!.id,
        }).returning({ id: articles.id, slug: articles.slug });
        await setTags(tx as unknown as Database, a!.id, input.tags);
        await tx.insert(auditLogs).values({ actorId: req.user!.id, action: "article.create", entity: "article", entityId: a!.id, changes: { title: input.title } });
        return a!;
      });
      return reply.code(201).send({ article: row });
    });

    admin.patch<{ Params: { id: string } }>("/v1/admin/articles/:id", { preHandler: editor }, async (req, reply) => {
      const id = z.uuid().parse(req.params.id);
      const input = articleInput.parse(req.body);
      const ok = await db.transaction(async (tx) => {
        const [a] = await tx.update(articles).set({
          title: input.title, summary: input.summary ?? null, bodyMarkdown: input.bodyMarkdown, bodyHtml: renderArticle(input.bodyMarkdown), heroImageUrl: input.heroImageUrl ?? null,
        }).where(eq(articles.id, id)).returning({ id: articles.id, slug: articles.slug, publishedAt: articles.publishedAt });
        if (!a) return false;
        if (a.publishedAt) refresh(a.slug);
        await setTags(tx as unknown as Database, id, input.tags);
        await tx.insert(auditLogs).values({ actorId: req.user!.id, action: "article.update", entity: "article", entityId: id, changes: { title: input.title } });
        return true;
      });
      return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
    });

    admin.post<{ Params: { id: string } }>("/v1/admin/articles/:id/publish", { preHandler: editor }, async (req, reply) => {
      const id = z.uuid().parse(req.params.id);
      const { publish } = z.object({ publish: z.boolean() }).parse(req.body);
      const [a] = await db.update(articles).set({ publishedAt: publish ? sql`coalesce(${articles.publishedAt}, now())` : null }).where(eq(articles.id, id)).returning({ slug: articles.slug });
      if (!a) return reply.code(404).send({ error: "not_found" });
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: publish ? "article.publish" : "article.unpublish", entity: "article", entityId: id, changes: null });
      refresh(a.slug);
      return { ok: true, slug: a.slug };
    });

    admin.delete<{ Params: { id: string } }>("/v1/admin/articles/:id", { preHandler: editor }, async (req) => {
      const id = z.uuid().parse(req.params.id);
      const [gone] = await db.delete(articles).where(eq(articles.id, id)).returning({ slug: articles.slug });
      if (gone) refresh(gone.slug);
      await db.insert(auditLogs).values({ actorId: req.user!.id, action: "article.delete", entity: "article", entityId: id, changes: null });
      return { ok: true };
    });
  });
}

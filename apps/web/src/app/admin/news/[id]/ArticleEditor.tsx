"use client";

import { useState, type FormEvent } from "react";

export type EditableArticle = { id: string; title: string; slug: string; summary: string | null; bodyMarkdown: string; heroImageUrl: string | null; publishedAt: string | null; tags: string[] };

const field = "w-full rounded-lg border border-line px-3 py-2";

export function ArticleEditor({ initial }: { initial: EditableArticle | null }) {
  const [a, setA] = useState({
    title: initial?.title ?? "", summary: initial?.summary ?? "", heroImageUrl: initial?.heroImageUrl ?? "",
    tags: (initial?.tags ?? []).join(", "), bodyMarkdown: initial?.bodyMarkdown ?? "",
  });
  const [id, setId] = useState(initial?.id ?? null);
  const [slug, setSlug] = useState(initial?.slug ?? null);
  const [published, setPublished] = useState(!!initial?.publishedAt);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const payload = () => ({
    title: a.title.trim(), summary: a.summary.trim() || null, heroImageUrl: a.heroImageUrl.trim() || null,
    bodyMarkdown: a.bodyMarkdown, tags: a.tags.split(",").map((t) => t.trim()).filter(Boolean),
  });
  const send = async (url: string, method: string, body: unknown) => {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setMsg(null);
    const r = id ? await send(`/api/v1/admin/articles/${id}`, "PATCH", payload()) : await send("/api/v1/admin/articles", "POST", payload());
    if (r.ok) {
      if (!id) { setId(r.data.article.id); setSlug(r.data.article.slug); window.history.replaceState(null, "", `/admin/news/${r.data.article.id}`); }
      setMsg({ ok: true, text: "Saved." });
    } else {
      const issues = (r.data.issues as { path: string; message: string }[] | undefined)?.map((i) => `${i.path}: ${i.message}`).join("; ");
      setMsg({ ok: false, text: issues ?? "Couldn't save. Check the fields and try again." });
    }
    setBusy(false);
    return r.ok;
  };

  const togglePublish = async () => {
    if (!id) return;
    if (!(await save())) return;
    setBusy(true);
    const r = await send(`/api/v1/admin/articles/${id}/publish`, "POST", { publish: !published });
    if (r.ok) { setPublished(!published); setMsg({ ok: true, text: published ? "Unpublished (now a draft)." : "Published. It's live on the site now." }); }
    setBusy(false);
  };

  const set = (k: keyof typeof a) => (e: { target: { value: string } }) => setA((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form onSubmit={save} className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{id ? "Edit story" : "New story"}</h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${published ? "bg-brand-100 text-brand-900" : "bg-canvas text-muted"}`}>{published ? "Published" : "Draft"}</span>
        {published && slug && <a href={`/news/${slug}`} target="_blank" rel="noreferrer" className="ml-auto text-sm text-brand-700 underline">View live</a>}
      </div>
      {msg && <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-brand-50" : "bg-red-50 text-live"}`}>{msg.text}</p>}
      <label className="block text-sm font-medium">Headline<input required minLength={5} maxLength={200} value={a.title} onChange={set("title")} className={field} /></label>
      <label className="block text-sm font-medium">Summary<input maxLength={400} value={a.summary} onChange={set("summary")} className={field} /></label>
      <label className="block text-sm font-medium">Hero image URL (https only)<input type="url" pattern="https://.*" value={a.heroImageUrl} onChange={set("heroImageUrl")} className={field} /></label>
      <label className="block text-sm font-medium">Tags (comma separated, e.g. Coastal Comets, T20)<input value={a.tags} onChange={set("tags")} className={field} /></label>
      <label className="block text-sm font-medium">Story (Markdown: ## heading, **bold**, *italic*, [link](https://…), - list)
        <textarea rows={18} value={a.bodyMarkdown} onChange={set("bodyMarkdown")} className={`${field} font-mono text-sm`} />
      </label>
      <p className="text-xs text-muted">HTML is not allowed and is removed on save. Scripts, embeds and non-https links are stripped automatically.</p>
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50">Save draft</button>
        <button type="button" disabled={busy || !id} onClick={togglePublish} className="rounded-lg bg-brand-700 px-4 py-2 text-sm text-white disabled:opacity-50" title={id ? "" : "Save first"}>
          {published ? "Unpublish" : "Publish"}
        </button>
      </div>
    </form>
  );
}

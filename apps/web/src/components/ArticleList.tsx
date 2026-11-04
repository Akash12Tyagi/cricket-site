import Link from "next/link";
import { LocalTime } from "./LocalTime";
import { StitchMark } from "./Seam";

export type ArticleSummary = { id: string; title: string; slug: string; summary: string | null; publishedAt: string; tags: { name: string; slug: string }[] };

function Tags({ tags, light = false, max = 3 }: { tags: ArticleSummary["tags"]; light?: boolean; max?: number }) {
  return (
    <>
      {tags.slice(0, max).map((t) => (
        <Link key={t.slug} href={`/news/tag/${t.slug}`} className={`relative z-10 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${light ? "bg-white/12 text-white hover:bg-white/20" : "bg-canvas text-ink/75 hover:bg-brand-50 hover:text-leather-700"}`}>{t.name}</Link>
      ))}
    </>
  );
}

const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:translate-x-1"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/**
 * Stories at three scales: the newest as a leather lead, the next two side by side, then the rest as a stitched
 * running list (like a scorer's notes): a page with rhythm, not a wall of identical cards.
 */
export function ArticleList({ articles, lead = true }: { articles: ArticleSummary[]; lead?: boolean }) {
  if (articles.length === 0) return <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-6 text-sm text-muted">No stories yet.</p>;
  const first = lead ? articles[0] : undefined;
  const second = lead ? articles.slice(1, 3) : [];
  const rest = lead ? articles.slice(3) : articles;
  return (
    <div className="space-y-8">
      {first && (
        <article className="group relative overflow-hidden rounded-[28px] bg-leather-800 p-6 text-white shadow-[0_30px_60px_-30px_rgba(61,7,16,0.7)] sm:p-10">
          <div aria-hidden className="seam-stitch absolute inset-x-0 top-0 opacity-70" />
          <h2 className="wide max-w-3xl text-2xl font-black leading-tight tracking-tight sm:text-4xl">
            <Link href={`/news/${first.slug}`} className="after:absolute after:inset-0">{first.title}</Link>
          </h2>
          {first.summary && <p className="mt-3 max-w-2xl text-thread/85 sm:text-lg">{first.summary}</p>}
          <p className="mt-5 flex flex-wrap items-center gap-2 text-sm text-thread/80"><LocalTime iso={first.publishedAt} style="date" /> <Tags tags={first.tags} light /></p>
          <span aria-hidden className="mt-6 inline-flex items-center gap-1.5 font-bold text-thread">Read the story <Chevron /></span>
        </article>
      )}
      {second.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          {second.map((a) => (
            <article key={a.id} className="group relative rounded-[var(--radius-card)] border-2 border-leather-700/15 bg-surface p-6 transition-colors hover:border-leather-600/45">
              <h2 className="wide text-xl font-black leading-snug tracking-tight group-hover:text-leather-700 sm:text-2xl"><Link href={`/news/${a.slug}`} className="after:absolute after:inset-0">{a.title}</Link></h2>
              {a.summary && <p className="mt-2 text-muted">{a.summary}</p>}
              <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted"><LocalTime iso={a.publishedAt} style="date" /><Tags tags={a.tags} /></p>
            </article>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <ol className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {rest.map((a) => (
            <li key={a.id} className="group relative flex gap-4 px-5 py-4 transition-colors hover:bg-brand-50/60">
              <span className="pt-1.5"><StitchMark state="finished" /></span>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold leading-snug group-hover:text-leather-700"><Link href={`/news/${a.slug}`} className="after:absolute after:inset-0">{a.title}</Link></h3>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted"><LocalTime iso={a.publishedAt} style="date" /><Tags tags={a.tags} max={2} /></p>
              </div>
              <span className="hidden self-center text-leather-700 sm:block"><Chevron /></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

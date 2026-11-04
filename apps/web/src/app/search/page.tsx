import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { apiGet } from "@/lib/api";

export const metadata: Metadata = { title: "Search", robots: { index: false, follow: true } };

type Hit = { name: string; slug: string; extra: string | null };
type Results = { players: Hit[]; teams: Hit[]; series: Hit[]; articles: Hit[] };
const SECTIONS: { key: keyof Results; label: string; href: (s: string) => string }[] = [
  { key: "players", label: "Players", href: (s) => `/player/${s}` },
  { key: "teams", label: "Teams", href: (s) => `/teams/${s}` },
  { key: "series", label: "Series", href: (s) => `/series/${s}` },
  { key: "articles", label: "News", href: (s) => `/news/${s}` },
];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? "";
  const res = q.length >= 2 ? await apiGet<Results>(`/v1/search?q=${encodeURIComponent(q)}`, 60).catch(() => "error" as const) : null;
  const total = res && res !== "error" ? SECTIONS.reduce((n, s) => n + res[s.key].length, 0) : 0;
  return (
    <div className="space-y-8">
      <PageHero title="Search" subtitle={
        <form action="/search" role="search" className="mt-3 flex max-w-xl gap-2">
          <label htmlFor="q" className="sr-only">Search</label>
          <input id="q" name="q" type="search" defaultValue={q} minLength={2} maxLength={80} placeholder="Players, teams, series, news" className="w-full rounded-full border border-white/20 bg-white px-5 py-3 text-base text-ink placeholder:text-muted" />
          <button className="rounded-full bg-leather-600 px-6 font-bold text-white transition-transform hover:-translate-y-0.5">Search</button>
        </form>} />
      <div className="mx-auto max-w-3xl space-y-6">
      {q.length > 0 && q.length < 2 && <p className="text-sm text-muted">Type at least 2 characters.</p>}
      {res === "error" && <p className="text-muted">Search is temporarily unavailable.</p>}
      {res && res !== "error" && (total === 0 ? <p className="text-muted">No results for &ldquo;{q}&rdquo;.</p> : SECTIONS.filter((s) => res[s.key].length).map((s) => (
        <section key={s.key} aria-labelledby={`r-${s.key}`}>
          <h2 id={`r-${s.key}`} className="wide mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-leather-700">{s.label}</h2>
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
            {res[s.key].map((h) => <li key={h.slug}><Link href={s.href(h.slug)} className="block p-3.5 hover:bg-brand-50"><span className="font-medium">{h.name}</span>{h.extra && <span className="ml-2 text-xs text-muted">{h.extra.slice(0, 80)}</span>}</Link></li>)}
          </ul>
        </section>
      )))}
      </div>
    </div>
  );
}

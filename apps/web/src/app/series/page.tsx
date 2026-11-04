import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { apiGet } from "@/lib/api";

export const revalidate = 300;
export const metadata: Metadata = { title: "Cricket series", description: "All cricket series and tournaments.", alternates: { canonical: "/series" } };

type SeriesList = { series: { id: string; name: string; slug: string; season: string | null; matchCount: number }[] };

export default async function SeriesIndex() {
  const data = await apiGet<SeriesList>("/v1/series", 300);
  return (
    <div className="space-y-8">
      <PageHero title="Series" subtitle="Tours, leagues and tournaments: every series we have scores for." />
      {!data || data.series.length === 0 ? <p className="text-muted">No series yet.</p> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.series.map((s) => (
            <li key={s.id}>
              <Link href={`/series/${s.slug}`} className="group flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-14px_rgba(93,10,21,0.4)]">
                {s.season && <span className="wide mb-2 text-xs font-bold uppercase tracking-[0.12em] text-leather-700">{s.season}</span>}
                <span className="font-bold leading-snug group-hover:text-leather-700">{s.name}</span>
                <span className="mt-auto pt-4 text-sm text-muted"><span className="score font-bold text-ink">{s.matchCount}</span> match{s.matchCount === 1 ? "" : "es"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

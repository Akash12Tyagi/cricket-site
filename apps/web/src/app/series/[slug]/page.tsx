import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FixtureDays } from "@/components/FixtureDays";
import { PageHero, SectionTitle } from "@/components/PageHero";
import { ResultRows } from "@/components/ResultRows";
import { apiGet, type MatchSummary } from "@/lib/api";

export const revalidate = 60;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

type Data = { series: { name: string; slug: string; season: string | null }; matches: MatchSummary[] };
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await apiGet<Data>(`/v1/series/${(await params).slug}`, 60);
  if (!d) return { title: "Series" };
  return { title: `${d.series.name}: fixtures, results & scores`, alternates: { canonical: `/series/${d.series.slug}` } };
}

export default async function SeriesPage({ params }: Props) {
  const d = await apiGet<Data>(`/v1/series/${(await params).slug}`, 60);
  if (d === null) notFound();
  const done = d.matches.filter((m) => ["COMPLETED", "ABANDONED", "CANCELLED"].includes(m.status));
  const rest = d.matches.filter((m) => !done.includes(m));
  return (
    <div className="space-y-10">
      <PageHero title={d.series.name} subtitle={<>{d.series.season ? `${d.series.season} · ` : ""}{d.matches.length} matches · {done.length} played</>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="fx"><SectionTitle id="fx">Fixtures</SectionTitle><FixtureDays matches={rest} limit={80} /></section>
        <section aria-labelledby="rs"><SectionTitle id="rs">Results</SectionTitle><ResultRows matches={[...done].reverse()} /></section>
      </div>
    </div>
  );
}

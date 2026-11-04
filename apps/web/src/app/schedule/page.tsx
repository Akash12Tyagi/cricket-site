import type { Metadata } from "next";
import { FixtureDays } from "@/components/FixtureDays";
import { PageHero, SectionTitle } from "@/components/PageHero";
import { ResultRows } from "@/components/ResultRows";
import { apiGet, type MatchSummary } from "@/lib/api";

export const revalidate = 60;
export const metadata: Metadata = { title: "Cricket schedule & results", description: "Upcoming cricket fixtures and recent results.", alternates: { canonical: "/schedule" } };

type List = { matches: MatchSummary[] };
const pick = (r: List | null) => r?.matches ?? [];

export default async function SchedulePage() {
  const [upcoming, results] = await Promise.all([apiGet<List>("/v1/schedule?kind=upcoming", 60), apiGet<List>("/v1/schedule?kind=results", 300)]);
  return (
    <div className="space-y-10">
      <PageHero title="Schedule" subtitle="Every fixture in your local time, and the latest results from around the world." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="up"><SectionTitle id="up">Fixtures</SectionTitle><FixtureDays matches={pick(upcoming)} limit={60} /></section>
        <section aria-labelledby="res"><SectionTitle id="res">Results</SectionTitle><ResultRows matches={pick(results).slice(0, 25)} /></section>
      </div>
    </div>
  );
}

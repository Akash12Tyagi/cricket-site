import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowButton } from "@/components/FollowButton";
import { MatchList } from "@/components/MatchList";
import { PageHero, SectionTitle } from "@/components/PageHero";
import { TeamBadge } from "@/components/TeamBadge";
import { apiGet, type MatchSummary } from "@/lib/api";

export const revalidate = 300;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

type Data = {
  team: { id: string; name: string; shortName: string; slug: string };
  upcoming: MatchSummary[]; results: MatchSummary[];
  squad: { id: string; name: string; knownAs: string | null; slug: string; playingRole: string | null }[];
};
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await apiGet<Data>(`/v1/teams/${(await params).slug}`, 300);
  if (!d) return { title: "Team" };
  return { title: `${d.team.name} cricket team: squad, fixtures & results`, alternates: { canonical: `/teams/${d.team.slug}` } };
}

export default async function TeamPage({ params }: Props) {
  const d = await apiGet<Data>(`/v1/teams/${(await params).slug}`, 300);
  if (d === null) notFound();
  return (
    <div className="space-y-10">
      <PageHero title={d.team.name} size="lg" lead={<TeamBadge name={d.team.name} shortName={d.team.shortName} size={88} className="max-sm:!size-16" />}
        subtitle={`${d.upcoming.length} upcoming · ${d.results.length} recent results · ${d.squad.length} players in recent squads`}
        aside={<span className="[&_button]:border-white/30 [&_button]:text-white"><FollowButton kind="team" id={d.team.id} name={d.team.name} /></span>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-10">
          <section aria-labelledby="tf"><SectionTitle id="tf">Fixtures</SectionTitle><MatchList matches={d.upcoming} empty="No upcoming fixtures." /></section>
          <section aria-labelledby="tr"><SectionTitle id="tr">Recent results</SectionTitle><MatchList matches={d.results} empty="No results yet." /></section>
        </div>
        <aside aria-labelledby="squad" className="h-fit">
          <SectionTitle id="squad">Recent squad</SectionTitle>
          {d.squad.length === 0 ? <p className="text-sm text-muted">No players yet.</p> : (
            <ul className="grid grid-cols-2 gap-2">
              {d.squad.map((p) => (
                <li key={p.id}>
                  <Link href={`/player/${p.slug}`} className="block h-full rounded-xl border border-line bg-surface px-3 py-2.5 transition-colors hover:border-leather-600/40 hover:bg-brand-50">
                    <span className="block text-sm font-semibold leading-tight">{p.knownAs ?? p.name}</span>
                    {p.playingRole && <span className="text-xs text-muted">{p.playingRole}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, SectionTitle } from "@/components/PageHero";
import { TeamBadge } from "@/components/TeamBadge";
import { apiGet } from "@/lib/api";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Cricket teams", description: "International, league and domestic cricket teams.", alternates: { canonical: "/teams" } };

type Teams = { teams: { id: string; name: string; shortName: string; slug: string; kind: string }[] };
const SHORT: Record<string, string> = { INTERNATIONAL_MEN: "Men", INTERNATIONAL_WOMEN: "Women", LEAGUE: "Leagues", DOMESTIC: "Domestic" };
const KIND: Record<string, string> = { INTERNATIONAL_MEN: "International (men)", INTERNATIONAL_WOMEN: "International (women)", LEAGUE: "Leagues", DOMESTIC: "Domestic" };

export default async function TeamsIndex() {
  const data = await apiGet<Teams>("/v1/teams", 3600);
  if (!data) return <p className="text-muted">No teams yet.</p>;
  const groups = Object.keys(KIND).map((k) => [k, data.teams.filter((t) => t.kind === k)] as const).filter(([, l]) => l.length);
  return (
    <div className="space-y-10">
      <PageHero title="Teams" subtitle={`${data.teams.length} national sides, franchises and domestic teams. Pick yours.`}
        aside={<div className="flex gap-2">{groups.map(([k, l]) => <span key={k} className="rounded-2xl bg-white/[0.08] px-3 py-2 text-center"><span className="score block text-2xl font-black text-white">{l.length}</span><span className="text-[11px] uppercase tracking-wide text-white/60">{SHORT[k]}</span></span>)}</div>} />
      {groups.map(([kind, list]) => (
        <section key={kind} aria-labelledby={`k-${kind}`}>
          <SectionTitle id={`k-${kind}`}>{KIND[kind]}</SectionTitle>
          {/* A badge wall: every side as its badge and name, wrapping like a scoreboard of flags. */}
          <ul className="flex flex-wrap gap-2.5">
            {list.map((t) => (
              <li key={t.id}>
                <Link href={`/teams/${t.slug}`} className="group inline-flex items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-4 text-sm font-semibold transition-[border-color,background-color,transform] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:border-leather-600/40 hover:bg-brand-50 hover:text-leather-700">
                  <TeamBadge name={t.name} shortName={t.shortName} size={34} className="transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:rotate-[-12deg] group-hover:scale-110" />
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

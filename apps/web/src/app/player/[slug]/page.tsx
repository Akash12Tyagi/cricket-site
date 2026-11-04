import { formatLabel, venueLabel } from "@cricket/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowButton } from "@/components/FollowButton";
import { PlayerCard } from "@/components/PlayerCard";
import { SectionTitle } from "@/components/PageHero";
import { MatchList } from "@/components/MatchList";
import { apiGet, type MatchSummary } from "@/lib/api";

export const revalidate = 600;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

type Bat = { format: string; innings: number; runs: number; balls: number; fours: number; sixes: number; outs: number; highest: number; fifties: number; hundreds: number };
type Bowl = { format: string; innings: number; balls: number; runs: number; wickets: number; maidens: number };
type Ref = { date: string; slug: string; opponent: string; venue: string | null };
type FormBat = { runs: number; balls: number; out: boolean; format: string; date: string; slug: string; opponent: string };
type FormBowl = { wickets: number; runs: number; balls: number; format: string; date: string; slug: string; opponent: string };
type Data = {
  player: {
    id: string; fullName: string; knownAs: string | null; slug: string; country: string | null; dateOfBirth: string | null;
    birthPlace: string | null; heightCm: number | null; battingStyle: string | null; bowlingStyle: string | null; playingRole: string | null;
    sources: { wikidata: string | null; cricsheet: boolean };
  };
  batting: Bat[]; bowling: Bowl[];
  timeline: { format: string; matches: number; debut: Ref; last: Ref }[];
  form: { batting: FormBat[]; bowling: FormBowl[] };
  teams: { name: string; slug: string; matches: number }[];
  recentMatches: MatchSummary[];
};
type Props = { params: Promise<{ slug: string }> };

// Club T20 is labelled "(leagues)" on profiles so it isn't confused with T20 internationals.
const fmt = (f: string) => (f === "T20" ? "T20 (leagues)" : formatLabel(f));
const avg = (runs: number, outs: number) => (outs ? (runs / outs).toFixed(2) : "-");
const sr = (runs: number, balls: number) => (balls ? ((runs / balls) * 100).toFixed(2) : "-");
const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const age = (dob: string) => { const d = new Date(dob), n = new Date(); return n.getUTCFullYear() - d.getUTCFullYear() - (n < new Date(Date.UTC(n.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) ? 1 : 0); };
const card = "overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[0_8px_24px_-18px_rgba(21,24,32,0.35)] [&_td]:tabular-nums";
const th = "px-2 py-1 text-right font-normal";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await apiGet<Data>(`/v1/players/${(await params).slug}`, 600);
  if (!d) return { title: "Player" };
  const name = d.player.knownAs ?? d.player.fullName;
  return { title: `${name}: profile, stats & recent form`, alternates: { canonical: `/player/${d.player.slug}` } };
}

export default async function PlayerPage({ params }: Props) {
  const d = await apiGet<Data>(`/v1/players/${(await params).slug}`, 600);
  if (d === null) notFound();
  const p = d.player;
  const facts: [string, string | null][] = [
    ["Full name", p.fullName],
    ["Born", p.dateOfBirth ? `${day(p.dateOfBirth)} (age ${age(p.dateOfBirth)})` : null],
    ["Birthplace", p.birthPlace],
    ["Height", p.heightCm ? `${p.heightCm} cm` : null],
    ["Country", p.country],
    ["Role", p.playingRole], ["Batting", p.battingStyle], ["Bowling", p.bowlingStyle],
  ];
  const runs = d.batting.reduce((n, b) => n + b.runs, 0);
  const wickets = d.bowling.reduce((n, b) => n + b.wickets, 0);
  const matchesPlayed = d.timeline.reduce((n, t) => n + t.matches, 0);
  const hundreds = d.batting.reduce((n, b) => n + b.hundreds, 0);
  const best = { label: "Hundreds", value: hundreds };
  const redBall = d.timeline.some((t) => t.format === "TEST" || t.format === "FIRST_CLASS");
  return (
    <div className="space-y-12">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[440px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24">
          <PlayerCard name={p.knownAs ?? p.fullName} country={p.country}
            role={[p.playingRole, p.battingStyle, p.bowlingStyle].filter(Boolean).join(" · ") || null} ball={redBall ? "red" : "white"}
            formats={d.timeline.map((t) => ({ label: fmt(t.format), ball: t.format === "TEST" || t.format === "FIRST_CLASS" ? "red" as const : "white" as const, matches: t.matches }))}
            span={d.timeline.length ? { from: String(Math.min(...d.timeline.map((t) => new Date(t.debut.date).getUTCFullYear()))), to: String(Math.max(...d.timeline.map((t) => new Date(t.last.date).getUTCFullYear()))) } : null}
            stats={[{ label: "Matches", value: matchesPlayed }, { label: "Runs", value: runs }, ...(wickets ? [{ label: "Wickets", value: wickets }] : []), best]}
            facts={facts.filter((f): f is [string, string] => !!f[1]).map(([label, value]) => ({ label, value }))}
            teams={d.teams.map((t) => t.name)} />
          <div className="mt-4 flex justify-center"><FollowButton kind="player" id={p.id} name={p.knownAs ?? p.fullName} /></div>
        </div>
        <div className="space-y-8">
          {d.teams.length > 0 && (
            <section aria-labelledby="teams">
              <SectionTitle id="teams">Teams</SectionTitle>
              <p className="flex flex-wrap gap-2">{d.teams.map((t) => <Link key={t.slug} href={`/teams/${t.slug}`} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium transition-colors hover:border-leather-600/40 hover:bg-brand-50">{t.name}</Link>)}</p>
            </section>
          )}
      <section aria-labelledby="bat" className={card}>
        <h2 id="bat" className="wide mb-3 text-lg font-bold">Batting career</h2>
        {d.batting.length === 0 ? <p className="text-sm text-muted">No batting yet.</p> : (
          <table className="w-full text-sm"><thead className="text-xs text-muted"><tr><th className="text-left font-normal">Format</th><th className={th}>Inns</th><th className={th}>NO</th><th className={th}>Runs</th><th className={th}>HS</th><th className={th}>Avg</th><th className={th}>SR</th><th className={th}>100s</th><th className={th}>50s</th><th className={th}>4s</th><th className={th}>6s</th></tr></thead>
            <tbody>{d.batting.map((b) => <tr key={b.format} className="border-t border-line text-right"><td className="py-1.5 text-left font-medium">{fmt(b.format)}</td><td className="px-2">{b.innings}</td><td className="px-2">{b.innings - b.outs}</td><td className="px-2 font-semibold">{b.runs}</td><td className="px-2">{b.highest}</td><td className="px-2">{avg(b.runs, b.outs)}</td><td className="px-2">{sr(b.runs, b.balls)}</td><td className="px-2">{b.hundreds}</td><td className="px-2">{b.fifties}</td><td className="px-2">{b.fours}</td><td className="px-2">{b.sixes}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="bowl" className={card}>
        <h2 id="bowl" className="wide mb-3 text-lg font-bold">Bowling career</h2>
        {d.bowling.length === 0 ? <p className="text-sm text-muted">No bowling yet.</p> : (
          <table className="w-full text-sm"><thead className="text-xs text-muted"><tr><th className="text-left font-normal">Format</th><th className={th}>Inns</th><th className={th}>Overs</th><th className={th}>Mdns</th><th className={th}>Runs</th><th className={th}>Wkts</th><th className={th}>Avg</th><th className={th}>Econ</th></tr></thead>
            <tbody>{d.bowling.map((b) => <tr key={b.format} className="border-t border-line text-right"><td className="py-1.5 text-left font-medium">{fmt(b.format)}</td><td className="px-2">{b.innings}</td><td className="px-2">{overs(b.balls)}</td><td className="px-2">{b.maidens}</td><td className="px-2">{b.runs}</td><td className="px-2 font-semibold">{b.wickets}</td><td className="px-2">{avg(b.runs, b.wickets)}</td><td className="px-2">{b.balls ? ((b.runs / b.balls) * 6).toFixed(2) : "-"}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      {d.timeline.length > 0 && (
        <section aria-labelledby="timeline" className={card}>
          <h2 id="timeline" className="wide mb-3 text-lg font-bold">Career timeline</h2>
          <table className="w-full text-sm"><thead className="text-xs text-muted"><tr><th className="text-left font-normal">Format</th><th className={th}>Matches</th><th className="px-2 text-left font-normal">First match</th><th className="px-2 text-left font-normal">Latest match</th></tr></thead>
            <tbody>{d.timeline.map((t) => (
              <tr key={t.format} className="border-t border-line align-top">
                <td className="py-1.5 font-medium">{fmt(t.format)}</td><td className="px-2 text-right">{t.matches}</td>
                <td className="px-2"><Link href={`/match/${t.debut.slug}/scorecard`} className="hover:underline">v {t.debut.opponent}</Link><span className="block text-xs text-muted">{day(t.debut.date)}{t.debut.venue ? `, ${venueLabel(t.debut.venue, null)}` : ""}</span></td>
                <td className="px-2"><Link href={`/match/${t.last.slug}/scorecard`} className="hover:underline">v {t.last.opponent}</Link><span className="block text-xs text-muted">{day(t.last.date)}{t.last.venue ? `, ${venueLabel(t.last.venue, null)}` : ""}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {(d.form.batting.length > 0 || d.form.bowling.length > 0) && (
        <div className="grid gap-5 md:grid-cols-2">
          {d.form.batting.length > 0 && (
            <section aria-labelledby="fbat" className={card}>
              <h2 id="fbat" className="wide mb-3 text-lg font-bold">Recent batting</h2>
              <ul className="divide-y divide-line text-sm">{d.form.batting.map((f, k) => (
                <li key={k} className="flex gap-3 py-1.5"><Link href={`/match/${f.slug}/scorecard`} className="w-20 font-semibold hover:underline">{f.runs}{f.out ? "" : "*"} <span className="font-normal text-muted">({f.balls})</span></Link><span>v {f.opponent}</span><span className="ml-auto text-xs text-muted">{fmt(f.format)} · {day(f.date)}</span></li>
              ))}</ul>
            </section>
          )}
          {d.form.bowling.length > 0 && (
            <section aria-labelledby="fbowl" className={card}>
              <h2 id="fbowl" className="wide mb-3 text-lg font-bold">Recent bowling</h2>
              <ul className="divide-y divide-line text-sm">{d.form.bowling.map((f, k) => (
                <li key={k} className="flex gap-3 py-1.5"><Link href={`/match/${f.slug}/scorecard`} className="w-20 font-semibold hover:underline">{f.wickets}/{f.runs} <span className="font-normal text-muted">({overs(f.balls)})</span></Link><span>v {f.opponent}</span><span className="ml-auto text-xs text-muted">{fmt(f.format)} · {day(f.date)}</span></li>
              ))}</ul>
            </section>
          )}
        </div>
      )}

        </div>
      </div>

      <section aria-labelledby="recent"><SectionTitle id="recent">Recent matches</SectionTitle><MatchList matches={d.recentMatches} empty="No matches yet." /></section>

      <p className="text-xs text-muted">
        Stats are calculated from the ball-by-ball records in our database (see <Link href="/data" className="underline">data sources &amp; coverage</Link>);
        matches before ball-by-ball coverage began are not included.
        {p.sources.wikidata && <> Personal details from <a href={p.sources.wikidata} className="underline" rel="noopener noreferrer nofollow" target="_blank">Wikidata</a>.</>}
      </p>
    </div>
  );
}

"use client";

import { LIVE_STATUSES, formatLabel, venueLabel, type LiveSnapshot } from "@cricket/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ShotBurst, shotOf, type ShotKind } from "@/components/ShotBurst";
import { Seam } from "@/components/Seam";
import { TeamBadge } from "@/components/TeamBadge";
import { LocalTime } from "@/components/LocalTime";
import { useLivePoll } from "@/lib/useLivePoll";
import { Commentary } from "./Commentary";
import { score, summaryLine, teamName } from "./format";
import { BattingTable, BowlingTable, InningsFooter, PlayerLink } from "./Tables";

export type MatchTab = "live" | "watch" | "scorecard" | "commentary" | "squads";
const TABS: { id: MatchTab; label: string; path: string }[] = [
  { id: "live", label: "Live", path: "" },
  { id: "watch", label: "Watch", path: "/watch" },
  { id: "scorecard", label: "Scorecard", path: "/scorecard" },
  { id: "commentary", label: "Commentary", path: "/commentary" },
  { id: "squads", label: "Squads", path: "/squads" },
];

const card = "rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[0_8px_24px_-18px_rgba(21,24,32,0.35)]";

/** A delivery as a ball: wickets dark, boundaries leather, extras pink-ringed, everything else the white ball. */
function BallChip({ label }: { label: string }) {
  const wicket = label.includes("W") && !label.includes("Wd");
  const boundary = label === "4" || label === "6";
  const extra = /Wd|Nb|lb|b/.test(label);
  const tone = wicket ? "bg-ink text-white border-ink" : boundary ? "bg-leather-600 text-thread border-leather-700" : extra ? "bg-white text-pinkball-ink border-pinkball" : "bg-white text-ink border-white/40";
  return <span className={`inline-flex size-9 items-center justify-center rounded-full border-2 text-xs font-extrabold shadow-[0_4px_10px_-6px_rgba(0,0,0,0.6)] ${tone}`}>{label}</span>;
}

/** Plays the shot for each new delivery while you watch (never for balls already bowled when the page opened). */
function Celebration({ s }: { s: LiveSnapshot }) {
  const last = s.recentBalls[0];
  const seen = useRef(last?.id);
  const [moment, setMoment] = useState<{ key: string; kind: ShotKind; label: string } | null>(null);
  useEffect(() => {
    if (!last || last.id === seen.current) return;
    seen.current = last.id;
    const kind = shotOf(last);
    const label = kind === "W" ? "WICKET!" : kind === "4" ? "FOUR!" : kind === "6" ? "SIX!" : kind === "extra" ? last.label : kind === "dot" ? "Dot ball" : `${last.runs} run${last.runs === 1 ? "" : "s"}`;
    setMoment({ key: last.id, kind, label });
    const t = setTimeout(() => setMoment(null), kind === "4" || kind === "6" || kind === "W" ? 3200 : 2200);
    return () => clearTimeout(t);
  }, [last]);
  if (!moment) return null;
  return (
    <div key={moment.key} className="pop-in pointer-events-none fixed bottom-6 left-1/2 z-30 h-28 w-60 -translate-x-1/2 rounded-3xl bg-white/95 p-2.5 shadow-[0_24px_50px_-20px_rgba(61,7,16,0.6)] ring-1 ring-line sm:left-auto sm:right-6 sm:translate-x-0">
      <ShotBurst kind={moment.kind} label={moment.label} className="h-full w-full" />
    </div>
  );
}

function Side({ s, teamId }: { s: LiveSnapshot; teamId: string }) {
  const t = s.teams.find((x) => x.id === teamId)!;
  const inns = s.innings.filter((i) => i.battingTeamId === teamId);
  const cur = s.innings.at(-1);
  const batting = cur?.battingTeamId === teamId && !cur.isComplete;
  return (
    <div className="flex min-w-0 items-center gap-4">
      <TeamBadge name={t.name} shortName={t.shortName} size={60} className="max-sm:!size-12" />
      <div className="min-w-0">
        <p className={`truncate font-semibold sm:text-lg ${batting ? "text-white" : "text-white/70"}`}>{t.name}{batting && <span className="sr-only"> (batting)</span>}</p>
        <p className="score condensed text-4xl font-black leading-none sm:text-5xl">
          {inns.length ? inns.map((i) => (i.wickets >= 10 ? String(i.runs) : score(i)) + (i.isDeclared ? "d" : "")).join(" & ") : <span className="text-white/35">–</span>}
        </p>
        {batting && cur && <p className="mt-1 text-sm text-white/65">{cur.overs} ov{cur.runRate != null && ` · RR ${cur.runRate}`}</p>}
      </div>
    </div>
  );
}

function Header({ s, stale }: { s: LiveSnapshot; stale: boolean }) {
  const cur = s.innings.at(-1);
  const live = LIVE_STATUSES.includes(s.match.status);
  const [a, b] = s.teams;
  return (
    <header className="floodlit relative isolate overflow-hidden rounded-[28px] p-5 sm:p-8">
      <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
        {live && <span className="inline-flex items-center gap-1.5 rounded-full bg-pinkball/20 px-2 py-0.5 font-semibold uppercase tracking-wide text-white"><span className="live-dot" aria-hidden />{s.match.status === "LIVE" ? "Live" : s.match.status.replace("_", " ").toLowerCase()}</span>}
        <span className="font-semibold text-white">{formatLabel(s.match.format)}</span>
        {s.venue && <span>· {venueLabel(s.venue.name, s.venue.city)}</span>}
        {stale && <span role="status" className="ml-auto text-thread">Reconnecting…</span>}
      </div>
      <h1 className="wide mt-3 text-lg font-bold text-white/90 sm:text-xl">{s.match.title}</h1>
      <div className="mt-6 grid gap-5 sm:grid-cols-2" aria-live="polite">
        {a && <Side s={s} teamId={a.id} />}
        {b && <Side s={s} teamId={b.id} />}
      </div>
      {s.innings.length === 0 && <p className="mt-4 text-white/75">Starts <LocalTime iso={s.match.startsAt} /></p>}
      {cur && live && (
        <div className="mt-6">
          <Seam bowled={cur.legalBalls} total={s.match.oversPerInnings ? s.match.oversPerInnings * s.match.ballsPerOver : Math.max(6, cur.legalBalls)}
            perStitch={!s.match.oversPerInnings && cur.legalBalls / 6 >= 60 ? 5 : 1} open={!s.match.oversPerInnings} paused={s.match.status !== "LIVE"}
            label={`${cur.overs}${s.match.oversPerInnings ? ` of ${s.match.oversPerInnings}` : ""} overs bowled in innings ${cur.number}`} />
        </div>
      )}
      {cur?.chase && !cur.isComplete && (
        <p className="wide mt-5 text-lg font-bold text-thread sm:text-xl">
          Need {cur.chase.runsNeeded} runs{cur.chase.ballsLeft != null && ` from ${cur.chase.ballsLeft} balls`}{cur.chase.requiredRate != null && ` · RRR ${cur.chase.requiredRate}`}
        </p>
      )}
      {s.match.resultText && <p className="wide mt-5 text-lg font-bold text-thread sm:text-xl">{s.match.resultText}</p>}
      {live && cur && cur.thisOver.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2"><span className="mr-1 text-xs font-semibold uppercase tracking-wide text-white/60">This over</span>{cur.thisOver.map((l, k) => <BallChip key={k} label={l} />)}</div>
      )}
      <Celebration s={s} />
    </header>
  );
}

function Tabs({ s, tab }: { s: LiveSnapshot; tab: MatchTab }) {
  return (
    <nav aria-label="Match sections" className="flex gap-1.5 overflow-x-auto rounded-full border border-line bg-surface p-1.5 [scrollbar-width:none]">
      {TABS.map((t) => (
        <Link key={t.id} href={`/match/${s.match.slug}${t.path}`} aria-current={t.id === tab ? "page" : undefined} scroll={false}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${t.id === tab ? "bg-leather-700 text-white shadow-sm" : "text-muted hover:bg-canvas hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function LiveTab({ s }: { s: LiveSnapshot }) {
  const cur = s.innings.at(-1);
  // Scorecard-only feed: no deliveries, so no partnership/recent balls to show.
  const scorecardOnly = s.match.source === "feed" && s.recentBalls.length === 0;
  if (!cur) return <p className={`${card} text-muted`}>The match hasn&apos;t started yet.</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      <section className={`${card} space-y-5`}>
        <BattingTable s={s} i={cur} />
        {!scorecardOnly && <p className="text-xs text-muted">Partnership <span className="font-semibold text-ink">{cur.partnership.runs}</span> ({cur.partnership.balls} balls)</p>}
        <BowlingTable s={s} i={cur} />
      </section>
      <section aria-labelledby="recent" className={card}>
        <h2 id="recent" className="mb-2 font-semibold">Recent balls</h2>
        {scorecardOnly
          ? <p className="text-sm text-muted">Ball-by-ball commentary isn&apos;t available for this match. Scores and the scorecard update automatically every few minutes.</p>
          : <><Commentary s={s} compact /><Link href={`/match/${s.match.slug}/commentary`} className="mt-3 inline-block text-sm text-brand-700 underline">Full commentary</Link></>}
      </section>
    </div>
  );
}

function ScorecardTab({ s }: { s: LiveSnapshot }) {
  if (s.innings.length === 0) return <p className={`${card} text-muted`}>No scorecard yet.</p>;
  return (
    <div className="space-y-5">
      {[...s.innings].reverse().map((i) => {
        const batted = new Set(i.batters.map((b) => b.playerId));
        const dnb = s.players.filter((p) => p.teamId === i.battingTeamId && p.isPlayingXi && !batted.has(p.playerId));
        return (
          <section key={i.id} aria-labelledby={`inn-${i.number}`} className={`${card} space-y-4`}>
            <h2 id={`inn-${i.number}`} className="font-semibold">{teamName(s, i.battingTeamId)}, innings {i.number}: {score(i)} ({i.overs} ov)</h2>
            <BattingTable s={s} i={i} full />
            {dnb.length > 0 && <p className="text-xs text-muted"><span className="font-semibold text-ink">{i.isComplete ? "Did not bat" : "Yet to bat"}: </span>{dnb.map((p) => p.knownAs ?? p.name).join(", ")}</p>}
            <InningsFooter s={s} i={i} />
            <BowlingTable s={s} i={i} />
          </section>
        );
      })}
    </div>
  );
}

function SquadsTab({ s }: { s: LiveSnapshot }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {s.teams.map((t) => {
        const squad = s.players.filter((p) => p.teamId === t.id);
        const xi = squad.filter((p) => p.isPlayingXi), bench = squad.filter((p) => !p.isPlayingXi);
        return (
          <section key={t.id} className={card} aria-labelledby={`sq-${t.id}`}>
            <h2 id={`sq-${t.id}`} className="mb-4 flex items-center gap-3 font-bold"><TeamBadge name={t.name} shortName={t.shortName} size={36} />{t.name}</h2>
            {squad.length === 0 ? <p className="text-sm text-muted">Squad not announced.</p> : (
              <>
                <ol className="space-y-1 text-sm">
                  {xi.map((p) => <li key={p.playerId}><PlayerLink s={s} id={p.playerId} />{p.isCaptain && " (c)"}{p.isKeeper && " (wk)"}</li>)}
                </ol>
                {bench.length > 0 && <p className="mt-3 text-xs text-muted">Bench: {bench.map((p) => p.knownAs ?? p.name).join(", ")}</p>}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function MatchView({ initial, tab }: { initial: LiveSnapshot; tab: MatchTab }) {
  const { snap: s, stale } = useLivePoll(initial, LIVE_STATUSES.includes(initial.match.status));
  // Live score in the browser tab title (both big sites do this).
  useEffect(() => { document.title = `${summaryLine(s)} | CricketLive`; }, [s]);
  return (
    <div className="space-y-5">
      <Header s={s} stale={stale} />
      <Tabs s={s} tab={tab} />
      {tab === "live" && <LiveTab s={s} />}
      {tab === "scorecard" && <ScorecardTab s={s} />}
      {tab === "commentary" && <section className={card} aria-label="Ball by ball commentary"><Commentary s={s} /></section>}
      {tab === "squads" && <SquadsTab s={s} />}
    </div>
  );
}

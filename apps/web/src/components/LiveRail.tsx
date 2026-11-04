"use client";

import { formatLabel } from "@cricket/shared";
import { POLL_MS } from "@cricket/shared";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MatchSummary } from "@/lib/api";
import { LIVE_STATUSES, STATUS_LABEL, ballOf, chaseLine, seamProgress, teamLine } from "@/lib/score";
import { Ball } from "./Ball";
import { MatchCard, StatusChip } from "./MatchCard";
import { Seam } from "./Seam";
import { ShotBurst, type ShotKind } from "./ShotBurst";
import { TeamBadge } from "./TeamBadge";

/** In play first, then internationals, then everything paused (stumps, delays). */
const ORDER: Record<string, number> = { LIVE: 0, INNINGS_BREAK: 1, TOSS: 2, DELAYED: 3, STUMPS: 4 };
const INTL = new Set(["TEST", "ODI", "T20I"]);
const rank = (m: MatchSummary) => (ORDER[m.status] ?? 5) * 2 + (INTL.has(m.format) ? 0 : 1);
const sorted = (list: MatchSummary[]) => [...list].sort((a, b) => rank(a) - rank(b));
const totals = (m: MatchSummary) => { const i = (m.innings ?? []).at(-1); return { runs: i?.runs ?? 0, wkts: i?.wickets ?? 0, n: i?.number ?? 0 }; };
const fingerprint = (m: MatchSummary) => (m.innings ?? []).map((i) => `${i.runs}/${i.wickets}`).join("|") + m.status;

type Moment = { id: string; kind: ShotKind; label: string; key: number };

/** What changed since the last refresh, as a shot. Labelled with the exact runs added, never a guessed boundary. */
function momentOf(prev: MatchSummary, next: MatchSummary): Moment | null {
  const a = totals(prev), b = totals(next);
  if (a.n !== b.n) return null;
  if (b.wkts > a.wkts) return { id: next.id, kind: "W", label: b.wkts - a.wkts > 1 ? `${b.wkts - a.wkts} wickets!` : "Wicket!", key: Date.now() };
  const d = b.runs - a.runs;
  if (d <= 0) return null;
  const kind: ShotKind = d >= 6 ? "6" : d >= 4 ? "4" : (String(Math.min(d, 3)) as ShotKind);
  return { id: next.id, kind, label: `+${d} run${d === 1 ? "" : "s"}`, key: Date.now() };
}

const subscribe = () => () => {};
function Countdown({ iso }: { iso: string }) {
  const client = useSyncExternalStore(subscribe, () => true, () => false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!client) return <span className="score">soon</span>;
  const s = Math.max(0, Math.floor((Date.parse(iso) - now) / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return <span className="score">{s >= 86400 ? `${Math.floor(s / 86400)}d ` : ""}{p(Math.floor((s % 86400) / 3600))}:{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}</span>;
}

function HeroSide({ m, team, align }: { m: MatchSummary; team: MatchSummary["team1"]; align: "left" | "right" }) {
  const line = teamLine(m, team.id);
  return (
    <div className={`flex min-w-0 items-center gap-4 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <TeamBadge name={team.name} shortName={team.shortName} size={64} className="max-sm:!size-12" />
      <div className="min-w-0">
        <p className={`truncate text-base font-semibold sm:text-lg ${line?.batting ? "text-white" : "text-white/70"}`}>{team.name}{line?.batting && <span className="sr-only"> (batting)</span>}</p>
        <p className="score condensed text-4xl font-black leading-none text-white sm:text-6xl">{line?.text ?? <span className="text-white/35">–</span>}</p>
        {line?.overs && <p className="mt-1 text-sm text-white/60">{line.overs} overs</p>}
      </div>
    </div>
  );
}

/** The floodlit spotlight: the top live match (or the next one, with a countdown) as a giant night-time scoreboard. */
function Spotlight({ m, moment }: { m: MatchSummary; moment: Moment | null }) {
  const live = LIVE_STATUSES.has(m.status);
  const chase = live ? chaseLine(m) : null;
  const seam = live ? seamProgress(m) : null;
  return (
    <article className="floodlit relative isolate overflow-hidden rounded-[28px] p-5 shadow-[0_30px_60px_-30px_rgba(61,7,16,0.7)] sm:p-9">
      <div aria-hidden className="lights-on pointer-events-none absolute inset-x-0 top-0 flex justify-between px-6 opacity-90">
        {[0, 1].map((k) => (
          <svg key={k} width="74" height="34" viewBox="0 0 74 34" className={k ? "-scale-x-100" : ""}>
            <rect x="2" y="2" width="44" height="14" rx="3" fill="#2a2d36" />
            {[0, 1, 2, 3, 4].map((c) => <circle key={c} cx={8 + c * 8} cy="9" r="2.6" fill="#fff6dc" />)}
            <rect x="22" y="16" width="3" height="18" fill="#2a2d36" />
          </svg>
        ))}
      </div>
      <div className="relative flex flex-wrap items-center gap-2 text-xs text-white/70">
        <Ball kind={ballOf(m.format)} size={16} />
        <span className="font-semibold text-white">{formatLabel(m.format)}</span>
        {m.series?.name && <span className="truncate">{m.series.name}</span>}
        <span className="ml-auto">{live ? <StatusChip status={m.status} /> : <span className="rounded-full bg-white/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-white">Next up</span>}</span>
      </div>
      <h2 className="sr-only">{m.team1.name} vs {m.team2.name}</h2>
      <div className="relative mt-6 grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <HeroSide m={m} team={m.team1} align="left" />
        <span aria-hidden className="wide hidden text-sm font-bold uppercase tracking-[0.3em] text-thread/70 sm:block">vs</span>
        <HeroSide m={m} team={m.team2} align="right" />
      </div>
      {seam && <div className="relative mt-6"><Seam bowled={seam.bowled} total={seam.total} perStitch={seam.perStitch} label={seam.label} paused={m.status !== "LIVE"} open={seam.open} /></div>}
      <div className="relative mt-6 flex flex-wrap items-center gap-4">
        <p className="wide text-lg font-bold text-thread sm:text-2xl">
          {chase ?? m.resultText ?? (live ? STATUS_LABEL[m.status] ?? "In progress" : <>Starts in <Countdown iso={m.startsAt} /></>)}
        </p>
        <Link href={`/match/${m.slug}`} className="group ml-auto inline-flex items-center gap-2 rounded-full bg-leather-600 px-5 py-2.5 text-sm font-bold text-white shadow-[0_10px_24px_-10px_rgba(179,23,43,0.9)] transition-transform duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5">
          {live ? "Follow it live" : "Match centre"}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="transition-transform group-hover:translate-x-0.5"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Link>
      </div>
      {moment && moment.id === m.id && (
        <div key={moment.key} className="pop-in absolute bottom-20 right-4 h-24 w-48 rounded-2xl bg-white/95 p-2 text-ink shadow-xl sm:right-8">
          <ShotBurst kind={moment.kind} label={moment.label} className="h-full w-full" />
        </div>
      )}
    </article>
  );
}

/**
 * Home's live area: the floodlit spotlight plus a snap rail of every other live match. Refreshes from the same
 * CDN-cached list every visitor shares, pauses in background tabs, and plays a shot when a score moves.
 */
export function LiveRail({ initial, next }: { initial: MatchSummary[]; next: MatchSummary | null }) {
  const [list, setList] = useState(() => sorted(initial));
  const [bumped, setBumped] = useState<Set<string>>(new Set());
  const [moment, setMoment] = useState<Moment | null>(null);
  const [announce, setAnnounce] = useState("");
  const prev = useRef(new Map(initial.map((m) => [m.id, m])));
  const rail = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0, cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch("/api/v1/matches?status=live");
          if (!r.ok) throw new Error(String(r.status));
          const fresh = sorted(((await r.json()) as { matches: MatchSummary[] }).matches);
          const changed = new Set(fresh.filter((m) => prev.current.has(m.id) && fingerprint(prev.current.get(m.id)!) !== fingerprint(m)).map((m) => m.id));
          const top = fresh[0];
          const was = top && prev.current.get(top.id);
          const mo = top && was ? momentOf(was, top) : null;
          if (mo) { setMoment(mo); setAnnounce(`${top!.team1.name} v ${top!.team2.name}: ${mo.label}`); }
          prev.current = new Map(fresh.map((m) => [m.id, m]));
          setList(fresh);
          setBumped(changed);
          failures = 0;
        } catch { failures++; }
      }
      const base = failures ? Math.min(POLL_MS.liveList * 2 ** failures, 120_000) : POLL_MS.liveList;
      timer = setTimeout(tick, base * (0.8 + Math.random() * 0.4));
    };
    timer = setTimeout(tick, POLL_MS.liveList);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const scroll = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.9, behavior: "smooth" });
  const [featured, ...rest] = list;
  const spotlight = featured ?? next;
  return (
    <div className="space-y-6">
      <p aria-live="polite" className="sr-only">{announce}</p>
      {spotlight ? <Spotlight m={spotlight} moment={moment} /> : (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-6 text-sm text-muted">No matches in play right now. Fixtures are below.</p>
      )}
      {rest.length > 0 && (
        <div className="relative">
          <ul ref={rail} className="rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-3 [scrollbar-width:none] lg:mx-0 lg:px-0">
            {rest.map((m, k) => (
              <li key={m.id} className="pop-in w-[85%] shrink-0 sm:w-[46%] lg:w-[calc((100%-2rem)/3)]" style={{ animationDelay: `${Math.min(k, 5) * 60}ms` }}>
                <MatchCard m={m} feature bump={bumped.has(m.id)} />
              </li>
            ))}
          </ul>
          {rest.length > 3 && (
            <div className="mt-2 hidden items-center justify-end gap-2 lg:flex">
              <span className="mr-auto text-xs text-muted">{rest.length} more live · scroll for more</span>
              {([-1, 1] as const).map((d) => (
                <button key={d} type="button" onClick={() => scroll(d)} aria-label={d < 0 ? "Previous matches" : "More matches"}
                  className="grid size-9 place-items-center rounded-full border border-line bg-surface transition-[transform,background-color] duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:bg-brand-50">
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className={d < 0 ? "rotate-180" : ""}><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

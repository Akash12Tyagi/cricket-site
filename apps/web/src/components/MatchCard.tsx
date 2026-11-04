import { formatLabel, venueLabel } from "@cricket/shared";
import Link from "next/link";
import type { MatchSummary } from "@/lib/api";
import { LIVE_STATUSES, STATUS_LABEL, ballOf, chaseLine, seamProgress, teamLine } from "@/lib/score";
import { Ball } from "./Ball";
import { LocalTime } from "./LocalTime";
import { Seam } from "./Seam";
import { TeamBadge } from "./TeamBadge";

/** Status chip: live ones breathe (pink ball), the rest are quiet text. */
export function StatusChip({ status }: { status: string }) {
  if (!LIVE_STATUSES.has(status)) return null;
  const live = status === "LIVE";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${live ? "bg-pinkball/12 text-pinkball-ink" : "bg-canvas text-muted"}`}>
      {live && <span className="live-dot" aria-hidden />}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function TeamRow({ m, team, winner, bump, big }: { m: MatchSummary; team: MatchSummary["team1"]; winner: boolean; bump?: boolean; big: boolean }) {
  const line = teamLine(m, team.id);
  return (
    <div className="flex items-center gap-3">
      <TeamBadge name={team.name} shortName={team.shortName} size={big ? 30 : 24} />
      <span className={`min-w-0 flex-1 ${big ? "break-words leading-tight" : "truncate"} ${line?.batting || winner ? "font-semibold text-ink" : "text-ink/75"}`}>
        {team.name}
        {line?.batting && <span className="sr-only"> (batting)</span>}
      </span>
      {line && (
        <span className="score shrink-0 text-right">
          <span className={`font-extrabold ${big ? "condensed text-[24px] leading-none sm:text-[30px]" : "text-lg"} ${line.batting ? "text-ink" : "text-ink/55"} ${bump && line.batting ? "bump" : ""}`}>{line.text}</span>
          {line.overs && <span className="ml-1.5 text-xs font-medium text-muted">{line.overs} ov</span>}
        </span>
      )}
    </div>
  );
}

const context = (m: MatchSummary) => m.series?.name ?? (m.venue ? venueLabel(m.venue.name, m.venue.city) : null);

/**
 * A match, read in one glance: which ball (format), the two sides with scores, and what's happening now.
 * `feature` is the live-rail card (ball-coded edge, scoreboard numerals, the seam); the default is the compact card.
 */
export function MatchCard({ m, feature = false, bump = false }: { m: MatchSummary; feature?: boolean; bump?: boolean }) {
  const live = LIVE_STATUSES.has(m.status);
  const chase = live ? chaseLine(m) : null;
  const seam = live && feature ? seamProgress(m) : null;
  const winnerId = m.resultText ? (m.resultText.startsWith(m.team1.name) ? m.team1.id : m.resultText.startsWith(m.team2.name) ? m.team2.id : null) : null;
  const ball = ballOf(m.format);
  return (
    <article className={`group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-14px_rgba(93,10,21,0.4)] ${live ? "border-leather-700/20" : "border-line"}`}>
      {feature && <div aria-hidden className={`h-2 shrink-0 ${ball === "red" ? "edge-red" : "edge-white"}`} />}
      <div className={`flex flex-1 flex-col ${feature ? "gap-3 p-5" : "gap-2 p-4"}`}>
        <header className="flex items-center gap-2 text-xs text-muted">
          <Ball kind={ball} size={16} />
          <span className="whitespace-nowrap font-semibold text-ink/80">{formatLabel(m.format)}</span>
          {context(m) && <span className="min-w-0 truncate">{context(m)}</span>}
          <span className="ml-auto shrink-0"><StatusChip status={m.status} /></span>
        </header>
        <h3 className="sr-only">{m.team1.name} vs {m.team2.name}</h3>
        <div className={feature ? "space-y-2 text-base" : "space-y-1 text-[15px]"}>
          <TeamRow m={m} team={m.team1} winner={winnerId === m.team1.id} bump={bump} big={feature} />
          <TeamRow m={m} team={m.team2} winner={winnerId === m.team2.id} bump={bump} big={feature} />
        </div>
        {seam && <div className="mt-auto pt-1"><Seam bowled={seam.bowled} total={seam.total} perStitch={seam.perStitch} label={seam.label} paused={m.status !== "LIVE"} open={seam.open} /></div>}
        {/* The chip already says Live/Stumps; this line only adds what it can't: the chase, the result, the start. */}
        {live && !(m.innings ?? []).length && <p className="mt-auto text-sm text-muted">No score from the ground yet. It will appear here as soon as one comes in.</p>}
        {(chase || m.resultText || !live) && (
          <p className={`text-sm ${chase ? "font-semibold text-leather-700" : m.resultText ? "text-ink/80" : "text-muted"}`}>
            {chase ?? m.resultText ?? <LocalTime iso={m.startsAt} />}
          </p>
        )}
      </div>
      <Link href={`/match/${m.slug}`} className="absolute inset-0 rounded-[var(--radius-card)]" aria-label={`${m.team1.name} vs ${m.team2.name}: open match`} />
    </article>
  );
}

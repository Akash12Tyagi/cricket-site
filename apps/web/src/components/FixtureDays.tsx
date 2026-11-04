"use client";

import { formatLabel } from "@cricket/shared";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { MatchSummary } from "@/lib/api";
import { ballOf } from "@/lib/score";
import { Ball } from "./Ball";
import { StitchMark } from "./Seam";
import { TeamBadge } from "./TeamBadge";

const subscribe = () => () => {};

/**
 * Fixtures grouped by day like a timetable. The server groups by UTC (identical, cacheable HTML); the browser
 * regroups by the visitor's own day and shows their local start times.
 */
export function FixtureDays({ matches, limit = 12 }: { matches: MatchSummary[]; limit?: number }) {
  const client = useSyncExternalStore(subscribe, () => true, () => false);
  const tz = client ? undefined : "UTC";
  const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
  const groups = new Map<string, MatchSummary[]>();
  for (const m of matches.slice(0, limit)) groups.set(dayKey(m.startsAt), [...(groups.get(dayKey(m.startsAt)) ?? []), m]);
  const today = dayKey(new Date().toISOString()), tomorrow = dayKey(new Date(Date.now() + 86_400_000).toISOString());
  const label = (k: string, iso: string) =>
    k === today ? "Today" : k === tomorrow ? "Tomorrow" : new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: tz });

  if (!matches.length) return <p className="text-sm text-muted">No fixtures scheduled yet.</p>;
  return (
    <div className="space-y-6">
      {[...groups].map(([k, list]) => (
        <section key={k} aria-label={label(k, list[0]!.startsAt)}>
          <h3 className="wide mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-leather-700">{label(k, list[0]!.startsAt)}</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {list.map((m) => (
              <li key={m.id} className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-brand-50/60 sm:gap-4">
                <StitchMark state="upcoming" />
                <time dateTime={m.startsAt} className="score w-12 shrink-0 text-sm font-semibold text-ink">
                  {new Date(m.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz })}
                </time>
                <span aria-hidden className="flex shrink-0 flex-col gap-1 sm:flex-row sm:gap-1.5">
                  <TeamBadge name={m.team1.name} shortName={m.team1.shortName} size={30} className="max-sm:!size-[26px]" />
                  <TeamBadge name={m.team2.name} shortName={m.team2.shortName} size={30} className="max-sm:!size-[26px]" />
                </span>
                <span className="min-w-0 flex-1">
                  {/* Phones stack the two sides so neither name is ever cut off. */}
                  <Link href={`/match/${m.slug}`} className="block font-medium leading-snug after:absolute after:inset-0 hover:text-leather-700">
                    <span className="block sm:inline">{m.team1.name}</span> <span className="hidden text-muted sm:inline">v</span> <span className="block sm:inline">{m.team2.name}</span>
                  </Link>
                  <span className="block truncate text-xs text-muted">{m.series?.name ?? ""}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted"><Ball kind={ballOf(m.format)} size={16} />{formatLabel(m.format)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!client && <p className="text-xs text-muted">Times shown in UTC.</p>}
    </div>
  );
}

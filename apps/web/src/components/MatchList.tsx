import type { MatchSummary } from "@/lib/api";
import { MatchCard } from "./MatchCard";

/** Matches grouped by (UTC) day, newest or oldest first as given, in the site's timetable style. */
export function MatchList({ matches, empty = "No matches." }: { matches: MatchSummary[]; empty?: string }) {
  if (matches.length === 0) return <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-5 text-sm text-muted">{empty}</p>;
  const groups = new Map<string, MatchSummary[]>();
  for (const m of matches) {
    const day = m.startsAt.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), m]);
  }
  return (
    <div className="space-y-7">
      {[...groups].map(([day, list]) => (
        <section key={day} aria-label={day}>
          <h3 className="wide mb-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-leather-700">
            {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((m) => <MatchCard key={m.id} m={m} />)}</div>
        </section>
      ))}
    </div>
  );
}

import { formatLabel } from "@cricket/shared";
import Link from "next/link";
import type { MatchSummary } from "@/lib/api";
import { ballOf, teamLine } from "@/lib/score";
import { Ball } from "./Ball";
import { StitchMark } from "./Seam";
import { TeamBadge } from "./TeamBadge";

/** Recent results as one divided list (the fixtures' grammar, with the struck "finished" stitch). */
export function ResultRows({ matches }: { matches: MatchSummary[] }) {
  if (!matches.length) return <p className="text-sm text-muted">No results yet.</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {matches.map((m) => (
        <li key={m.id} className="relative px-4 py-3 transition-colors hover:bg-brand-50/60">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
            <StitchMark state="finished" />
            <Ball kind={ballOf(m.format)} size={14} />
            <span className="font-semibold text-ink/75">{formatLabel(m.format)}</span>
            <span className="min-w-0 truncate">{m.series?.name ?? ""}</span>
          </div>
          {[m.team1, m.team2].map((t) => {
            const line = teamLine(m, t.id);
            return (
              <div key={t.id} className="flex items-center gap-2.5 py-0.5 text-[15px]">
                <TeamBadge name={t.name} shortName={t.shortName} size={22} />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {line && <span className="score shrink-0 font-bold text-ink/80">{line.text}</span>}
              </div>
            );
          })}
          <Link href={`/match/${m.slug}`} className="mt-1 block text-sm font-medium text-leather-700 after:absolute after:inset-0">{m.resultText ?? "Result"}</Link>
        </li>
      ))}
    </ul>
  );
}

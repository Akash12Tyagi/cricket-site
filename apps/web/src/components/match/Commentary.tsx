"use client";

import type { BallEntry, BallPage, LiveSnapshot } from "@cricket/shared";
import { useState } from "react";
import { playerName } from "./format";

const outcome = (b: BallEntry) => {
  if (b.isWicket) return "OUT";
  if (b.isBoundary) return b.runs >= 6 ? "SIX" : "FOUR";
  if (/Wd/.test(b.label)) return "wide";
  if (/Nb/.test(b.label)) return "no-ball";
  return b.runs === 0 ? "no run" : b.runs === 1 ? "1 run" : `${b.runs} runs`;
};

function Row({ s, b }: { s: LiveSnapshot; b: BallEntry }) {
  const extra = /Wd|Nb|lb|b/.test(b.label);
  const tone = b.isWicket ? "bg-ink text-white border-ink" : b.isBoundary ? "bg-leather-600 text-thread border-leather-700" : extra ? "bg-white text-pinkball-ink border-pinkball" : "bg-white text-ink border-line";
  const moment = b.isWicket || b.isBoundary;
  return (
    <li className={`flex gap-3 border-b border-line py-2.5 ${moment ? "-mx-2 rounded-xl px-2 " + (b.isWicket ? "bg-ink/[0.04]" : "bg-brand-50") : ""}`}>
      <div className="w-12 shrink-0 text-center">
        <span className="block text-xs text-muted">{b.over}</span>
        <span className={`mt-0.5 inline-flex size-8 items-center justify-center rounded-full border-2 px-1 text-xs font-extrabold ${tone}`}>{b.label}</span>
      </div>
      <p className="text-sm">
        <span className="font-medium">{playerName(s, b.bowlerId)} to {playerName(s, b.strikerId)}</span>, <span className={b.isWicket ? "wide font-extrabold text-ink" : b.isBoundary ? "wide font-extrabold text-leather-700" : ""}>{outcome(b)}</span>
        {b.text && <>. {b.text}</>}
      </p>
    </li>
  );
}

/** Live list (from the polled snapshot) plus "load older" pages that never change, so they cache forever. */
export function Commentary({ s, compact = false }: { s: LiveSnapshot; compact?: boolean }) {
  const [older, setOlder] = useState<BallEntry[]>([]);
  const [cursor, setCursor] = useState<BallPage["nextBefore"] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = compact ? s.recentBalls.slice(0, 8) : s.recentBalls;
  const last = latest.at(-1);
  const next = cursor === undefined ? (latest.length >= 30 && last ? { inningsNumber: last.inningsNumber, seq: last.seq } : null) : cursor;

  const loadMore = async () => {
    if (!next) return;
    setBusy(true); setFailed(false);
    try {
      const res = await fetch(`/api/v1/matches/${s.match.id}/balls?limit=30&beforeInnings=${next.inningsNumber}&beforeSeq=${next.seq}`);
      if (!res.ok) throw new Error();
      const page = (await res.json()) as BallPage;
      setOlder((o) => [...o, ...page.balls]);
      setCursor(page.nextBefore);
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  if (latest.length === 0) return <p className="text-sm text-muted">No balls bowled yet.</p>;
  return (
    <div>
      <ol>{[...latest, ...older].map((b) => <Row key={b.id} s={s} b={b} />)}</ol>
      {!compact && next && (
        <button onClick={loadMore} disabled={busy} className="mt-3 w-full rounded-full border border-line py-2.5 text-sm font-semibold hover:bg-canvas disabled:opacity-50">
          {busy ? "Loading…" : failed ? "Couldn't load. Tap to retry" : "Load older balls"}
        </button>
      )}
    </div>
  );
}

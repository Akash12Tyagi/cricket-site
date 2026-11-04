/**
 * The signature: an innings drawn as a ball's seam. One stitch per over (or per `perStitch` overs in long innings),
 * at exact length. Stitch form carries state, never colour alone: solid = bowled, dashed = to come, and a paused match
 * (stumps, delay) is struck through. On first paint the bowled stitches sew in, left to right.
 */
export function Seam({ bowled, total, perStitch = 1, label, paused = false, open = false }: { bowled: number; total: number; perStitch?: number; label: string; paused?: boolean; open?: boolean }) {
  // An open seam (no quota) is drawn at a fixed stitch pitch and simply grows with the overs bowled.
  if (open) return <OpenSeam bowled={bowled} perStitch={perStitch} label={label} paused={paused} />;
  const stitches = Math.max(1, Math.round(total / 6 / perStitch));
  const done = Math.min(stitches, bowled / 6 / perStitch);
  const w = 100 / stitches;
  const ink = paused ? "#8a93a0" : "#b3172b";
  return (
    <div role="img" aria-label={paused ? `${label} (play paused)` : label} className="w-full">
      <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="h-3 w-full overflow-visible">
        <line x1="0" y1="6" x2="100" y2="6" stroke="#dde1e7" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="6" x2={done * w} y2="6" stroke={ink} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        {Array.from({ length: stitches }, (_, k) => {
          const x = k * w + w * 0.18, x2 = k * w + w * 0.82, full = k + 1 <= done, part = !full && k < done;
          return (
            <g key={k} className={full || part ? "stitch-in" : undefined} style={full || part ? { animationDelay: `${Math.min(k, 60) * 18}ms` } : undefined}
              stroke={full || part ? ink : "#b9c0ca"} strokeWidth="1.6" strokeLinecap="round" strokeDasharray={full ? undefined : part ? "1.2 1" : "1.4 2.2"}>
              <line x1={x} y1="4.2" x2={x2} y2="1.2" vectorEffect="non-scaling-stroke" />
              <line x1={x} y1="10.8" x2={x2} y2="7.8" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {paused && <line x1="0" y1="6" x2={done * w} y2="6" stroke="#59616e" strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

/** Multi-day innings: stitches for overs bowled only, 8px apart, capped at the card width; no target implied. */
function OpenSeam({ bowled, perStitch, label, paused }: { bowled: number; perStitch: number; label: string; paused: boolean }) {
  const stitches = Math.max(1, Math.ceil(bowled / 6 / perStitch));
  const ink = paused ? "#8a93a0" : "#b3172b";
  const width = stitches * 8;
  return (
    <div role="img" aria-label={paused ? `${label} (play paused)` : label} className="flex items-center gap-2">
      <svg width={width} height="12" viewBox={`0 0 ${width} 12`} className="max-w-full shrink" preserveAspectRatio="xMinYMid meet">
        <line x1="0" y1="6" x2={width} y2="6" stroke={ink} strokeWidth="1.4" strokeDasharray={paused ? "3 2" : undefined} />
        {Array.from({ length: stitches }, (_, k) => (
          <g key={k} className="stitch-in" style={{ animationDelay: `${Math.min(k, 60) * 18}ms` }} stroke={ink} strokeWidth="1.6" strokeLinecap="round">
            <line x1={k * 8 + 1.5} y1="4.2" x2={k * 8 + 6.5} y2="1.2" />
            <line x1={k * 8 + 1.5} y1="10.8" x2={k * 8 + 6.5} y2="7.8" />
          </g>
        ))}
      </svg>
      {paused && <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted">paused</span>}
    </div>
  );
}

/**
 * A three-stitch marker for list rows, state by form (never colour alone): upcoming = loose dashed stitches with no
 * seam line; finished = solid stitches on a closed seam line. Decorative; each row also says it in text.
 */
export function StitchMark({ state }: { state: "upcoming" | "finished" }) {
  const finished = state === "finished";
  const c = finished ? "#9b1426" : "#8a93a0";
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden className="shrink-0">
      {finished && <line x1="0" y1="6" x2="22" y2="6" stroke={c} strokeWidth="1.4" />}
      {[2, 9, 16].map((x) => (
        <g key={x} stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeDasharray={finished ? undefined : "1.2 1.6"}>
          <line x1={x} y1="4.2" x2={x + 3} y2="1.2" />
          <line x1={x} y1="10.8" x2={x + 3} y2="7.8" />
        </g>
      ))}
    </svg>
  );
}

export type ShotKind = "dot" | "1" | "2" | "3" | "4" | "6" | "W" | "extra";

const LABEL: Record<ShotKind, string> = { dot: "Dot ball", "1": "1 run", "2": "2 runs", "3": "3 runs", "4": "FOUR!", "6": "SIX!", W: "WICKET!", extra: "Extra" };

/** Maps a delivery to its shot. */
export function shotOf(b: { runs: number; isWicket: boolean; isBoundary: boolean; label: string }): ShotKind {
  if (b.isWicket) return "W";
  if (b.isBoundary) return b.runs >= 6 ? "6" : "4";
  if (/Wd|Nb|lb|b\d|^\d+b/.test(b.label)) return "extra";
  if (b.runs <= 0) return "dot";
  return (b.runs >= 3 ? "3" : String(b.runs)) as ShotKind;
}

/**
 * A tiny animated scene for one delivery: the bat swings and the ball goes where the runs went. Singles roll a little,
 * twos and threes roll further, a four races along the ground to the rope, a six sails out over the top, a wicket
 * sends the bails flying. Pure SVG + CSS (no script, CSP-safe); with reduced motion it shows the end state only.
 */
export function ShotBurst({ kind, className = "", label }: { kind: ShotKind; className?: string; label?: string }) {
  const big = kind === "4" || kind === "6" || kind === "W";
  const runs = kind === "1" ? 1 : kind === "2" ? 2 : kind === "3" ? 3 : 0;
  const extra = kind === "extra" ? (/Nb/i.test(label ?? "") ? "NO BALL" : /Wd/i.test(label ?? "") ? "WIDE" : /lb/i.test(label ?? "") ? "LEG BYE" : "BYE") : null;
  return (
    <div className={`shot shot-${kind} ${className}`} role="img" aria-label={label ?? LABEL[kind]}>
      <svg viewBox="0 0 220 110" className="h-full w-full overflow-visible">
        {/* ground and boundary rope */}
        <line x1="6" y1="96" x2="214" y2="96" stroke="currentColor" strokeOpacity=".18" strokeWidth="2" strokeLinecap="round" />
        <path d="M206 70 v26" stroke="#e8508a" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 4" />
        {/* stumps + bails */}
        <g className="stumps" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="26" y1="64" x2="26" y2="96" /><line x1="31" y1="64" x2="31" y2="96" /><line x1="36" y1="64" x2="36" y2="96" />
        </g>
        <g className="bails" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line className="bail-l" x1="25" y1="62" x2="31" y2="62" /><line className="bail-r" x1="31" y1="62" x2="37" y2="62" />
        </g>
        {/* bat, pivoting at the handle */}
        <g className="bat">
          <rect x="49" y="38" width="5" height="16" rx="2.5" fill="currentColor" />
          <rect x="45.5" y="53" width="12" height="36" rx="4" fill="#d9a066" stroke="#8a5a2b" strokeWidth="1.2" />
        </g>
        {/* the ball (with a seam) and its trail */}
        <path className="trail" d={kind === "6" ? "M62 82 C 120 0, 180 10, 214 40" : "M62 88 L 206 90"} fill="none" stroke="#b3172b" strokeWidth="2" strokeDasharray="3 5" strokeLinecap="round" />
        <g className="ball">
          <circle cx="62" cy="88" r="6.5" fill="#b3172b" />
          <path d="M58.6 84.5 q3.4 3.5 0 7 M65.4 84.5 q-3.4 3.5 0 7" fill="none" stroke="#f3e3c6" strokeWidth="1" />
        </g>
        {kind === "6" && <g className="stars" fill="#e8508a"><circle cx="190" cy="16" r="3" /><circle cx="204" cy="30" r="2" /><circle cx="176" cy="8" r="2" /></g>}
        {/* Runs completed: one arc per run between the wickets (the runner's path), drawn in order. */}
        {runs > 0 && Array.from({ length: runs }, (_, k) => (
          <path key={k} className="run-arc" style={{ animationDelay: `${700 + k * 260}ms` }} d={`M44 ${58 - k * 10} q ${44 + k * 8} -${16 + k * 4} ${88 + k * 16} 0`} fill="none" stroke="#9b1426" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="4 4" />
        ))}
        {kind === "dot" && <circle className="dot-mark" cx="150" cy="44" r="10" fill="#151820" />}

      </svg>
      <span className={`shot-label ${big || extra ? "shot-label-big" : ""} ${extra ? "shot-label-extra" : ""} ${kind === "6" ? "shot-label-left" : ""}`} aria-hidden>{extra ?? label ?? LABEL[kind]}</span>
    </div>
  );
}

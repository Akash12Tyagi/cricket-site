import type { Ball as BallKind } from "@/lib/score";

const FILL: Record<BallKind | "pink", { body: string; seam: string; shine: string }> = {
  red: { body: "#9b1426", seam: "#f3e3c6", shine: "#c8394c" },
  white: { body: "#eceff3", seam: "#b3172b", shine: "#ffffff" },
  pink: { body: "#e8508a", seam: "#fff1f6", shine: "#f48ab2" },
};

/** A cricket ball drawn with its seam. Decorative: the label beside it always names the format. */
export function Ball({ kind, size = 14, className = "" }: { kind: BallKind | "pink"; size?: number; className?: string }) {
  const c = FILL[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <circle cx="12" cy="12" r="11" fill={c.body} stroke={kind === "white" ? "#7d8592" : "none"} strokeWidth="1.6" />
      <ellipse cx="8" cy="7.5" rx="3.2" ry="2" fill={c.shine} opacity=".55" />
      <path d="M8.2 1.7c2.6 3.1 3.6 6.4 3.6 10.3s-1 7.2-3.6 10.3" fill="none" stroke={c.seam} strokeWidth="1.2" />
      <path d="M11.7 1.4c2.6 3.2 3.6 6.6 3.6 10.6s-1 7.4-3.6 10.6" fill="none" stroke={c.seam} strokeWidth="1.2" />
      <path d="M8.9 4.2l2 -.4M9.9 7.3l2.1-.2M10.3 10.5h2.2M10.3 13.7l2.2.1M9.9 16.8l2.1.3M8.9 19.9l2 .4" stroke={c.seam} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

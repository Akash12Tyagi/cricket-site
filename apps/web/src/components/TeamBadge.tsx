import { teamCode, teamColor } from "@/lib/team";

/**
 * A round monogram in the team's colour with a stitched ring and a light rim (so dark kits still separate from the
 * floodlit night). Age/gender sides carry a small marker (U19, W, A). Generated, never a copyrighted crest.
 */
export function TeamBadge({ name, shortName, size = 40, className = "" }: { name: string; shortName?: string | null; size?: number; className?: string }) {
  const color = teamColor(name);
  const { code, mark } = teamCode(name, shortName);
  return (
    <span aria-hidden className={`relative inline-grid shrink-0 place-items-center rounded-full font-extrabold text-white shadow-[0_6px_14px_-8px_rgba(0,0,0,0.55)] ring-2 ring-white/45 ${className}`}
      style={{ width: size, height: size, background: color, fontSize: size * (code.length > 2 ? 0.3 : 0.38), fontStretch: "85%", letterSpacing: "-0.02em" }}>
      <svg viewBox="0 0 40 40" className="pointer-events-none absolute inset-0 h-full w-full">
        <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1" strokeDasharray="1.6 2.2" />
      </svg>
      <span className="relative">{code}</span>
      {mark && size >= 26 && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-thread px-1 font-black leading-[1.3] text-leather-900 ring-1 ring-white/60" style={{ fontSize: Math.max(8, size * 0.2) }}>{mark}</span>
      )}
    </span>
  );
}

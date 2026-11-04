"use client";

import { useEffect, useRef, useState } from "react";
import { Ball } from "./Ball";
import { TeamBadge } from "./TeamBadge";

export type CardStat = { label: string; value: number };
export type CardFact = { label: string; value: string };
export type CardFormat = { label: string; ball: "red" | "white"; matches: number };

/** Counts up to the real number once, when it scrolls into view. The server HTML always holds the final value. */
function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || value < 10 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / 900);
        setShown(Math.round(value * (1 - Math.pow(1 - p, 4))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);
  return <span ref={ref}>{shown.toLocaleString("en-GB")}</span>;
}

/**
 * The player as a collectible cricket card, in the genre's own devices: a frame in the colour of their ball, a format
 * strip across the top (each format with its ball and match count), name and role, a career-span band, and the numbers
 * ruled like a scorebook. Tilts with the pointer; flips (button, keyboard-accessible) to the personal details.
 */
export function PlayerCard({ name, country, role, ball, formats, span, stats, facts, teams }: {
  name: string; country: string | null; role: string | null; ball: "red" | "white"; formats: CardFormat[];
  span: { from: string; to: string } | null; stats: CardStat[]; facts: CardFact[]; teams: string[];
}) {
  const [flipped, setFlipped] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const frame = ball === "red" ? "bg-leather-700" : "bg-[#e3e7ed]";
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -7, y: ((e.clientX - r.left) / r.width - 0.5) * 9 });
  };
  return (
    <div className="card3d mx-auto w-full max-w-[440px]" data-flipped={flipped} onPointerMove={onMove} onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transition: "transform 300ms var(--ease-out-expo)" }}>
      <div className="card3d-inner">
        {/* Front */}
        <section aria-label={`${name}: player card`} className={`card3d-face rounded-[30px] p-3 shadow-[0_30px_60px_-28px_rgba(61,7,16,0.65)] ${frame}`}>
          <div className="floodlit relative overflow-hidden rounded-[22px]">
            {/* Format strip: every format they've played, with its ball */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 bg-black/25 px-4 py-2.5">
              {formats.map((f) => (
                <span key={f.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-semibold text-white">
                  <Ball kind={f.ball} size={14} />{f.label}<span className="score text-white/60">{f.matches}</span>
                </span>
              ))}
            </div>
            <div className="px-6 pb-6 pt-6">
              <div className="flex items-start gap-4">
                <h1 className="wide min-w-0 flex-1 text-4xl font-black leading-[1.0] tracking-tight text-white sm:text-[44px]">{name}</h1>
                {country && <TeamBadge name={country} size={52} />}
              </div>
              {role && <p className="mt-3 text-sm font-semibold uppercase tracking-[0.1em] text-thread">{role}</p>}
              {span && (
                <div className="mt-5 flex items-center gap-3 text-sm text-white/75">
                  <span className="score font-bold text-white">{span.from}</span>
                  <span aria-hidden className="seam-stitch h-2.5 flex-1 opacity-70" />
                  <span className="score font-bold text-white">{span.to}</span>
                </div>
              )}
              {/* Scorebook: the numbers ruled, not tiled */}
              <dl className="mt-6 divide-y divide-white/10 border-y border-white/10">
                {stats.map((s) => (
                  <div key={s.label} className="flex items-baseline justify-between py-2.5">
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">{s.label}</dt>
                    <dd className="score condensed text-3xl font-black leading-none text-white"><CountUp value={s.value} /></dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
        {/* Back */}
        <section aria-label={`${name}: personal details`} aria-hidden={!flipped} className={`card3d-face card3d-back rounded-[30px] p-3 ${frame}`}>
          <div className="h-full overflow-auto rounded-[22px] bg-surface px-6 py-7">
            <h2 className="wide text-xl font-black">{name}</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {facts.map((f) => <div key={f.label}><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{f.label}</dt><dd className="font-medium">{f.value}</dd></div>)}
            </dl>
            {teams.length > 0 && <p className="mt-5 border-t border-line pt-4 text-xs text-muted"><span className="font-semibold text-ink">Played for </span>{teams.slice(0, 10).join(", ")}{teams.length > 10 ? "…" : ""}</p>}
          </div>
        </section>
      </div>
      <button type="button" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped}
        className="mx-auto mt-4 flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold transition-colors hover:bg-brand-50">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M2.5 6a5.5 5.5 0 0 1 10-2.5M13.5 10a5.5 5.5 0 0 1-10 2.5M12.5 1v2.5H10M3.5 15v-2.5H6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {flipped ? "Turn back to the stats" : "Flip the card"}
      </button>
    </div>
  );
}

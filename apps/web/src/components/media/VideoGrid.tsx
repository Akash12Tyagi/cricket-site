"use client";

import { useState } from "react";
import { LocalTime } from "@/components/LocalTime";
import type { Video } from "@/lib/api";

/** YouTube's own view count, shortened (1.2M). Shown only when YouTube's API provided it in the last 30 days. */
export const views = (n: number | null) => n == null ? null : `${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)} views`;
const clock = (s: number | null) => s == null || s === 0 ? null : `${s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Click-to-play YouTube player. Until the visitor presses play we show only the thumbnail (an image from
 * i.ytimg.com, which sets no cookies): no YouTube script or iframe loads, which keeps match pages fast and private. After the
 * click, the official video plays in YouTube's privacy-enhanced player, so views and rights stay with the owner.
 */
function Player({ v }: { v: Video }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video overflow-hidden rounded-[var(--radius-card)] bg-black shadow-[0_14px_30px_-18px_rgba(0,0,0,0.6)]">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${v.youtubeId}?autoplay=1&rel=0&modestbranding=1`}
          title={v.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 h-full w-full" aria-label={`Play: ${v.title}`}>
          <img src={`https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100" />
          <span aria-hidden className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-leather-700/90 text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] ring-4 ring-white/25 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:scale-110">
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
          </span>
          {v.isLive && <span className="absolute left-2 top-2 rounded bg-live px-1.5 py-0.5 text-xs font-semibold text-white">LIVE</span>}
          {!v.isLive && clock(v.durationSeconds) && <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">{clock(v.durationSeconds)}</span>}
        </button>
      )}
    </div>
  );
}

export function VideoCards({ videos }: { videos: Video[] }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((v) => (
        <li key={v.id} className="space-y-2">
          <Player v={v} />
          <p className="line-clamp-2 text-sm font-medium">{v.title}</p>
          <p className="text-xs text-muted">
            {v.channelName ?? "YouTube"}{views(v.viewCount) && <> · {views(v.viewCount)}</>} · <LocalTime iso={v.publishedAt} style="date" /> ·{" "}
            <a href={`https://www.youtube.com/watch?v=${v.youtubeId}`} target="_blank" rel="noopener noreferrer" className="underline">Watch on YouTube</a>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** YouTube attribution required by its API policies: source, terms, and that YouTube's player is used. */
export function YouTubeCredit() {
  return (
    <p className="text-xs text-muted">
      Official videos from the ICC and cricket boards, from <a href="https://www.youtube.com" target="_blank" rel="noopener noreferrer" className="underline">YouTube</a>,
      played in YouTube&apos;s player. By watching you agree to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="underline">YouTube Terms of Service</a>.
      View counts are YouTube&apos;s. YouTube may set cookies once you press play.
    </p>
  );
}

export function VideoGrid({ videos, title = "Videos", headingLevel = 2 }: { videos: Video[]; title?: string; headingLevel?: 1 | 2 }) {
  if (videos.length === 0) return null;
  const H = headingLevel === 1 ? "h1" : "h2";
  return (
    <section aria-labelledby="videos" className="space-y-3">
      <H id="videos" className={headingLevel === 1 ? "text-2xl font-semibold" : "text-lg font-semibold"}>{title}</H>
      <VideoCards videos={videos} />
      <YouTubeCredit />
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVisitorRegion } from "@/components/media/WatchOptions";
import type { PublicStream } from "@/lib/api";
import { nextServer, orderServers, STATUS_TEXT } from "@/lib/streams";

type Phase = "idle" | "loading" | "playing" | "error";
const START_TIMEOUT_MS = 15_000;
const STALL_TIMEOUT_MS = 25_000;

/**
 * HLS in our own <video>. hls.js is loaded only when someone presses play. Fatal errors get one in-place retry; a
 * stream that doesn't start within 15 s, or stalls for 25 s, is reported as failed so the parent can switch servers.
 */
function HlsVideo({ source, onPlaying, onFail }: { source: PublicStream; onPlaying: () => void; onFail: (reason: string) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let cancelled = false, started = false, hls: { destroy(): void } | null = null;
    const fail = (reason: string) => { if (!cancelled) { cancelled = true; onFail(reason); } };
    const startTimer = setTimeout(() => fail("took too long to start"), START_TIMEOUT_MS);
    let stall: ReturnType<typeof setTimeout> | undefined;
    const onPlay = () => { started = true; clearTimeout(startTimer); clearTimeout(stall); if (!cancelled) onPlaying(); };
    const onWait = () => { if (started) { clearTimeout(stall); stall = setTimeout(() => fail("stopped playing"), STALL_TIMEOUT_MS); } };
    video.addEventListener("playing", onPlay);
    video.addEventListener("waiting", onWait);

    (async () => {
      try {
        let url = source.url;
        if (source.needsToken) {
          const r = await fetch(`/api/v1/streams/${source.id}/playback`, { cache: "no-store" });
          if (!r.ok) return fail(r.status === 503 ? "isn't configured on the server" : "isn't available");
          url = ((await r.json()) as { url: string }).url;
        }
        if (!url || cancelled) return;
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (Hls.isSupported()) {
          let netRetried = false, mediaRetried = false;
          const h = new Hls({ lowLatencyMode: true, enableWorker: true });
          hls = h;
          h.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            // A playlist that is missing, refused or unparseable can't be fixed by retrying: switch server at once.
            // Only a dropped segment/level request is worth one in-place retry.
            const playlistProblem = data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT || data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;
            const refused = data.response?.code === 401 || data.response?.code === 403;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !netRetried && !playlistProblem) { netRetried = true; h.startLoad(); return; }
            if (refused) { fail("refused access (check the token or your country)"); return; }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRetried) { mediaRetried = true; h.recoverMediaError(); return; }
            fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? "couldn't be reached" : "couldn't be played");
          });
          h.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(() => undefined); });
          h.loadSource(url);
          h.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = url; // Safari / iOS play HLS natively
          video.addEventListener("error", () => fail("couldn't be played"), { once: true });
          void video.play().catch(() => undefined);
        } else fail("isn't supported by this browser");
      } catch { fail("couldn't be reached"); }
    })();

    return () => {
      cancelled = true; clearTimeout(startTimer); clearTimeout(stall);
      video.removeEventListener("playing", onPlay); video.removeEventListener("waiting", onWait);
      hls?.destroy(); video.removeAttribute("src"); video.load();
    };
    // The source object changes identity whenever the page refreshes its list; only these three fields matter here.
  }, [source.id, source.url, source.needsToken]);
  return <video ref={ref} className="absolute inset-0 h-full w-full bg-black" controls playsInline preload="none" aria-label="Match video" />;
}

function Frame({ source, title }: { source: PublicStream; title: string }) {
  const src = source.kind === "youtube" ? `https://www.youtube-nocookie.com/embed/${source.youtubeId}?autoplay=1&rel=0&modestbranding=1` : source.url!;
  return (
    <iframe src={src} title={`${title}: ${source.label}`} className="absolute inset-0 h-full w-full border-0" referrerPolicy="strict-origin-when-cross-origin"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
      sandbox={source.kind === "embed" ? "allow-scripts allow-same-origin allow-presentation allow-popups" : undefined} />
  );
}

const chip = (s: PublicStream["status"]) => (s === "live" ? "bg-pinkball/15 text-pinkball-ink" : "bg-canvas text-muted");

/**
 * The Watch experience: pick a server, press play, and it fails over by itself when a stream breaks. A stream is only
 * labelled LIVE when the server verified it is live. With nothing playable (or nothing for your country), it says so and
 * shows the official places to watch instead of a dead player.
 */
export function StreamPlayer({ sources, title, official }: { sources: PublicStream[]; title: string; official?: React.ReactNode }) {
  const region = useVisitorRegion();
  const order = useMemo(() => orderServers(sources, region), [sources, region]);
  const hidden = sources.length - sources.filter((s) => s.region === "WW" || region === null || s.region === region).length;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const active = order.find((s) => s.id === (activeId ?? order[0]?.id)) ?? null;

  const start = useCallback((id: string) => { setActiveId(id); setPhase("loading"); setAttempt((n) => n + 1); }, []);
  const onFail = useCallback((reason: string) => {
    if (!active) return;
    const nowFailed = new Set(failed).add(active.id);
    setFailed(nowFailed);
    const next = nextServer(order, nowFailed);
    if (next) { setNotice(`${active.label} ${reason}. Switched to ${next.label}.`); start(next.id); }
    else { setNotice(`${active.label} ${reason}. No other server is available.`); setPhase("error"); }
  }, [active, failed, order, start]);

  if (order.length === 0) {
    return (
      <section aria-labelledby="watch-h" className="space-y-4">
        <div className="floodlit rounded-[28px] p-6 sm:p-10">
          <h2 id="watch-h" className="wide text-2xl font-black text-white sm:text-3xl">Video isn&apos;t available here yet</h2>
          <p className="mt-3 max-w-xl text-white/75">
            {hidden > 0 ? "The streams for this match aren't available in your country." : "No licensed stream has been set up for this match."} Live scores and updates stay on the Live tab, and the official broadcasters are listed below.
          </p>
        </div>
        {official}
      </section>
    );
  }

  const liveNow = active?.status === "live";
  return (
    <section aria-labelledby="watch-h" className="space-y-4">
      <h2 id="watch-h" className="sr-only">Watch: {title}</h2>
      <div className="floodlit rounded-[28px] p-2.5 sm:p-4">
        <div className="relative aspect-video overflow-hidden rounded-[20px] bg-black">
          {phase === "idle" && active && (
            <button type="button" onClick={() => start(active.id)} className="group absolute inset-0 grid place-items-center text-white" aria-label={`Play ${title} on ${active.label}`}>
              <span className="flex flex-col items-center gap-3">
                <span className="grid size-20 place-items-center rounded-full bg-leather-600 ring-4 ring-white/20 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:scale-110">
                  <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
                </span>
                <span className="wide text-lg font-bold">{liveNow ? "Watch live" : active.status === "vod" ? "Watch replay" : "Play"}</span>
                <span className="text-sm text-white/70">{active.label}</span>
              </span>
            </button>
          )}
          {(phase === "loading" || phase === "playing") && active && (
            <div key={`${active.id}-${attempt}`} className="absolute inset-0">
              {active.kind === "hls" ? <HlsVideo source={active} onPlaying={() => setPhase("playing")} onFail={onFail} /> : <Frame source={active} title={title} />}
            </div>
          )}
          {phase === "loading" && active?.kind === "hls" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55" role="status">
              <span className="flex items-center gap-3 text-white"><span className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />Connecting to {active.label}…</span>
            </div>
          )}
          {phase === "error" && (
            <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-black p-3 text-center text-white sm:p-6" role="alert">
              <div className="max-w-sm space-y-2 sm:space-y-4">
                <p className="wide text-base font-bold sm:text-xl">We couldn&apos;t play this match</p>
                <p className="text-xs text-white/70 sm:text-sm">Every server we tried failed. This is usually temporary: the stream may not have started, or your connection dropped.</p>
                <button type="button" onClick={() => { setFailed(new Set()); setNotice(""); start(order[0]!.id); }} className="min-h-11 rounded-full bg-leather-600 px-6 font-bold transition-transform hover:-translate-y-0.5">Try again</button>
              </div>
            </div>
          )}
          {liveNow && phase === "playing" && <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-pinkball px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white"><span className="size-1.5 rounded-full bg-white" aria-hidden />Live</span>}
        </div>

        <div className="mt-3 flex items-center gap-2 px-1.5 text-sm text-white/80">
          <span className="font-semibold text-white">Servers</span>
          <div className="-mx-1 flex flex-1 gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]" role="group" aria-label="Choose a server">
            {order.map((s) => (
              <button key={s.id} type="button" aria-pressed={s.id === active?.id} onClick={() => { setFailed(new Set()); setNotice(""); start(s.id); }}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${s.id === active?.id ? "border-white bg-white text-ink" : "border-white/25 bg-white/5 text-white hover:bg-white/15"}`}>
                {s.label}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${s.id === active?.id ? chip(s.status) : "bg-white/15 text-white/80"}`}>{failed.has(s.id) ? "Couldn't connect" : STATUS_TEXT[s.status]}</span>
              </button>
            ))}
          </div>
          {active && active.kind !== "hls" && phase !== "idle" && order.length > 1 && (
            <button type="button" onClick={() => { const failedNow = new Set([...failed, active.id]); const n = nextServer(order, failedNow); if (n) { setFailed(failedNow); setNotice(`Switched to ${n.label}.`); start(n.id); } }}
              className="hidden shrink-0 rounded-full border border-white/25 px-3 py-2 text-xs font-semibold hover:bg-white/15 sm:block">Not working? Next server</button>
          )}
        </div>
        <p role="status" aria-live="polite" className="min-h-5 px-2 pt-1 text-sm text-thread">{notice}</p>
      </div>
      <p className="text-xs text-muted">
        Streams are provided by the official rights holder or its licensee, and played here or in the provider&apos;s own player. Availability depends on where you are.
        {order.some((s) => s.status === "live") ? "" : " No stream has been confirmed live right now."}
      </p>
      {official}
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { POLL_MS, type LiveSnapshot } from "@cricket/shared";

/**
 * Polls the live snapshot (plan §4.2):
 * - ±20% jitter so thousands of browsers don't fire in the same second
 * - pauses while the tab is hidden, refreshes immediately when it becomes visible
 * - ETag/If-None-Match → unchanged polls are tiny 304s
 * - exponential backoff (max 2 min) when the API is struggling, so we never pile on during an incident
 */
export function useLivePoll(initial: LiveSnapshot, enabled: boolean) {
  const [snap, setSnap] = useState(initial);
  const [stale, setStale] = useState(false);
  const etag = useRef(`"m${initial.version}"`);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let cancelled = false;

    const schedule = () => {
      const base = failures ? Math.min(POLL_MS.liveMatch * 2 ** failures, 120_000) : POLL_MS.liveMatch;
      timer = setTimeout(tick, base * (0.8 + Math.random() * 0.4));
    };
    const tick = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/v1/matches/${initial.match.id}/live`, { headers: { "if-none-match": etag.current }, cache: "no-store" });
        if (res.status === 200) {
          const next = (await res.json()) as LiveSnapshot;
          etag.current = res.headers.get("etag") ?? `"m${next.version}"`;
          setSnap((prev) => (next.version >= prev.version ? next : prev));
        } else if (res.status !== 304) throw new Error(String(res.status));
        failures = 0;
        setStale(false);
      } catch {
        failures += 1;
        setStale(true);
      }
      if (!cancelled) schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") { clearTimeout(timer); void tick(); }
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, initial.match.id]);

  return { snap, stale };
}

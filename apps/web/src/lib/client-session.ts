"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { PublicUser } from "@cricket/shared";

const subscribe = () => () => {};
/** Reads the non-secret `signed_in` hint (set by the API next to the HttpOnly session cookie). */
export function useSignedInHint(): boolean {
  return useSyncExternalStore(subscribe, () => /(?:^|;\s*)signed_in=1(?:;|$)/.test(document.cookie), () => false);
}

let mePromise: Promise<PublicUser | null> | null = null;
/** Who am I: asked at most once per page load, kept only in memory (never in browser storage). */
export function fetchMe(): Promise<PublicUser | null> {
  mePromise ??= fetch("/api/v1/auth/me", { cache: "no-store" })
    .then((r) => (r.ok ? r.json().then((d: { user: PublicUser }) => d.user) : null))
    .catch(() => null);
  return mePromise;
}

export function useMe() {
  const hint = useSignedInHint();
  const [state, setState] = useState<{ user: PublicUser | null; loading: boolean }>({ user: null, loading: hint });
  useEffect(() => {
    if (!hint) return;
    let alive = true;
    void fetchMe().then((user) => alive && setState({ user, loading: false }));
    return () => { alive = false; };
  }, [hint]);
  return hint ? state : { user: null, loading: false };
}

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

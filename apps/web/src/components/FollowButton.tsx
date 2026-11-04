"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSignedInHint } from "@/lib/client-session";

type Follow = { kind: "team" | "player"; id: string };
let followsPromise: Promise<Follow[]> | null = null;
const loadFollows = () => (followsPromise ??= fetch("/api/v1/me/follows", { cache: "no-store" }).then((r) => (r.ok ? r.json().then((d) => d.follows as Follow[]) : [])).catch(() => []));

export function FollowButton({ kind, id, name }: { kind: "team" | "player"; id: string; name: string }) {
  const signedIn = useSignedInHint();
  const path = usePathname();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    void loadFollows().then((list) => setFollowing(list.some((f) => f.kind === kind && f.id === id)));
  }, [signedIn, kind, id]);

  if (!signedIn) return <Link href={`/login?next=${encodeURIComponent(path)}`} className="rounded-full border border-line px-4 py-1.5 text-sm">Follow</Link>;
  const toggle = async () => {
    setBusy(true);
    const res = following
      ? await fetch(`/api/v1/me/follows/${kind}/${id}`, { method: "DELETE" })
      : await fetch("/api/v1/me/follows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id }) });
    if (res.ok) { setFollowing(!following); followsPromise = null; }
    setBusy(false);
  };
  return (
    <button onClick={toggle} disabled={busy || following === null} aria-pressed={!!following} aria-label={`${following ? "Unfollow" : "Follow"} ${name}`}
      className={`rounded-full px-4 py-1.5 text-sm disabled:opacity-60 ${following ? "border border-brand-700 text-brand-700" : "bg-brand-700 text-white"}`}>
      {following ? "Following" : "Follow"}
    </button>
  );
}

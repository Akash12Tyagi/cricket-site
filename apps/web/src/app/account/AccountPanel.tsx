"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

type Me = { email: string; displayName: string | null; role: string; createdAt: string };
type Follow = { kind: "team" | "player"; id: string; name: string | null; slug: string | null };
const card = "rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-sm";

export function AccountPanel() {
  const [me, setMe] = useState<Me | null | "anon">(null);
  const [follows, setFollows] = useState<Follow[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/v1/me", { cache: "no-store" });
      if (r.status === 401) { setMe("anon"); return; }
      const { user } = (await r.json()) as { user: Me };
      setMe(user); setName(user.displayName ?? "");
      const f = await fetch("/api/v1/me/follows", { cache: "no-store" });
      if (f.ok) setFollows(((await f.json()) as { follows: Follow[] }).follows);
    })();
  }, []);

  if (me === null) return <p className="text-muted">Loading…</p>;
  if (me === "anon") return <p className={card}>You&apos;re not logged in. <Link href="/login?next=/account" className="text-brand-700 underline">Log in</Link></p>;

  const call = (url: string, method: string, body?: unknown) =>
    fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const r = await call("/api/v1/me", "PATCH", { displayName: name.trim() || null });
    setMsg(r.ok ? "Saved." : "Names can use letters, numbers, spaces and . _ ' - (max 80).");
  };
  const unfollow = async (f: Follow) => {
    if ((await call(`/api/v1/me/follows/${f.kind}/${f.id}`, "DELETE")).ok) setFollows((l) => l.filter((x) => x.id !== f.id));
  };
  const logout = async (all: boolean) => { await call(`/api/v1/auth/${all ? "logout-all" : "logout"}`, "POST"); window.location.assign("/"); };
  const remove = async () => {
    const r = await call("/api/v1/me", "DELETE", { confirm: "DELETE" });
    if (r.ok) window.location.assign("/?deleted=1");
    else setMsg(((await r.json().catch(() => ({}))) as { message?: string }).message ?? "Couldn't delete the account. Try again.");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Your account</h1>
      {msg && <p role="status" className="rounded-lg bg-brand-50 p-3 text-sm">{msg}</p>}

      <section className={card} aria-labelledby="profile">
        <h2 id="profile" className="mb-3 font-semibold">Profile</h2>
        <p className="mb-3 text-sm text-muted">Signed in as {me.email}</p>
        <form onSubmit={saveName} className="flex gap-2">
          <label className="sr-only" htmlFor="dn">Display name</label>
          <input id="dn" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Display name" className="w-full rounded-lg border border-line px-3 py-2" />
          <button className="shrink-0 rounded-lg bg-brand-700 px-4 py-2 text-white">Save</button>
        </form>
      </section>

      <section className={card} aria-labelledby="following">
        <h2 id="following" className="mb-3 font-semibold">Following</h2>
        {follows.length === 0 ? <p className="text-sm text-muted">You don&apos;t follow any teams or players yet. Use the Follow button on their pages.</p> : (
          <ul className="divide-y divide-line">
            {follows.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="text-xs text-muted">{f.kind}</span>
                <Link href={`/${f.kind === "team" ? "teams" : "player"}/${f.slug}`} className="font-medium hover:underline">{f.name}</Link>
                <button onClick={() => unfollow(f)} className="ml-auto text-muted underline">Unfollow</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="privacy">
        <h2 id="privacy" className="mb-3 font-semibold">Privacy &amp; security</h2>
        <div className="flex flex-wrap gap-2">
          <a href="/api/v1/me/export" className="rounded-lg border border-line px-4 py-2 text-sm">Download my data</a>
          <button onClick={() => logout(false)} className="rounded-lg border border-line px-4 py-2 text-sm">Log out</button>
          <button onClick={() => logout(true)} className="rounded-lg border border-line px-4 py-2 text-sm">Log out on all devices</button>
        </div>
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
          <h3 className="font-medium text-live">Delete account</h3>
          <p className="mb-3 text-sm">This permanently deletes your account and follows. Type DELETE to confirm.</p>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="confirm">Type DELETE to confirm</label>
            <input id="confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="w-40 rounded-lg border border-line px-3 py-2" autoComplete="off" />
            <button onClick={remove} disabled={confirmText !== "DELETE"} className="rounded-lg bg-live px-4 py-2 text-sm text-white disabled:opacity-40">Delete my account</button>
          </div>
        </div>
      </section>
    </div>
  );
}

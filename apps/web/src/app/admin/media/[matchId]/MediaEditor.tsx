"use client";

import { useState, type FormEvent } from "react";
import { LocalTime } from "@/components/LocalTime";
import { StreamAdmin } from "./StreamAdmin";

type Watch = { id: string; matchId: string | null; seriesId: string | null; region: string; name: string; url: string; kind: string; note: string | null };
type Vid = { id: string; youtubeId: string; title: string; channelName: string | null; publishedAt: string; embeddable: boolean; hidden: boolean; isLive: boolean; source: string };
export type MediaData = {
  match: { id: string; title: string; slug: string; seriesId: string | null; status: string; feedProvider: string | null; feedMatchId: string | null; feedPaused: boolean; feedSyncedAt: string | null };
  watch: Watch[];
  videos: Vid[];
};

const card = "space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5";
const field = "rounded-lg border border-line px-3 py-1.5 text-sm";
const btn = "rounded-lg bg-brand-700 px-3 py-1.5 text-sm text-white disabled:opacity-50";

async function send(url: string, method: string, body?: object) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  const error = r.ok ? null : (data.message ?? data.issues?.map((i: { path: string; message: string }) => `${i.path || "form"}: ${i.message}`).join("; ") ?? data.error ?? "Request failed");
  return { ok: r.ok, data, error: error as string | null };
}

export function MediaEditor({ initial, isAdmin }: { initial: MediaData; isAdmin: boolean }) {
  const [d, setD] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const m = d.match;
  const reload = async () => { const r = await send(`/api/v1/admin/media/matches/${m.id}`, "GET"); if (r.ok) setD(r.data); };
  const run = async (fn: () => Promise<{ ok: boolean; error: string | null }>, done: string) => {
    setBusy(true); setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? "Failed" });
    if (r.ok) await reload();
    setBusy(false);
    return r.ok;
  };

  /* Where to watch */
  const [w, setW] = useState({ scope: "match", region: "IN", name: "", url: "", kind: "stream", note: "" });
  const addWatch = (e: FormEvent) => {
    e.preventDefault();
    const target = w.scope === "series" ? { seriesId: m.seriesId } : { matchId: m.id };
    void run(() => send("/api/v1/admin/watch-options", "POST", { ...target, region: w.region.toUpperCase(), name: w.name, url: w.url, kind: w.kind, note: w.note || null }), "Link added. It shows on the match page within a minute.")
      .then((ok) => ok && setW({ ...w, name: "", url: "", note: "" }));
  };

  /* Videos */
  const [vUrl, setVUrl] = useState("");
  const [vLive, setVLive] = useState(false);
  const addVideo = (e: FormEvent) => {
    e.preventDefault();
    void run(() => send("/api/v1/admin/videos", "POST", { url: vUrl, matchId: m.id, isLive: vLive }), "Video added.").then((ok) => ok && setVUrl(""));
  };

  /* Feed */
  const [fixture, setFixture] = useState(m.feedMatchId ?? "");

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs text-muted">{m.status}</p>
        <h1 className="text-xl font-semibold">{m.title}</h1>
        <a href={`/match/${m.slug}`} target="_blank" rel="noreferrer" className="text-sm text-brand-700 underline">Open public page</a>
      </header>
      {msg && <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-brand-50" : "bg-red-50 text-live"}`}>{msg.text}</p>}

      <section className={card} aria-labelledby="w">
        <h2 id="w" className="font-semibold">Where to watch</h2>
        <p className="text-xs text-muted">Link only to the official rights holder in each country (e.g. JioHotstar in India). Never link to unofficial streams.</p>
        <ul className="divide-y divide-line text-sm">
          {d.watch.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="w-10 font-mono text-xs">{o.region}</span>
              <a href={o.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{o.name}</a>
              <span className="text-xs text-muted">{o.kind}{o.seriesId ? " · whole series" : ""}{o.note ? ` · ${o.note}` : ""}</span>
              <button type="button" disabled={busy} onClick={() => run(() => send(`/api/v1/admin/watch-options/${o.id}`, "DELETE"), "Removed.")} className="ml-auto text-xs text-live underline">Remove</button>
            </li>
          ))}
          {d.watch.length === 0 && <li className="py-2 text-sm text-muted">No links yet.</li>}
        </ul>
        <form onSubmit={addWatch} className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Applies to<select value={w.scope} onChange={(e) => setW({ ...w, scope: e.target.value })} className={`${field} block`}><option value="match">This match</option>{m.seriesId && <option value="series">Whole series</option>}</select></label>
          <label className="text-xs">Country<input required pattern="[A-Za-z]{2}" title="2-letter code like IN, GB, US, AU, or WW for worldwide" maxLength={2} value={w.region} onChange={(e) => setW({ ...w, region: e.target.value })} className={`${field} block w-16 uppercase`} /></label>
          <label className="text-xs">Broadcaster<input required minLength={2} maxLength={80} placeholder="JioHotstar" value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} className={`${field} block`} /></label>
          <label className="text-xs">Official link<input required type="url" pattern="https://.*" placeholder="https://…" value={w.url} onChange={(e) => setW({ ...w, url: e.target.value })} className={`${field} block w-72`} /></label>
          <label className="text-xs">Type<select value={w.kind} onChange={(e) => setW({ ...w, kind: e.target.value })} className={`${field} block`}><option value="stream">Streaming</option><option value="tv">TV</option><option value="radio">Radio</option></select></label>
          <label className="text-xs">Note<input maxLength={160} placeholder="Subscription required" value={w.note} onChange={(e) => setW({ ...w, note: e.target.value })} className={`${field} block`} /></label>
          <button disabled={busy} className={btn}>Add</button>
        </form>
      </section>

      <section className={card} aria-labelledby="v">
        <h2 id="v" className="font-semibold">Official videos</h2>
        <p className="text-xs text-muted">Videos from the official channels are linked automatically when their title names both teams. You can also add an official YouTube video or live stream by URL; it&apos;s refused if the owner doesn&apos;t allow embedding.</p>
        <ul className="divide-y divide-line text-sm">
          {d.videos.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
              <img src={`https://i.ytimg.com/vi/${v.youtubeId}/default.jpg`} alt="" className="h-9 w-12 rounded object-cover" />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{v.title}</span>
                <span className="text-xs text-muted">{v.channelName} · <LocalTime iso={v.publishedAt} style="date" />{!v.embeddable && " · not embeddable (hidden from site)"}{v.isLive && " · live"}</span></span>
              <button type="button" disabled={busy} onClick={() => run(() => send(`/api/v1/admin/videos/${v.id}`, "PATCH", { hidden: !v.hidden }), v.hidden ? "Shown." : "Hidden.")} className="text-xs underline">{v.hidden ? "Show" : "Hide"}</button>
              <button type="button" disabled={busy} onClick={() => run(() => send(`/api/v1/admin/videos/${v.id}`, "PATCH", { matchId: null }), "Unlinked from this match.")} className="text-xs text-live underline">Unlink</button>
            </li>
          ))}
          {d.videos.length === 0 && <li className="py-2 text-sm text-muted">No videos linked yet.</li>}
        </ul>
        <form onSubmit={addVideo} className="flex flex-wrap items-center gap-2">
          <input required placeholder="https://www.youtube.com/watch?v=…" value={vUrl} onChange={(e) => setVUrl(e.target.value)} className={`${field} w-96`} />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={vLive} onChange={(e) => setVLive(e.target.checked)} /> Live stream</label>
          <button disabled={busy} className={btn}>Add video</button>
        </form>
      </section>

      <StreamAdmin matchId={m.id} isAdmin={isAdmin} />

      {isAdmin && (
        <section className={card} aria-labelledby="f">
          <h2 id="f" className="font-semibold">Live-score feed</h2>
          {m.feedProvider ? (
            <>
              <p className="text-sm">Linked to <b>{m.feedProvider}</b> fixture <span className="font-mono">{m.feedMatchId}</span> · {m.feedPaused ? <b className="text-amber-700">paused: manual scoring allowed</b> : "active: the feed scores this match"}
                {m.feedSyncedAt && <> · last sync <LocalTime iso={m.feedSyncedAt} style="time" /></>}</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy} className={btn} onClick={() => run(() => send(`/api/v1/admin/matches/${m.id}/feed`, "POST", { paused: !m.feedPaused }), m.feedPaused ? "Feed resumed. It re-syncs every ball from the provider." : "Feed paused. Scorers can now score manually.")}>{m.feedPaused ? "Resume feed" : "Pause feed (score manually)"}</button>
                <button type="button" disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm" onClick={() => confirm("Unlink this match from the feed?") && run(() => send(`/api/v1/admin/matches/${m.id}/feed`, "POST", { unlink: true }), "Unlinked.")}>Unlink</button>
              </div>
            </>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void run(() => send(`/api/v1/admin/matches/${m.id}/feed`, "POST", { provider: "sportmonks", feedMatchId: fixture }), "Linked. The feed worker takes over on its next poll."); }} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Sportmonks fixture id</span>
              <input required pattern="[0-9]{1,20}" value={fixture} onChange={(e) => setFixture(e.target.value)} className={`${field} w-40 font-mono`} />
              <button disabled={busy} className={btn}>Link to feed</button>
              <p className="w-full text-xs text-muted">Only needed for matches you created yourself. With auto-create on, the worker creates and links live matches automatically.</p>
            </form>
          )}
        </section>
      )}
    </div>
  );
}

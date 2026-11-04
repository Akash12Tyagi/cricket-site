"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LocalTime } from "@/components/LocalTime";

type Source = {
  id: string; kind: "youtube" | "hls" | "embed"; label: string; url: string; region: string; priority: number; enabled: boolean; rightsNote: string;
  authEnv: string | null; authEnvConfigured: boolean | null; lastCheckedAt: string | null; lastStatus: string | null; lastDetail: string | null;
};
type Config = { hlsHosts: string[]; embedHosts: string[]; tokenParam: string; youtubeLiveCheck: boolean; tokenVariables: string[] };

const field = "rounded-lg border border-line px-3 py-1.5 text-sm";
const STATUS: Record<string, string> = { live: "bg-pinkball/15 text-pinkball-ink", unknown: "bg-canvas text-muted", vod: "bg-canvas text-muted", offline: "bg-red-50 text-live", error: "bg-red-50 text-live" };
const WORDS: Record<string, string> = { live: "Live (verified)", unknown: "Reachable, not proven live", vod: "Replay", offline: "Offline", error: "Error" };

async function send(url: string, method: string, body?: object) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data, error: r.ok ? null : ((data.message ?? data.issues?.map((i: { path: string; message: string }) => `${i.path || "form"}: ${i.message}`).join("; ") ?? data.error ?? "Request failed") as string) };
}

/**
 * Live video servers for one match. Adding a source records who authorised it; the worker then keeps verifying it,
 * and the site only ever shows LIVE for a stream that was proven live. Licensed feeds and embeds are admin-only.
 */
export function StreamAdmin({ matchId, isAdmin }: { matchId: string; isAdmin: boolean }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ kind: "youtube", label: "", url: "", region: "WW", rightsNote: "", authEnv: "" });

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([send(`/api/v1/admin/stream-sources?matchId=${matchId}`, "GET"), send("/api/v1/admin/streams/config", "GET")]);
    if (a.ok) setSources(a.data.sources); if (b.ok) setCfg(b.data);
  }, [matchId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<{ ok: boolean; error: string | null }>, done: string) => {
    setBusy(true); setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? "Failed" });
    if (r.ok) await load();
    setBusy(false);
    return r.ok;
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(() => send("/api/v1/admin/stream-sources", "POST", { matchId, kind: f.kind, label: f.label, url: f.url, region: f.region.toUpperCase(), rightsNote: f.rightsNote, authEnv: f.authEnv || null }), "Added and checked.")
      .then((ok) => ok && setF({ ...f, label: "", url: "", authEnv: "" }));
  };
  const hlsReady = (cfg?.hlsHosts.length ?? 0) > 0, embedReady = (cfg?.embedHosts.length ?? 0) > 0;

  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="sv">
      <h2 id="sv" className="font-semibold">Live video servers (Watch tab)</h2>
      <p className="text-xs text-muted">Only add a stream you have the right to show: an official channel that allows embedding, or a feed licensed to you. Each source needs a note saying who authorised it. A stream is shown as LIVE only after the server has proven it is live.</p>
      {cfg && (
        <ul className="space-y-1 rounded-lg bg-canvas p-3 text-xs">
          <li>Licensed HLS feeds: {hlsReady ? <>enabled for <b>{cfg.hlsHosts.join(", ")}</b></> : <b className="text-live">not configured (set STREAM_HLS_HOSTS on the server)</b>}</li>
          <li>Provider embeds: {embedReady ? <>enabled for <b>{cfg.embedHosts.join(", ")}</b></> : <b className="text-muted">not configured (set STREAM_EMBED_HOSTS)</b>}</li>
          <li>YouTube live check: {cfg.youtubeLiveCheck ? "on" : <span className="text-muted">off (add YOUTUBE_API_KEY to prove a YouTube stream is live)</span>}</li>
          <li>Access-token variables found: {cfg.tokenVariables.length ? cfg.tokenVariables.join(", ") : <span className="text-muted">none</span>}</li>
        </ul>
      )}
      {msg && <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-brand-50" : "bg-red-50 text-live"}`}>{msg.text}</p>}
      <ul className="divide-y divide-line text-sm">
        {(sources ?? []).map((s) => (
          <li key={s.id} className="space-y-1 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{s.label}</span>
              <span className="rounded bg-canvas px-1.5 py-0.5 text-xs uppercase">{s.kind}</span>
              <span className="text-xs text-muted">{s.region}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[s.lastStatus ?? ""] ?? "bg-canvas text-muted"}`}>{s.lastStatus ? WORDS[s.lastStatus] ?? s.lastStatus : "Not checked yet"}</span>
              {!s.enabled && <span className="text-xs text-muted">(hidden from site)</span>}
              <span className="ml-auto flex gap-3 text-xs">
                <button type="button" disabled={busy} onClick={() => run(() => send(`/api/v1/admin/stream-sources/${s.id}/verify`, "POST"), "Checked.")} className="underline">Check now</button>
                <button type="button" disabled={busy} onClick={() => run(() => send(`/api/v1/admin/stream-sources/${s.id}`, "PATCH", { enabled: !s.enabled }), s.enabled ? "Hidden." : "Shown.")} className="underline">{s.enabled ? "Hide" : "Show"}</button>
                {isAdmin && <button type="button" disabled={busy} onClick={() => confirm("Delete this source?") && run(() => send(`/api/v1/admin/stream-sources/${s.id}`, "DELETE"), "Deleted.")} className="text-live underline">Delete</button>}
              </span>
            </div>
            <p className="text-xs text-muted">{s.lastDetail}{s.lastCheckedAt && <> · checked <LocalTime iso={s.lastCheckedAt} style="time" /></>}</p>
            {s.authEnv && <p className={`text-xs ${s.authEnvConfigured ? "text-muted" : "font-semibold text-live"}`}>Token: {s.authEnv} {s.authEnvConfigured ? "(set on the server)" : "is NOT set on the server: this stream cannot play until it is"}</p>}
            <p className="text-xs text-muted">Authorised by: {s.rightsNote}</p>
          </li>
        ))}
        {sources && sources.length === 0 && <li className="py-2 text-muted">No servers yet: viewers see the official where-to-watch links instead.</li>}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <label className="text-xs">Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={`${field} block`}>
          <option value="youtube">Official YouTube stream</option>
          {isAdmin && <option value="hls" disabled={!hlsReady}>Licensed HLS feed{hlsReady ? "" : " (not configured)"}</option>}
          {isAdmin && <option value="embed" disabled={!embedReady}>Provider embed{embedReady ? "" : " (not configured)"}</option>}
        </select></label>
        <label className="text-xs">Name<input required minLength={2} maxLength={60} placeholder="Server 1" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} className={`${field} block`} /></label>
        <label className="text-xs">Link<input required type="url" pattern="https://.*" placeholder={f.kind === "hls" ? "https://…/live.m3u8" : "https://…"} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} className={`${field} block w-80`} /></label>
        <label className="text-xs">Country<input required pattern="[A-Za-z]{2}" maxLength={2} title="2-letter code, or WW for worldwide" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} className={`${field} block w-16 uppercase`} /></label>
        {f.kind === "hls" && <label className="text-xs">Token variable (optional)<input pattern="STREAM_TOKEN_[A-Z0-9_]+" placeholder="STREAM_TOKEN_PROVIDER" value={f.authEnv} onChange={(e) => setF({ ...f, authEnv: e.target.value })} className={`${field} block w-52`} /></label>}
        <label className="w-full text-xs">Who authorised this stream, and on what basis? (required)<input required minLength={10} maxLength={300} placeholder="e.g. Licence agreement with <provider>, 12 Oct 2026, covers India" value={f.rightsNote} onChange={(e) => setF({ ...f, rightsNote: e.target.value })} className={`${field} block w-full`} /></label>
        <button disabled={busy} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">Add server</button>
      </form>
    </section>
  );
}

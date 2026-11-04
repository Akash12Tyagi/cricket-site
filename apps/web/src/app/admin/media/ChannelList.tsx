"use client";

import { useState, type FormEvent } from "react";
import { LocalTime } from "@/components/LocalTime";

export type Channel = { channelId: string; name: string; enabled: boolean; lastFetchedAt: string | null };
const field = "rounded-lg border border-line px-3 py-1.5 text-sm";

/** Official YouTube channels we list videos from. Only admins can add or switch them off. */
export function ChannelList({ initial, canEdit }: { initial: Channel[]; canEdit: boolean }) {
  const [list, setList] = useState(initial);
  const [form, setForm] = useState({ channelId: "", name: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const send = (url: string, method: string, body: object) => fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const toggle = async (c: Channel) => {
    const r = await send(`/api/v1/admin/video-channels/${c.channelId}`, "PATCH", { enabled: !c.enabled });
    if (r.ok) setList((l) => l.map((x) => (x.channelId === c.channelId ? { ...x, enabled: !c.enabled } : x)));
  };
  const add = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    const r = await send("/api/v1/admin/video-channels", "POST", form);
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setList((l) => [...l.filter((x) => x.channelId !== d.channel.channelId), d.channel]); setForm({ channelId: "", name: "" }); setMsg("Added. New videos appear within the next poll."); }
    else setMsg(d.issues?.[0]?.message ?? "Couldn't add that channel.");
  };

  return (
    <section aria-labelledby="channels" className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 id="channels" className="font-semibold">Official video channels</h2>
      <p className="mb-3 text-xs text-muted">Only add channels owned by the rights holder (ICC, a board, a league). Videos are shown only if the owner allows embedding.</p>
      <ul className="divide-y divide-line text-sm">
        {list.map((c) => (
          <li key={c.channelId} className="flex items-center gap-3 py-2">
            <a href={`https://www.youtube.com/channel/${c.channelId}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{c.name}</a>
            <span className="text-xs text-muted">{c.lastFetchedAt ? <>checked <LocalTime iso={c.lastFetchedAt} /></> : "not checked yet"}</span>
            {canEdit ? (
              <button type="button" onClick={() => toggle(c)} className={`ml-auto rounded-lg px-3 py-1 text-xs ${c.enabled ? "border border-line" : "bg-amber-100 text-amber-900"}`}>{c.enabled ? "Switch off" : "Switch on"}</button>
            ) : <span className="ml-auto text-xs text-muted">{c.enabled ? "On" : "Off"}</span>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={add} className="mt-3 flex flex-wrap gap-2">
          <input required placeholder="Channel id (UC…)" pattern="UC[A-Za-z0-9_-]{22}" value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value.trim() })} className={`${field} w-72 font-mono`} />
          <input required placeholder="Name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
          <button className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm text-white">Add channel</button>
          {msg && <p role="status" className="w-full text-sm">{msg}</p>}
        </form>
      )}
    </section>
  );
}

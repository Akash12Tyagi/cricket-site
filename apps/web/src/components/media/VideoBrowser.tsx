"use client";

import { useState } from "react";
import type { Video, VideoSort } from "@/lib/api";
import { VideoCards } from "./VideoGrid";

/** "Load more" through the whole catalogue (cursor paging; every page is CDN-cacheable). */
export function VideoBrowser({ sort, initial, next: firstNext }: { sort: VideoSort; initial: Video[]; next: string | null }) {
  const [list, setList] = useState(initial);
  const [next, setNext] = useState(firstNext);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const more = async () => {
    if (!next) return;
    setBusy(true); setFailed(false);
    try {
      const r = await fetch(`/api/v1/videos?limit=24&sort=${sort}&cursor=${encodeURIComponent(next)}`);
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { videos: Video[]; next: string | null };
      setList((l) => [...l, ...d.videos.filter((v) => !l.some((x) => x.id === v.id))]);
      setNext(d.next);
    } catch { setFailed(true); }
    setBusy(false);
  };
  return (
    <div className="space-y-5">
      <VideoCards videos={list} />
      {failed && <p role="status" className="text-sm text-live">Couldn&apos;t load more videos. Try again.</p>}
      {next && <button type="button" onClick={more} disabled={busy} className="mx-auto block rounded-lg border border-line bg-surface px-5 py-2 text-sm font-medium hover:bg-canvas disabled:opacity-50">{busy ? "Loading…" : "Load more"}</button>}
    </div>
  );
}

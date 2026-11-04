import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { adminGet } from "@/lib/admin-api";
import { getMatches } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { ChannelList, type Channel } from "./ChannelList";

type FeedStatus = {
  worker: { at: string; provider: string; ok: boolean; live?: number; error?: string; retryInSeconds?: number; warnings?: Record<string, string[]> } | null;
  linked: { id: string; title: string; status: string; feedMatchId: string; feedPaused: boolean; feedSyncedAt: string | null }[];
};
const card = "rounded-[var(--radius-card)] border border-line bg-surface p-5";

export default async function AdminMedia() {
  const user = await getCurrentUser();
  if (!user || user.role === "fan") redirect("/admin");
  const isAdmin = user.role === "admin";
  const canEdit = isAdmin || user.role === "editor";
  const canOperate = isAdmin || user.role === "scorer";
  const [feed, channels, live, upcoming, recent] = await Promise.all([
    canOperate ? adminGet<FeedStatus>("/v1/admin/feed/status") : null,
    canEdit ? adminGet<{ channels: Channel[] }>("/v1/admin/video-channels") : null,
    getMatches("live", 0), getMatches("upcoming", 0), getMatches("recent", 0),
  ]);
  const w = feed?.worker;
  const stale = w ? Date.now() - Date.parse(w.at) > 60_000 : true;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Media &amp; live feed</h1>

      {canOperate && (
        <section className={card} aria-labelledby="feed">
          <h2 id="feed" className="mb-2 font-semibold">Live-score feed</h2>
          {!w ? <p className="text-sm text-live">The feed worker isn&apos;t running (no heartbeat). Start it with <code>pnpm --filter @cricket/api feed</code>.</p> : (
            <p className={`text-sm ${!w.ok || stale ? "text-live" : ""}`}>
              Provider <b>{w.provider}</b> · last poll <LocalTime iso={w.at} style="time" />{stale && " (stale: worker stopped?)"} ·{" "}
              {w.ok ? `${w.live ?? 0} live fixture(s)` : `error: ${w.error} (retrying in ${w.retryInSeconds}s)`}
            </p>
          )}
          {w?.warnings && Object.keys(w.warnings).length > 0 && (
            <details className="mt-2 text-xs"><summary className="cursor-pointer">Mapping warnings</summary>
              <ul className="mt-1 list-disc pl-5">{Object.entries(w.warnings).map(([id, list]) => <li key={id}>Fixture {id}: {list.join("; ")}</li>)}</ul>
            </details>
          )}
          {feed && feed.linked.length > 0 && (
            <ul className="mt-3 divide-y divide-line text-sm">
              {feed.linked.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${m.feedPaused ? "bg-amber-100 text-amber-900" : "bg-brand-100 text-brand-900"}`}>{m.feedPaused ? "Paused" : "Feed"}</span>
                  <Link href={`/admin/media/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
                  <span className="text-xs text-muted">{m.status} · fixture {m.feedMatchId}{m.feedSyncedAt && <> · synced <LocalTime iso={m.feedSyncedAt} style="time" /></>}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canEdit && (
        <section className={card} aria-labelledby="matches">
          <h2 id="matches" className="mb-2 font-semibold">Matches: where to watch, videos{isAdmin && ", feed link"}</h2>
          <ul className="divide-y divide-line text-sm">
            {[...live, ...upcoming, ...recent.slice(0, 20)].map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <span className="w-24 shrink-0 text-xs text-muted">{m.status}</span>
                <span className="font-medium">{m.title}</span>
                <Link href={`/admin/media/${m.id}`} className="ml-auto rounded-lg border border-line px-3 py-1 text-xs hover:bg-canvas">Manage</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {channels && <ChannelList initial={channels.channels} canEdit={isAdmin} />}
    </div>
  );
}

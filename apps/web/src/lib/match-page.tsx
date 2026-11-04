import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MatchView, type MatchTab } from "@/components/match/MatchView";
import { summaryLine } from "@/components/match/format";
import { VideoGrid } from "@/components/media/VideoGrid";
import { WatchOptions } from "@/components/media/WatchOptions";
import { StreamPlayer } from "@/components/stream/StreamPlayer";
import { getLive, getMatchMedia, getMatchStreams } from "@/lib/api";

const TITLES: Record<MatchTab, string> = { live: "Live score", watch: "Watch live", scorecard: "Full scorecard", commentary: "Ball-by-ball commentary", squads: "Squads & playing XI" };
const SUFFIX: Record<MatchTab, string> = { live: "", watch: "/watch", scorecard: "/scorecard", commentary: "/commentary", squads: "/squads" };

/** Shared by every match tab page: metadata (live score in <title>) and the page body. */
export async function matchMetadata(slug: string, tab: MatchTab): Promise<Metadata> {
  const snap = await getLive(slug);
  if (!snap) return { title: "Match" };
  const title = tab === "live" ? summaryLine(snap) : `${snap.match.title}: ${TITLES[tab]}`;
  return {
    title,
    description: `${TITLES[tab]}: ${snap.match.title}. ${summaryLine(snap)}`,
    alternates: { canonical: `/match/${snap.match.slug}${SUFFIX[tab]}` },
    openGraph: { title, type: "website" },
  };
}

export async function MatchPage({ slug, tab }: { slug: string; tab: MatchTab }) {
  const [snap, media, streams] = await Promise.all([getLive(slug), getMatchMedia(slug), tab === "watch" ? getMatchStreams(slug) : Promise.resolve([])]);
  if (snap === null) notFound();
  return (
    <div className="space-y-6">
      <MatchView initial={snap} tab={tab} />
      {tab === "watch"
        ? <StreamPlayer sources={streams} title={snap.match.title} official={<WatchOptions options={media.watch} />} />
        : <WatchOptions options={media.watch} />}
      {tab === "live" && <VideoGrid videos={media.videos} title="Highlights & videos" />}
    </div>
  );
}

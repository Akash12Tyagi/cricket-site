import Link from "next/link";
import { VideoBrowser } from "@/components/media/VideoBrowser";
import { YouTubeCredit } from "@/components/media/VideoGrid";
import { PageHero } from "@/components/PageHero";
import { getVideos, type VideoSort } from "@/lib/api";

export const VIDEO_TABS: { sort: VideoSort; label: string; path: string; empty: string }[] = [
  { sort: "latest", label: "Latest", path: "/videos", empty: "No videos yet." },
  { sort: "popular", label: "Most viewed", path: "/videos/popular", empty: "View counts appear once the YouTube API key is set up." },
  { sort: "week", label: "Most viewed this week", path: "/videos/week", empty: "No views counted for this week's videos yet." },
];

/** Shared body of /videos, /videos/popular and /videos/week (each a separately cached static page). */
export async function VideosPage({ sort }: { sort: VideoSort }) {
  const { videos, next } = await getVideos(sort);
  const tab = VIDEO_TABS.find((t) => t.sort === sort)!;
  return (
    <div className="space-y-5">
      <PageHero title="Videos & highlights" subtitle="Official highlights from the ICC and cricket boards. Tap to play." />
      <nav aria-label="Video lists" className="flex w-fit max-w-full gap-1.5 overflow-x-auto rounded-full border border-line bg-surface p-1.5 [scrollbar-width:none]">
        {VIDEO_TABS.map((t) => (
          <Link key={t.sort} href={t.path} aria-current={t.sort === sort ? "page" : undefined}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${t.sort === sort ? "bg-leather-700 text-white" : "text-muted hover:bg-canvas hover:text-ink"}`}>{t.label}</Link>
        ))}
      </nav>
      {videos.length === 0 ? <p className="text-muted">{tab.empty}</p> : <VideoBrowser key={sort} sort={sort} initial={videos} next={next} />}
      <YouTubeCredit />
    </div>
  );
}

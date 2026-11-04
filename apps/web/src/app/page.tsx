import Link from "next/link";
import type { ArticleSummary } from "@/components/ArticleList";
import { FixtureDays } from "@/components/FixtureDays";
import { LiveRail } from "@/components/LiveRail";
import { LocalTime } from "@/components/LocalTime";
import { ResultRows } from "@/components/ResultRows";
import { VideoCards } from "@/components/media/VideoGrid";
import { apiGet, getMatches, getVideos } from "@/lib/api";

// ISR: rebuilt at most every 30 s and served from cache in between (plan §3.1); live scores refresh client-side.
export const revalidate = 30;

function Heading({ id, children, more }: { id: string; children: React.ReactNode; more?: { href: string; label: string } }) {
  return (
    <div className="mb-4 flex items-end gap-4">
      <h2 id={id} className="wide text-xl font-bold tracking-tight sm:text-2xl">{children}</h2>
      {more && <Link href={more.href} className="ml-auto text-sm font-medium text-leather-700 hover:underline">{more.label}</Link>}
    </div>
  );
}

export default async function Home() {
  const [live, upcoming, recent, news, videos] = await Promise.all([
    getMatches("live", 10), getMatches("upcoming"), getMatches("recent", 300),
    apiGet<{ articles: ArticleSummary[] }>("/v1/articles?limit=6", 60).catch(() => null),
    getVideos("latest", 300).catch(() => ({ videos: [], next: null })),
  ]);
  return (
    <div className="space-y-14">
      <section aria-labelledby="live">
        <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-1">
          <h1 id="live" className="wide text-3xl font-extrabold tracking-tight sm:text-4xl">
            Live now
            {live.length > 0 && <span className="score ml-3 align-middle text-base font-semibold text-pinkball-ink">{live.length} match{live.length === 1 ? "" : "es"}</span>}
          </h1>
          <p className="text-sm text-muted sm:ml-auto">Scores update on their own. Tap a match for the full scorecard.</p>
        </div>
        <LiveRail initial={live} next={upcoming[0] ?? null} />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="fixtures">
          <Heading id="fixtures" more={{ href: "/schedule", label: "Full schedule" }}>Coming up</Heading>
          <FixtureDays matches={upcoming} limit={14} />
        </section>

        <div className="space-y-12">
          {news && news.articles.length > 0 && (
            <section aria-labelledby="stories">
              <Heading id="stories" more={{ href: "/news", label: "All news" }}>Stories</Heading>
              <ul className="divide-y divide-line">
                {news.articles.map((a) => (
                  <li key={a.id} className="group relative py-3 first:pt-0">
                    <span className="block min-w-0">
                      <Link href={`/news/${a.slug}`} className="font-semibold leading-snug after:absolute after:inset-0 group-hover:text-leather-700">{a.title}</Link>
                      <span className="mt-0.5 block text-xs text-muted"><LocalTime iso={a.publishedAt} style="date" /></span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="results">
            <Heading id="results" more={{ href: "/schedule", label: "All results" }}>Results</Heading>
            <ResultRows matches={recent.slice(0, 5)} />
          </section>
        </div>
      </div>

      {videos.videos.length > 0 && (
        <section aria-labelledby="highlights">
          <Heading id="highlights" more={{ href: "/videos", label: "More videos" }}>Highlights</Heading>
          <VideoCards videos={videos.videos.slice(0, 3)} />
        </section>
      )}
    </div>
  );
}

import type { MetadataRoute } from "next";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
const SITE = process.env.SITE_URL ?? "http://localhost:3100";
// Rendered on request (data is cached for 1 h by the fetch below), so a deploy never freezes a stale or empty sitemap.
export const dynamic = "force-dynamic";

type Row = { slug: string; updatedAt: string };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics: MetadataRoute.Sitemap = ["", "/schedule", "/series", "/teams", "/news", "/videos", "/videos/popular", "/videos/week"].map((p) => ({ url: `${SITE}${p}`, changeFrequency: "hourly", priority: p ? 0.7 : 1 }));
  try {
    const res = await fetch(`${API}/v1/sitemap`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return statics;
    const d = (await res.json()) as Record<"matches" | "series" | "teams" | "players" | "articles", Row[]>;
    const map = (rows: Row[], prefix: string, priority: number) => rows.map((r) => ({ url: `${SITE}${prefix}/${r.slug}`, lastModified: r.updatedAt, priority }));
    return [...statics, ...map(d.matches, "/match", 0.8), ...map(d.series, "/series", 0.6), ...map(d.teams, "/teams", 0.5), ...map(d.players, "/player", 0.4), ...map(d.articles ?? [], "/news", 0.7)];
  } catch {
    return statics; // never fail the sitemap because the API is briefly down
  }
}

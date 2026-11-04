import type { Metadata } from "next";
import { ArticleList, type ArticleSummary } from "@/components/ArticleList";
import { PageHero } from "@/components/PageHero";
import { apiGet } from "@/lib/api";

export const revalidate = 60;
export const metadata: Metadata = { title: "Cricket news", description: "Latest cricket news, match reports and features.", alternates: { canonical: "/news" } };

export default async function NewsIndex() {
  const d = await apiGet<{ articles: ArticleSummary[] }>("/v1/articles?limit=30", 60);
  return (
    <div className="space-y-8">
      <PageHero title="News" subtitle="Match reports, milestones and previews, written the moment they happen." />
      <ArticleList articles={d?.articles ?? []} />
    </div>
  );
}

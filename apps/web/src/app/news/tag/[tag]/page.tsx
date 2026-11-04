import type { Metadata } from "next";
import { ArticleList, type ArticleSummary } from "@/components/ArticleList";
import { PageHero } from "@/components/PageHero";
import { apiGet } from "@/lib/api";

export const revalidate = 120;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }
type Props = { params: Promise<{ tag: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  return { title: `${tag.replace(/-/g, " ")} news`, alternates: { canonical: `/news/tag/${tag}` } };
}

export default async function TagPage({ params }: Props) {
  const { tag } = await params;
  const d = await apiGet<{ articles: ArticleSummary[] }>(`/v1/articles?tag=${encodeURIComponent(tag)}&limit=30`, 120);
  const label = d?.articles[0]?.tags.find((t) => t.slug === tag)?.name ?? tag;
  return (
    <div className="space-y-8">
      <PageHero title={label} subtitle="Every story tagged with this." />
      <ArticleList articles={d?.articles ?? []} />
    </div>
  );
}

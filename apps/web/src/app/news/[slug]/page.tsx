import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ball } from "@/components/Ball";
import { LocalTime } from "@/components/LocalTime";
import { apiGet } from "@/lib/api";

export const revalidate = 60;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

type Article = { title: string; slug: string; summary: string | null; bodyHtml: string; heroImageUrl: string | null; publishedAt: string; updatedAt: string; author: string | null; tags: { name: string; slug: string }[] };
type Props = { params: Promise<{ slug: string }> };
const load = async (slug: string) => apiGet<{ article: Article }>(`/v1/articles/${encodeURIComponent(slug)}`, 60);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await load((await params).slug);
  if (!d) return { title: "News" };
  const a = d.article;
  return {
    title: a.title, description: a.summary ?? undefined, alternates: { canonical: `/news/${a.slug}` },
    openGraph: { type: "article", title: a.title, description: a.summary ?? undefined, publishedTime: a.publishedAt, ...(a.heroImageUrl ? { images: [a.heroImageUrl] } : {}) },
  };
}

export default async function ArticlePage({ params }: Props) {
  const d = await load((await params).slug);
  if (d === null) notFound();
  const a = d.article;
  const ld = { "@context": "https://schema.org", "@type": "NewsArticle", headline: a.title, description: a.summary ?? undefined, datePublished: a.publishedAt, dateModified: a.updatedAt,
    ...(a.heroImageUrl ? { image: [a.heroImageUrl] } : {}), ...(a.author ? { author: { "@type": "Person", name: a.author } } : {}) };
  return (
    <article className="mx-auto max-w-3xl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <Link href="/news" className="text-sm font-semibold text-leather-700 hover:underline">News</Link>
      <h1 className="wide mt-3 text-3xl font-black leading-[1.08] tracking-tight sm:text-5xl">{a.title}</h1>
      {a.summary && <p className="mt-4 text-lg leading-relaxed text-ink/75 sm:text-xl">{a.summary}</p>}
      <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Ball kind="red" size={14} />{a.author ? <>By {a.author} · </> : null}<LocalTime iso={a.publishedAt} style="date" /></p>
      <div aria-hidden className="seam-stitch mt-6 h-2.5 rounded-full bg-leather-800" />
      {a.heroImageUrl && (
        // Images are https-only and validated on save; dimensions reserved to avoid layout shift.
        <img src={a.heroImageUrl} alt="" width={1200} height={675} className="mt-5 aspect-video w-full rounded-[var(--radius-card)] object-cover" />
      )}
      {/* bodyHtml was rendered from Markdown and sanitised with a strict allow-list on the server at save time. */}
      <div className="article mt-6" dangerouslySetInnerHTML={{ __html: a.bodyHtml }} />
      {a.tags.length > 0 && (
        <p className="mt-8 flex flex-wrap gap-2 text-sm">{a.tags.map((t) => <Link key={t.slug} href={`/news/tag/${t.slug}`} className="rounded-full border border-line bg-surface px-3 py-1 font-medium transition-colors hover:border-leather-600 hover:bg-brand-50">{t.name}</Link>)}</p>
      )}
    </article>
  );
}

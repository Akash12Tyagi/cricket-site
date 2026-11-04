import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGet } from "@/lib/admin-api";
import { getCurrentUser } from "@/lib/session";

type Row = { id: string; title: string; slug: string; publishedAt: string | null; updatedAt: string };

export default async function AdminNews() {
  const user = await getCurrentUser();
  if (user?.role !== "editor" && user?.role !== "admin") redirect("/admin");
  const data = await adminGet<{ articles: Row[] }>("/v1/admin/articles");
  return (
    <>
      <div className="flex items-center"><h1 className="text-xl font-semibold">News</h1><Link href="/admin/news/new" className="ml-auto rounded-lg bg-brand-700 px-3 py-1.5 text-sm text-white">New story</Link></div>
      {!data ? <p className="text-muted">Couldn&apos;t load stories.</p> : data.articles.length === 0 ? <p className="text-muted">No stories yet.</p> : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {data.articles.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-3">
              <span className={`rounded px-1.5 py-0.5 text-xs ${a.publishedAt ? "bg-brand-100 text-brand-900" : "bg-canvas text-muted"}`}>{a.publishedAt ? "Published" : "Draft"}</span>
              <Link href={`/admin/news/${a.id}`} className="font-medium hover:underline">{a.title}</Link>
              {a.publishedAt && <Link href={`/news/${a.slug}`} className="ml-auto text-sm text-brand-700 underline" target="_blank">View</Link>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

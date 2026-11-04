import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic"; // per-user pages: never cached

/** Server-side gate: only scorers/admins see anything under /admin. The API re-checks every call. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "fan") {
    return <p className="rounded-lg border border-line bg-surface p-6">You don&apos;t have access to the admin tools.</p>;
  }
  const canScore = user.role === "scorer" || user.role === "admin";
  const canEdit = user.role === "editor" || user.role === "admin";
  return (
    <div className="space-y-4">
      <nav aria-label="Admin" className="flex gap-4 border-b border-line pb-2 text-sm">
        {canScore && <Link href="/admin" className="hover:underline">Scoring</Link>}
        {canEdit && <Link href="/admin/news" className="hover:underline">News</Link>}
        <Link href="/admin/media" className="hover:underline">Media &amp; feed</Link>
        <span className="ml-auto text-xs text-muted">Signed in as {user.role}</span>
      </nav>
      {children}
    </div>
  );
}

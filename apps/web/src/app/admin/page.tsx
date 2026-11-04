import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import Link from "next/link";
import { getMatches } from "@/lib/api";

export default async function AdminHome() {
  const user = await getCurrentUser();
  if (user?.role === "editor") redirect("/admin/news");
  const [live, upcoming] = await Promise.all([getMatches("live", 0), getMatches("upcoming", 0)]);
  const list = [...(live ?? []), ...(upcoming ?? [])];
  return (
    <>
      <h1 className="text-xl font-semibold">Scoring</h1>
      {list.length === 0 ? <p className="text-muted">No live or upcoming matches.</p> : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {list.map((m) => (
            <li key={m.id} className="flex items-center gap-3 p-3">
              <span className="text-xs text-muted">{m.status}</span>
              <span className="font-medium">{m.title}</span>
              <Link href={`/admin/score/${m.id}`} className="ml-auto rounded-lg bg-brand-700 px-3 py-1.5 text-sm text-white">Score</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

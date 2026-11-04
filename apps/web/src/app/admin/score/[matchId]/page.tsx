import { getCurrentUser } from "@/lib/session";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE, type LiveSnapshot } from "@cricket/shared";
import { ScorerPanel } from "./ScorerPanel";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

export default async function ScorePage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const user = await getCurrentUser();
  if (user?.role !== "scorer" && user?.role !== "admin") redirect("/admin/news");
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const res = await fetch(`${API}/v1/admin/matches/${encodeURIComponent(matchId)}/live`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` }, cache: "no-store", signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  if (res?.status === 404 || res?.status === 400) notFound();
  if (!res?.ok) return <p className="rounded-lg border border-line bg-surface p-6">Couldn&apos;t load the match. Please refresh.</p>;
  return <ScorerPanel initial={(await res.json()) as LiveSnapshot} />;
}

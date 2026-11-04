import { notFound, redirect } from "next/navigation";
import { adminGet } from "@/lib/admin-api";
import { getCurrentUser } from "@/lib/session";
import { MediaEditor, type MediaData } from "./MediaEditor";

export default async function MatchMedia({ params }: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "editor" && user?.role !== "admin") redirect("/admin/media");
  const { matchId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(matchId)) notFound();
  const data = await adminGet<MediaData>(`/v1/admin/media/matches/${matchId}`);
  if (!data) notFound();
  return <MediaEditor initial={data} isAdmin={user.role === "admin"} />;
}

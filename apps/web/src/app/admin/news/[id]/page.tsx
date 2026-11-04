import { notFound, redirect } from "next/navigation";
import { adminGet } from "@/lib/admin-api";
import { getCurrentUser } from "@/lib/session";
import { ArticleEditor, type EditableArticle } from "./ArticleEditor";

export default async function EditArticle({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "editor" && user?.role !== "admin") redirect("/admin");
  const { id } = await params;
  if (id === "new") return <ArticleEditor initial={null} />;
  const data = await adminGet<{ article: EditableArticle }>(`/v1/admin/articles/${encodeURIComponent(id)}`);
  if (!data) notFound();
  return <ArticleEditor initial={data.article} />;
}

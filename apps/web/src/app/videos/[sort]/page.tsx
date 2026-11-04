import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { VideoSort } from "@/lib/api";
import { VideosPage } from "@/lib/videos-page";

export const revalidate = 300;
export const dynamicParams = false;
export function generateStaticParams() { return [{ sort: "popular" }, { sort: "week" }]; }

const TITLES: Record<string, string> = { popular: "Most viewed cricket videos", week: "Most viewed cricket videos this week" };
type Props = { params: Promise<{ sort: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sort } = await params;
  return { title: TITLES[sort] ?? "Videos", alternates: { canonical: `/videos/${sort}` } };
}

export default async function Page({ params }: Props) {
  const { sort } = await params;
  if (sort !== "popular" && sort !== "week") notFound();
  return <VideosPage sort={sort as VideoSort} />;
}

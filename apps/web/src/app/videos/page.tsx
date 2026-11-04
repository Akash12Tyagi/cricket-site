import type { Metadata } from "next";
import { VideosPage } from "@/lib/videos-page";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Cricket videos & highlights",
  description: "Official highlights and videos from the ICC and cricket boards.",
  alternates: { canonical: "/videos" },
};

export default function Page() { return <VideosPage sort="latest" />; }

import { MatchPage, matchMetadata } from "@/lib/match-page";

export const revalidate = 5;
type Props = { params: Promise<{ slug: string }> };
export const generateMetadata = async ({ params }: Props) => matchMetadata((await params).slug, "commentary");
export default async function Page({ params }: Props) { return <MatchPage slug={(await params).slug} tab="commentary" />; }

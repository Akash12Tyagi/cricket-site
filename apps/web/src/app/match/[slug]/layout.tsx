import { getLive } from "@/lib/api";

// No match pages are prebuilt at deploy time; each is rendered on first visit, then cached (ISR) for all viewers.
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

const STATUS: Record<string, string> = { SCHEDULED: "EventScheduled", ABANDONED: "EventCancelled", CANCELLED: "EventCancelled", DELAYED: "EventPostponed" };

/** Structured data (schema.org SportsEvent) so search engines understand the match. */
export default async function MatchLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const snap = await getLive((await params).slug).catch(() => null);
  const ld = snap ? {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: snap.match.title,
    sport: "Cricket",
    startDate: snap.match.startsAt,
    eventStatus: `https://schema.org/${STATUS[snap.match.status] ?? "EventScheduled"}`,
    competitor: snap.teams.map((t) => ({ "@type": "SportsTeam", name: t.name })),
    ...(snap.venue ? { location: { "@type": "Place", name: snap.venue.name, address: snap.venue.city ?? undefined } } : {}),
  } : null;
  return (
    <>
      {/* JSON is escaped so a team name can never break out of the script tag. */}
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />}
      {children}
    </>
  );
}

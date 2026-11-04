import { ImageResponse } from "next/og";
import { getLive } from "@/lib/api";
import { score, teamName } from "@/components/match/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 60;
export async function generateStaticParams() { return []; }
export const alt = "Live cricket score";

/** Share card for WhatsApp/X/Facebook: teams and the current score, regenerated at most once a minute. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const snap = await getLive((await params).slug).catch(() => null);
  const ok = !!snap;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#064e3b", color: "white", fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 32, opacity: 0.8 }}>{`CricketLive${ok ? ` · ${snap.match.format}` : ""}`}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 60, fontWeight: 700 }}>{ok ? snap.match.title : "Live cricket scores"}</div>
          {ok && snap.innings.map((i) => (
            <div key={i.id} style={{ fontSize: 48 }}>{`${teamName(snap, i.battingTeamId)}   ${score(i)}   (${i.overs} ov)`}</div>
          ))}
        </div>
        <div style={{ fontSize: 30, opacity: 0.8 }}>{ok ? (snap.match.resultText ?? snap.match.status) : ""}</div>
      </div>
    ),
    size,
  );
}

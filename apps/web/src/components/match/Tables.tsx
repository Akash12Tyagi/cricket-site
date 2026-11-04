import type { LiveSnapshot } from "@cricket/shared";
import Link from "next/link";
import { economy, howOut, oversOf, playerName, strikeRate, teamName, type Innings } from "./format";

const playerSlug = (s: LiveSnapshot, id: string) => s.players.find((p) => p.playerId === id);

export function PlayerLink({ s, id }: { s: LiveSnapshot; id: string }) {
  const p = playerSlug(s, id);
  if (!p) return <>Unknown</>;
  return <Link href={`/player/${p.slug}`} className="hover:underline">{p.knownAs ?? p.name}</Link>;
}

export function BattingTable({ s, i, full = false }: { s: LiveSnapshot; i: Innings; full?: boolean }) {
  const atCrease = new Set([i.next.strikerId, i.next.nonStrikerId]);
  const rows = i.batters.filter((b) => full || b.balls > 0 || b.out || atCrease.has(b.playerId));
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Batting, {teamName(s, i.battingTeamId)}</caption>
      <thead className="text-left text-xs text-muted"><tr><th className="py-1">Batter</th><th className="hidden sm:table-cell" /><th className="text-right">R</th><th className="text-right">B</th><th className="text-right">4s</th><th className="text-right">6s</th><th className="text-right">SR</th></tr></thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.playerId} className="border-t border-line align-top">
            <td className="py-1.5">
              <span className="font-medium"><PlayerLink s={s} id={b.playerId} />{!i.isComplete && b.playerId === i.next.strikerId && " *"}</span>
              <span className="block text-xs text-muted sm:hidden">{howOut(s, b)}</span>
            </td>
            <td className="hidden py-1.5 text-xs text-muted sm:table-cell">{howOut(s, b)}</td>
            <td className="text-right font-semibold">{b.runs}</td><td className="text-right">{b.balls}</td>
            <td className="text-right">{b.fours}</td><td className="text-right">{b.sixes}</td>
            <td className="text-right">{strikeRate(b.runs, b.balls)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BowlingTable({ s, i }: { s: LiveSnapshot; i: Innings }) {
  const bpo = s.match.ballsPerOver;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Bowling, {teamName(s, i.bowlingTeamId)}</caption>
      <thead className="text-left text-xs text-muted"><tr><th className="py-1">Bowler</th><th className="text-right">O</th><th className="text-right">M</th><th className="text-right">R</th><th className="text-right">W</th><th className="text-right">Wd</th><th className="text-right">Nb</th><th className="text-right">Econ</th></tr></thead>
      <tbody>
        {i.bowlers.map((b) => (
          <tr key={b.playerId} className="border-t border-line">
            <td className="py-1.5 font-medium"><PlayerLink s={s} id={b.playerId} />{!i.isComplete && b.playerId === i.next.lastBowlerId && !i.next.overComplete && " *"}</td>
            <td className="text-right">{oversOf(b.legalBalls, bpo)}</td><td className="text-right">{b.maidens}</td>
            <td className="text-right">{b.runs}</td><td className="text-right font-semibold">{b.wickets}</td>
            <td className="text-right">{b.wides}</td><td className="text-right">{b.noBalls}</td>
            <td className="text-right">{economy(b.runs, b.legalBalls, bpo)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function InningsFooter({ s, i }: { s: LiveSnapshot; i: Innings }) {
  const e = i.extras;
  return (
    <div className="space-y-1 text-xs text-muted">
      <p>Extras <span className="font-semibold text-ink">{e.total}</span> (b {e.byes}, lb {e.legByes}, w {e.wides}, nb {e.noBalls}{e.penalty ? `, p ${e.penalty}` : ""})</p>
      <p>Total <span className="font-semibold text-ink">{i.runs}/{i.wickets}</span> ({i.overs} ov{i.runRate != null ? `, RR ${i.runRate}` : ""})</p>
      {i.fallOfWickets.length > 0 && (
        <p><span className="font-semibold text-ink">Fall of wickets: </span>
          {i.fallOfWickets.map((f) => `${f.runs}-${f.wicket} (${playerName(s, f.playerId)}, ${oversOf(f.legalBalls, s.match.ballsPerOver)} ov)`).join(", ")}</p>
      )}
    </div>
  );
}

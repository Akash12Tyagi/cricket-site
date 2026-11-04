// Development only: simulates a complete fictional T20 match ball-by-ball through the real scoring
// engine (every delivery is validated), so pages, scorecards and player stats have realistic data.
// Usage: pnpm --filter @cricket/db seed-demo
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { computeInnings, isInningsComplete, validateDelivery, type Delivery, type InningsLimits } from "@cricket/shared";
import { balls, commentary, createDb, innings, matches, matchPlayers, players, series, teams, venues } from "./index.js";

config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed production");
const { db, client } = createDb(process.env.DATABASE_URL ?? "", { max: 1 });

// Deterministic PRNG so the demo match is the same every time.
let state = 20261026;
const rand = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const existing = await db.query.series.findFirst({ where: (s, { eq }) => eq(s.slug, "demo-premier-t20-2026") });
if (existing) { process.stdout.write("demo already seeded\n"); await client.end(); process.exit(0); }

const [ser] = await db.insert(series).values({ name: "Demo Premier T20", season: "2026", slug: "demo-premier-t20-2026", startDate: new Date("2026-10-20") }).returning();
const [venue] = await db.insert(venues).values({ name: "Harbour Park", city: "Demo City", country: "Demoland", timezone: "Asia/Kolkata", slug: "harbour-park" }).returning();
const [home, away] = await db.insert(teams).values([
  { name: "Coastal Comets", shortName: "COM", slug: "coastal-comets", kind: "LEAGUE" },
  { name: "Highland Hawks", shortName: "HAW", slug: "highland-hawks", kind: "LEAGUE" },
]).returning();

const FIRST = ["Arjun", "Ben", "Carlos", "Dev", "Ethan", "Faisal", "Gus", "Hari", "Ivan", "Jai", "Kofi", "Liam", "Mo", "Nikhil", "Owen", "Pat", "Quinn", "Ravi", "Sam", "Tom", "Uday", "Vik"];
const LAST = ["Rowe", "Kade", "Moss", "Varma", "Lyle", "Quint", "Bose", "Hart", "Nair", "Cole", "Pike"];
const roles = ["Batter", "Batter", "Batter", "Batter", "Allrounder", "Wicketkeeper", "Allrounder", "Bowler", "Bowler", "Bowler", "Bowler"];
const squadFor = async (team: typeof home, offset: number) => db.insert(players).values(
  roles.map((role, i) => {
    const name = `${FIRST[(i + offset) % FIRST.length]} ${LAST[(i * 3 + offset) % LAST.length]}`;
    return { fullName: name, slug: `${team!.slug}-${name.toLowerCase().replace(/\s+/g, "-")}-${i + 1}`, country: "Demoland", playingRole: role,
      battingStyle: i % 3 === 0 ? "Left-hand bat" : "Right-hand bat", bowlingStyle: i >= 6 ? (i % 2 ? "Right-arm fast" : "Right-arm offbreak") : null };
  })).returning();
const homeXi = await squadFor(home, 0);
const awayXi = await squadFor(away, 11);

const [match] = await db.insert(matches).values({
  seriesId: ser!.id, venueId: venue!.id, team1Id: home!.id, team2Id: away!.id, title: "Coastal Comets vs Highland Hawks, Match 1",
  slug: "coastal-comets-vs-highland-hawks-match-1-demo", format: "T20", oversPerInnings: 20, startsAt: new Date("2026-10-24T14:00:00Z"),
  tossWinnerId: home!.id, tossDecision: "bat",
}).returning();
await db.insert(matchPlayers).values([
  ...homeXi.map((p, i) => ({ matchId: match!.id, playerId: p.id, teamId: home!.id, isPlayingXi: true, battingOrder: i + 1, isCaptain: i === 2, isKeeper: i === 5 })),
  ...awayXi.map((p, i) => ({ matchId: match!.id, playerId: p.id, teamId: away!.id, isPlayingXi: true, battingOrder: i + 1, isCaptain: i === 0, isKeeper: i === 5 })),
]);

const LINES = { 4: ["Driven through the covers for four.", "Pulled hard, one bounce over the rope."], 6: ["Launched over long-on!", "Cleared the ropes with ease."], W: ["Gone! Big wicket.", "Edged and taken."] } as const;

/** Simulates one innings and writes every ball in a single transaction. */
async function playInnings(number: number, bat: typeof homeXi, bowl: typeof awayXi, battingTeamId: string, bowlingTeamId: string, target: number | null) {
  const limits: InningsLimits = { ballsPerOver: 6, maxOvers: 20, target };
  const bowlers = bowl.slice(6); // five specialist bowlers, max 4 overs each
  const delivered: Delivery[] = [];
  let striker = bat[0]!.id, non = bat[1]!.id, nextIn = 2, bowler = bowlers[0]!.id;
  const oversBy = new Map<string, number>();

  return db.transaction(async (tx) => {
    const [inn] = await tx.insert(innings).values({ matchId: match!.id, number, battingTeamId, bowlingTeamId, target }).returning();
    let seq = 0;
    for (;;) {
      const s = computeInnings(delivered, limits);
      if (isInningsComplete(s, limits)) {
        await tx.update(innings).set({ runs: s.runs, wickets: s.wickets, legalBalls: s.legalBalls, extras: s.extras.total, isComplete: true }).where(eq(innings.id, inn!.id));
        return s;
      }
      if (s.next.overComplete) {
        // New over: a bowler with overs left who didn't bowl the previous over.
        const choice = bowlers
          .filter((b) => b.id !== s.next.lastBowlerId && (oversBy.get(b.id) ?? 0) < 4)
          .sort((a, b) => (oversBy.get(a.id) ?? 0) - (oversBy.get(b.id) ?? 0))[0]!;
        bowler = choice.id;
        oversBy.set(bowler, (oversBy.get(bowler) ?? 0) + 1);
      }
      striker = s.next.strikerId ?? striker;
      non = s.next.nonStrikerId ?? non;
      if (!s.next.strikerId && delivered.length) striker = bat[nextIn++]!.id;
      if (!s.next.nonStrikerId && delivered.length) non = bat[nextIn++]!.id;

      const r = rand();
      const d: Delivery = { strikerId: striker, nonStrikerId: non, bowlerId: bowler, runsBat: 0, extraType: null, extraRuns: 0, isBoundary: false, dismissal: null, dismissedPlayerId: null, fielderId: null };
      if (r < 0.015) { d.extraType = "WIDE"; d.extraRuns = 1; }
      else if (r < 0.02) { d.extraType = "NO_BALL"; d.extraRuns = 1; d.runsBat = 1; }
      else if (r < 0.06) { d.dismissal = (["BOWLED", "CAUGHT", "CAUGHT", "LBW", "CAUGHT"] as const)[Math.floor(rand() * 5)]!; if (d.dismissal === "CAUGHT") d.fielderId = bowl[Math.floor(rand() * 11)]!.id; }
      else if (r < 0.38) d.runsBat = 0;
      else if (r < 0.72) d.runsBat = 1;
      else if (r < 0.82) d.runsBat = 2;
      else if (r < 0.84) d.runsBat = 3;
      else if (r < 0.95) { d.runsBat = 4; d.isBoundary = true; }
      else { d.runsBat = 6; d.isBoundary = true; }

      const err = validateDelivery(d, s, limits);
      if (err) throw new Error(`simulation produced invalid ball: ${err}`);
      delivered.push(d);
      seq += 1;
      const legalBefore = s.legalBalls;
      const isLegal = d.extraType !== "WIDE" && d.extraType !== "NO_BALL";
      const [row] = await tx.insert(balls).values({ ...d, inningsId: inn!.id, seq, idempotencyKey: randomUUID(), isLegal,
        overNumber: Math.floor(legalBefore / 6), ballInOver: (legalBefore % 6) + (isLegal ? 1 : 0),
        createdAt: new Date(match!.startsAt.getTime() + (number - 1) * 100 * 60_000 + seq * 40_000) }).returning({ id: balls.id });
      const key = d.dismissal ? "W" : d.isBoundary ? (d.runsBat as 4 | 6) : null;
      if (key && rand() < 0.7) await tx.insert(commentary).values({ matchId: match!.id, ballId: row!.id, text: LINES[key][Math.floor(rand() * 2)]! });
    }
  });
}

const first = await playInnings(1, homeXi, awayXi, home!.id, away!.id, null);
const second = await playInnings(2, awayXi, homeXi, away!.id, home!.id, first.runs + 1);
const chased = second.runs > first.runs;
const resultText = chased
  ? `Highland Hawks won by ${10 - second.wickets} wickets`
  : second.runs === first.runs ? "Match tied" : `Coastal Comets won by ${first.runs - second.runs} runs`;
await db.update(matches).set({ status: "COMPLETED", resultText, winnerId: chased ? away!.id : second.runs === first.runs ? null : home!.id, version: 1 }).where(eq(matches.id, match!.id));
process.stdout.write(`demo match: COM ${first.runs}/${first.wickets} (${first.overs}) vs HAW ${second.runs}/${second.wickets} (${second.overs}): ${resultText}\n`);
await client.end();

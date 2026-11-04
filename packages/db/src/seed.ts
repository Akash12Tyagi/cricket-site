import { config } from "dotenv";
import { createDb, matches, matchPlayers, players, series, teams, venues } from "./index.js";

config({ path: new URL("../../../.env", import.meta.url).pathname });
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed production");

const { db, client } = createDb(process.env.DATABASE_URL ?? "", { max: 1 });

const [ind, aus] = await db.insert(teams).values([
  { name: "India", shortName: "IND", slug: "india", kind: "INTERNATIONAL_MEN" },
  { name: "Australia", shortName: "AUS", slug: "australia", kind: "INTERNATIONAL_MEN" },
]).onConflictDoNothing().returning();

if (!ind || !aus) {
  process.stdout.write("seed already applied\n");
} else {
  const [venue] = await db.insert(venues).values({
    name: "Sample Cricket Ground", city: "Mumbai", country: "India", timezone: "Asia/Kolkata", slug: "sample-cricket-ground",
  }).returning();
  const [ser] = await db.insert(series).values({ name: "Sample T20I Series", season: "2026", slug: "sample-t20i-series-2026" }).returning();
  // Placeholder squads; real data is entered by admins.
  const squad = (team: typeof ind, prefix: string) =>
    Array.from({ length: 11 }, (_, i) => ({ fullName: `${prefix} Player ${i + 1}`, slug: `${team.slug}-player-${i + 1}`, country: team.name }));
  const indPlayers = await db.insert(players).values(squad(ind, "India")).returning();
  const ausPlayers = await db.insert(players).values(squad(aus, "Australia")).returning();
  const [match] = await db.insert(matches).values({
    seriesId: ser!.id, venueId: venue!.id, team1Id: ind.id, team2Id: aus.id,
    title: "India vs Australia, 1st T20I", slug: "india-vs-australia-1st-t20i-sample",
    format: "T20I", oversPerInnings: 20, startsAt: new Date(Date.now() + 2 * 3600_000),
  }).returning();
  await db.insert(matchPlayers).values([
    ...indPlayers.map((p, i) => ({ matchId: match!.id, playerId: p.id, teamId: ind.id, isPlayingXi: true, battingOrder: i + 1, isCaptain: i === 0, isKeeper: i === 4 })),
    ...ausPlayers.map((p, i) => ({ matchId: match!.id, playerId: p.id, teamId: aus.id, isPlayingXi: true, battingOrder: i + 1, isCaptain: i === 0, isKeeper: i === 6 })),
  ]);
  process.stdout.write("seeded: 2 teams, 22 players, 1 venue, 1 series, 1 match\n");
}
await client.end();

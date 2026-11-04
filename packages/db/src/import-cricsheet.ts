// Imports real matches from Cricsheet JSON (https://cricsheet.org, ODC-By 1.0: attribution required, shown on /data).
// Every delivery goes through the same scoring engine as live scoring, so scorecards and career stats are derived
// identically. Idempotent: matches already imported (by Cricsheet id) are skipped.
//
//   pnpm --filter @cricket/db import-cricsheet ../../data/cricsheet/recent30 [--limit=50]
import { config } from "dotenv";
import { and, between, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { computeInnings, type Delivery, type DismissalType, type MatchFormat, type TeamKind } from "@cricket/shared";
import { balls, createDb, innings, matches, matchPlayers, players, series, teams, venues } from "./index.js";

config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

/* ───────────── Cricsheet JSON (v1.x) types: only the fields we use ───────────── */
type CsWicket = { player_out: string; kind: string; fielders?: { name?: string; substitute?: boolean }[] };
type CsDelivery = {
  batter: string; bowler: string; non_striker: string;
  runs: { batter: number; extras: number; total: number; non_boundary?: boolean };
  extras?: { wides?: number; noballs?: number; byes?: number; legbyes?: number; penalty?: number };
  wickets?: CsWicket[];
};
type CsInnings = { team: string; overs?: { over: number; deliveries: CsDelivery[] }[]; super_over?: boolean; declared?: boolean; forfeited?: boolean; target?: { runs?: number; overs?: number } };
type CsMatch = {
  meta: { data_version: string };
  info: {
    match_type: string; team_type: "international" | "club"; gender: "male" | "female"; teams: [string, string]; dates: string[];
    event?: { name: string; match_number?: number; stage?: string; group?: string }; season: string | number;
    overs?: number; balls_per_over?: number; venue?: string; city?: string;
    toss?: { winner: string; decision: "bat" | "field" };
    outcome?: { winner?: string; by?: { runs?: number; wickets?: number; innings?: number }; result?: string; method?: string; eliminator?: string };
    players: Record<string, string[]>;
    registry: { people: Record<string, string> };
  };
  innings: CsInnings[];
};

/* ───────────── Mapping helpers ───────────── */
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 150);
const FORMAT: Record<string, MatchFormat> = { T20: "T20", IT20: "T20I", ODI: "ODI", Test: "TEST", MDM: "FIRST_CLASS", ODM: "LIST_A" };
const DISMISSAL: Record<string, DismissalType> = {
  bowled: "BOWLED", caught: "CAUGHT", "caught and bowled": "CAUGHT", lbw: "LBW", "run out": "RUN_OUT", stumped: "STUMPED",
  "hit wicket": "HIT_WICKET", "handled the ball": "HANDLED_BALL", "hit the ball twice": "HIT_BALL_TWICE", "obstructing the field": "OBSTRUCTING_FIELD", "timed out": "TIMED_OUT",
  "retired hurt": "RETIRED_HURT", "retired not out": "RETIRED_HURT", "retired out": "RETIRED_OUT",
};
const teamKind = (m: CsMatch): TeamKind => m.info.team_type === "club" ? "LEAGUE" : m.info.gender === "female" ? "INTERNATIONAL_WOMEN" : "INTERNATIONAL_MEN";
const shortName = (name: string) => {
  const words = name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean);
  return (words.length >= 2 ? words.map((w) => w[0]).join("") : name.slice(0, 3)).toUpperCase().slice(0, 4);
};
function resultText(m: CsMatch): string | null {
  const o = m.info.outcome;
  if (!o) return null;
  const dls = o.method ? ` (${o.method === "D/L" ? "DLS" : o.method})` : "";
  if (o.winner && o.by) {
    if (o.by.innings && o.by.runs) return `${o.winner} won by an innings and ${o.by.runs} runs`;
    if (o.by.runs != null) return `${o.winner} won by ${o.by.runs} run${o.by.runs === 1 ? "" : "s"}${dls}`;
    if (o.by.wickets != null) return `${o.winner} won by ${o.by.wickets} wicket${o.by.wickets === 1 ? "" : "s"}${dls}`;
  }
  if (o.result === "tie") return o.eliminator ? `Match tied (${o.eliminator} won the Super Over)` : "Match tied";
  if (o.result === "no result") return "No result";
  if (o.result === "draw") return "Match drawn";
  return o.winner ? `${o.winner} won` : null;
}

/** Cricsheet delivery → our Delivery(s). Penalty runs become a separate entry, as in live scoring. */
function toDeliveries(d: CsDelivery, id: (name: string) => string | null, warnings: string[]): Delivery[] {
  const striker = id(d.batter)!, nonStriker = id(d.non_striker)!, bowler = id(d.bowler)!;
  const e = d.extras ?? {};
  let extraType: Delivery["extraType"] = null, extraRuns = 0;
  if (e.wides) { extraType = "WIDE"; extraRuns = e.wides; }
  else if (e.noballs) { extraType = "NO_BALL"; extraRuns = e.noballs + (e.byes ?? 0) + (e.legbyes ?? 0); }
  else if (e.byes) { extraType = "BYE"; extraRuns = e.byes; }
  else if (e.legbyes) { extraType = "LEG_BYE"; extraRuns = e.legbyes; }
  const w = d.wickets?.[0];
  if ((d.wickets?.length ?? 0) > 1) warnings.push(`multiple wickets on one delivery (${d.wickets!.map((x) => x.kind).join(", ")}); kept the first`);
  const kind = w ? DISMISSAL[w.kind] : undefined;
  if (w && !kind) warnings.push(`unknown dismissal "${w.kind}"`);
  const fielderName = w?.kind === "caught and bowled" ? d.bowler : w?.fielders?.[0]?.name;
  const main: Delivery = {
    strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler,
    runsBat: d.runs.batter, extraType, extraRuns,
    isBoundary: (d.runs.batter === 4 || d.runs.batter === 6) && !d.runs.non_boundary,
    dismissal: kind ?? null, dismissedPlayerId: w && kind ? id(w.player_out) : null, fielderId: fielderName ? id(fielderName) : null,
  };
  const out = [main];
  if (e.penalty) out.push({ ...main, runsBat: 0, extraType: "PENALTY", extraRuns: e.penalty, isBoundary: false, dismissal: null, dismissedPlayerId: null, fielderId: null });
  return out;
}

/* ───────────── Import ───────────── */
const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);
const files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => Number(b.slice(0, -5)) - Number(a.slice(0, -5))).slice(0, limit);

const { db, client } = createDb(process.env.DATABASE_URL ?? "", { max: 2 });
const playerIds = new Map<string, string>(); // cricsheet id → our uuid
const cache = { teams: new Map<string, string>(), venues: new Map<string, string>(), series: new Map<string, string>() };
const stats = { imported: 0, skipped: 0, failed: 0, balls: 0, superOversSkipped: 0, upgraded: 0, warnings: new Map<string, number>() };

async function upsertBySlug<T extends { id: string }>(table: typeof teams | typeof venues | typeof series, key: Map<string, string>, slug: string, values: Record<string, unknown>) {
  const hit = key.get(slug);
  if (hit) return hit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.insert(table as any).values({ slug, ...values }).onConflictDoNothing();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [row] = (await db.select({ id: (table as any).id }).from(table as any).where(eq((table as any).slug, slug))) as T[];
  key.set(slug, row!.id);
  return row!.id;
}

async function ensurePlayer(csId: string, name: string, country: string | null) {
  const hit = playerIds.get(csId);
  if (hit) return hit;
  await db.insert(players).values({ fullName: name, slug: `${slugify(name)}-${csId}`, cricsheetId: csId, country }).onConflictDoNothing();
  const [row] = await db.select({ id: players.id }).from(players).where(eq(players.cricsheetId, csId));
  playerIds.set(csId, row!.id);
  return row!.id;
}

for (const file of files) {
  const cricsheetId = basename(file, ".json");
  const [exists] = await db.select({ id: matches.id }).from(matches).where(eq(matches.cricsheetId, cricsheetId)).limit(1);
  if (exists) { stats.skipped++; continue; }
  try {
    const m = JSON.parse(readFileSync(join(dir, file), "utf8")) as CsMatch;
    const i = m.info;
    // Official T20 internationals arrive as match_type "T20" with team_type "international".
    const format = i.match_type === "T20" && i.team_type === "international" ? "T20I" : FORMAT[i.match_type];
    if (!format) { stats.skipped++; continue; }
    const warnings: string[] = [];
    const kind = teamKind(m);
    const [teamA, teamB] = i.teams;
    const teamId = new Map<string, string>();
    for (const t of i.teams) teamId.set(t, await upsertBySlug(teams, cache.teams, slugify(t), { name: t, shortName: shortName(t), kind }));
    const venueId = i.venue ? await upsertBySlug(venues, cache.venues, slugify(i.venue), { name: i.venue, city: i.city ?? null }) : null;
    const seriesId = i.event ? await upsertBySlug(series, cache.series, slugify(`${i.event.name}-${i.season}`), { name: i.event.name, season: String(i.season), startDate: new Date(`${i.dates[0]}T00:00:00Z`) }) : null;

    // Players: everyone in the XIs plus anyone named in a delivery (e.g. substitute fielders).
    const reg = i.registry.people;
    const countryOf = (name: string) => (i.team_type === "international" ? Object.entries(i.players).find(([, l]) => l.includes(name))?.[0] ?? null : null);
    const names = new Set<string>(Object.values(i.players).flat());
    for (const inn of m.innings) for (const o of inn.overs ?? []) for (const d of o.deliveries) {
      [d.batter, d.bowler, d.non_striker, ...(d.wickets ?? []).flatMap((w) => [w.player_out, ...(w.fielders ?? []).map((f) => f.name ?? "")])].forEach((n) => n && names.add(n));
    }
    const idByName = new Map<string, string>();
    for (const n of names) if (reg[n]) idByName.set(n, await ensurePlayer(reg[n], n, countryOf(n)));
    const id = (name: string) => idByName.get(name) ?? null;

    const label = i.event ? (i.event.match_number ? `${i.event.name}, Match ${i.event.match_number}` : i.event.stage ? `${i.event.name}, ${i.event.stage}` : i.event.name) : i.dates[0]!;
    await db.transaction(async (tx) => {
      const values = {
        cricsheetId, seriesId, venueId, team1Id: teamId.get(teamA)!, team2Id: teamId.get(teamB)!,
        title: `${teamA} vs ${teamB}, ${label}`,
        format, status: "COMPLETED" as const, startsAt: new Date(`${i.dates[0]}T00:00:00Z`),
        oversPerInnings: i.overs ?? null, ballsPerOver: i.balls_per_over ?? 6,
        tossWinnerId: i.toss ? teamId.get(i.toss.winner) ?? null : null, tossDecision: i.toss?.decision === "field" ? "bowl" : (i.toss?.decision ?? null),
        resultText: resultText(m), winnerId: i.outcome?.winner ? teamId.get(i.outcome.winner) ?? null : null,
      };
      // Same match already shown from a scorecard-only live feed? Upgrade that row to ball-by-ball, keeping its URL
      // (and the news stories/videos linked to it) instead of creating a duplicate.
      const [t1, t2] = [values.team1Id, values.team2Id];
      const [live] = await tx.select({ id: matches.id }).from(matches).where(and(
        isNotNull(matches.feedProvider), isNull(matches.cricsheetId),
        or(and(eq(matches.team1Id, t1), eq(matches.team2Id, t2)), and(eq(matches.team1Id, t2), eq(matches.team2Id, t1))),
        between(matches.startsAt, new Date(values.startsAt.getTime() - 36 * 3600_000), new Date(values.startsAt.getTime() + 60 * 3600_000)),
      )).limit(1);
      let matchId: string;
      if (live) {
        await tx.delete(innings).where(eq(innings.matchId, live.id));
        await tx.delete(matchPlayers).where(eq(matchPlayers.matchId, live.id));
        await tx.update(matches).set({ ...values, team1Id: t1, team2Id: t2, scorecard: null, feedProvider: null, feedMatchId: null, feedPaused: false, version: sql`${matches.version} + 1` }).where(eq(matches.id, live.id));
        matchId = live.id;
        stats.upgraded++;
      } else {
        const [row] = await tx.insert(matches).values({ ...values, slug: `${slugify(`${teamA}-vs-${teamB}-${label}`)}-${cricsheetId}`, version: 1 }).returning({ id: matches.id });
        matchId = row!.id;
      }

      // Squads, with batting order taken from the order players first came in.
      const order = new Map<string, number>();
      for (const inn of m.innings) for (const o of inn.overs ?? []) for (const d of o.deliveries) for (const n of [d.batter, d.non_striker]) if (!order.has(n)) order.set(n, order.size + 1);
      const squad = Object.entries(i.players).flatMap(([team, list]) => list.filter((n) => id(n)).map((n) => ({
        matchId, playerId: id(n)!, teamId: teamId.get(team)!, isPlayingXi: true, battingOrder: order.get(n) ?? null,
      })));
      if (squad.length) await tx.insert(matchPlayers).values(squad).onConflictDoNothing();

      let number = 0;
      for (const inn of m.innings) {
        if (inn.super_over) { stats.superOversSkipped++; continue; }
        number += 1;
        const battingTeamId = teamId.get(inn.team)!;
        const bowlingTeamId = battingTeamId === teamId.get(teamA) ? teamId.get(teamB)! : teamId.get(teamA)!;
        const list: (Delivery & { overNumber: number; ballInOver: number })[] = [];
        for (const o of inn.overs ?? []) {
          let legalInOver = 0;
          for (const d of o.deliveries) {
            for (const del of toDeliveries(d, id, warnings)) {
              const legal = del.extraType == null || del.extraType === "BYE" || del.extraType === "LEG_BYE";
              if (legal) legalInOver += 1;
              list.push({ ...del, overNumber: o.over, ballInOver: legalInOver });
            }
          }
        }
        const s = computeInnings(list, { ballsPerOver: i.balls_per_over ?? 6, maxOvers: i.overs ?? null });
        const [innRow] = await tx.insert(innings).values({
          matchId, number, battingTeamId, bowlingTeamId, target: inn.target?.runs ?? null, isDeclared: !!inn.declared, isComplete: true,
          runs: s.runs, wickets: s.wickets, legalBalls: s.legalBalls, extras: s.extras.total,
        }).returning({ id: innings.id });
        const rows = list.map((del, k) => ({
          inningsId: innRow!.id, seq: k + 1, overNumber: del.overNumber, ballInOver: del.ballInOver,
          strikerId: del.strikerId, nonStrikerId: del.nonStrikerId, bowlerId: del.bowlerId,
          runsBat: del.runsBat, extraType: del.extraType, extraRuns: del.extraRuns,
          isLegal: del.extraType == null || del.extraType === "BYE" || del.extraType === "LEG_BYE",
          isBoundary: del.isBoundary, dismissal: del.dismissal, dismissedPlayerId: del.dismissedPlayerId, fielderId: del.fielderId,
          idempotencyKey: `cs-${cricsheetId}-${number}-${k + 1}`,
        }));
        for (let k = 0; k < rows.length; k += 1000) await tx.insert(balls).values(rows.slice(k, k + 1000));
        stats.balls += rows.length;
      }
    });
    for (const w of warnings) stats.warnings.set(w, (stats.warnings.get(w) ?? 0) + 1);
    stats.imported++;
    if (stats.imported % 100 === 0) process.stdout.write(`  …${stats.imported} matches\n`);
  } catch (err) {
    stats.failed++;
    process.stderr.write(`failed ${file}: ${(err as Error).message.slice(0, 200)}\n`);
  }
}

process.stdout.write(`imported ${stats.imported} matches (${stats.balls} deliveries), skipped ${stats.skipped}, failed ${stats.failed}, super overs skipped ${stats.superOversSkipped}, live-feed matches upgraded to ball-by-ball ${stats.upgraded}\n`);
for (const [w, n] of stats.warnings) process.stdout.write(`  warning ×${n}: ${w}\n`);
await client.end();

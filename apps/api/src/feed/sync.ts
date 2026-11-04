import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import {
  balls, externalIds, innings, matches, matchPlayers, players, series, teams, venues, type Database,
} from "@cricket/db";
import { computeInnings, isInningsComplete, isLegal, type Delivery } from "@cricket/shared";
import { refreshSnapshot } from "../services/snapshot.js";
import type { FeedBall, FeedFixture } from "./types.js";

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 150);
const DONE = new Set(["COMPLETED", "ABANDONED", "CANCELLED"]);

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Kind = "team" | "player" | "venue" | "series";

export type SyncResult = { matchId: string | null; slug: string | null; changed: boolean; ballsWritten: number; rebuiltInnings: number[]; skipped?: "paused" | "not_linked" };

export async function lookup(db: Database | Tx, provider: string, kind: Kind, extId: string) {
  const [row] = await db.select({ id: externalIds.entityId }).from(externalIds)
    .where(and(eq(externalIds.provider, provider), eq(externalIds.kind, kind), eq(externalIds.externalId, extId))).limit(1);
  return row?.id ?? null;
}
export const remember = (db: Database | Tx, provider: string, kind: Kind, extId: string, entityId: string) =>
  db.insert(externalIds).values({ provider, kind, externalId: extId, entityId }).onConflictDoNothing();

/** Team: known mapping → same-named team we already have (e.g. from Cricsheet) → new team. */
export async function resolveTeam(db: Database, provider: string, t: FeedFixture["teams"][number]) {
  const known = await lookup(db, provider, "team", t.extId);
  if (known) return known;
  const slug = slugify(t.name);
  await db.insert(teams).values({ name: t.name, shortName: t.shortName, slug, kind: t.national ? "INTERNATIONAL_MEN" : "LEAGUE" }).onConflictDoNothing();
  const [row] = await db.select({ id: teams.id }).from(teams).where(eq(teams.slug, slug));
  await remember(db, provider, "team", t.extId, row!.id);
  return row!.id;
}

/**
 * Player: known mapping → exactly one existing player with the same full name (and same date of birth when both
 * are known; this links feed players to their Cricsheet careers) → new player. Ambiguous names never merge.
 */
export async function resolvePlayer(db: Database, provider: string, p: FeedFixture["players"][number]) {
  const known = await lookup(db, provider, "player", p.extId);
  if (known) return known;
  const candidates = await db.select({ id: players.id, dob: players.dateOfBirth }).from(players)
    .where(sql`lower(${players.fullName}) = lower(${p.fullName})`).limit(3);
  const dob = p.dateOfBirth?.slice(0, 10);
  const same = candidates.filter((c) => !dob || !c.dob || c.dob.toISOString().slice(0, 10) === dob);
  let id = same.length === 1 ? same[0]!.id : null;
  if (!id) {
    const [row] = await db.insert(players).values({
      fullName: p.fullName.slice(0, 120), slug: `${slugify(p.fullName)}-${provider.slice(0, 2)}${p.extId}`.slice(0, 140),
      dateOfBirth: dob ? new Date(`${dob}T00:00:00Z`) : null,
      battingStyle: p.battingStyle?.slice(0, 40) ?? null, bowlingStyle: p.bowlingStyle?.slice(0, 60) ?? null, playingRole: p.role?.slice(0, 40) ?? null,
    }).onConflictDoNothing().returning({ id: players.id });
    id = row?.id ?? (await db.select({ id: players.id }).from(players).where(eq(players.slug, `${slugify(p.fullName)}-${provider.slice(0, 2)}${p.extId}`.slice(0, 140))))[0]!.id;
  }
  await remember(db, provider, "player", p.extId, id);
  return id;
}

export async function resolveBySlug(db: Database, provider: string, kind: "venue" | "series", extId: string, slug: string, values: Record<string, unknown>) {
  const known = await lookup(db, provider, kind, extId);
  if (known) return known;
  const table = kind === "venue" ? venues : series;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.insert(table as any).values({ slug, ...values }).onConflictDoNothing();
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.slug, slug));
  await remember(db, provider, kind, extId, row!.id);
  return row!.id;
}

/** Stable fingerprint of a stored/incoming delivery, to detect provider corrections. */
const fingerprint = (b: Pick<Delivery, "strikerId" | "nonStrikerId" | "bowlerId" | "runsBat" | "extraType" | "extraRuns" | "isBoundary" | "dismissal" | "dismissedPlayerId" | "fielderId">) =>
  [b.strikerId, b.nonStrikerId, b.bowlerId, b.runsBat, b.extraType ?? "", b.extraRuns, b.isBoundary ? 1 : 0, b.dismissal ?? "", b.dismissedPlayerId ?? "", b.fielderId ?? ""].join("|");

/**
 * Writes one feed fixture into our tables, idempotently. New deliveries are appended; if the provider corrected
 * an earlier ball (they do: umpire reviews, scorer fixes), that innings is rebuilt from the feed. Every score still
 * comes from the same engine (`computeInnings`) as manual scoring and the Cricsheet import.
 */
export async function syncFixture(db: Database, redis: Redis, f: FeedFixture, opts: { autoCreate: boolean }): Promise<SyncResult> {
  const [existing] = await db.select({ id: matches.id, slug: matches.slug, paused: matches.feedPaused }).from(matches)
    .where(and(eq(matches.feedProvider, f.provider), eq(matches.feedMatchId, f.extId))).limit(1);
  if (existing?.paused) return { matchId: existing.id, slug: existing.slug, changed: false, ballsWritten: 0, rebuiltInnings: [], skipped: "paused" };
  if (!existing && !opts.autoCreate) return { matchId: null, slug: null, changed: false, ballsWritten: 0, rebuiltInnings: [], skipped: "not_linked" };

  // Reference data first (outside the match transaction; each step is idempotent on its own).
  const teamId = new Map<string, string>();
  for (const t of f.teams) teamId.set(t.extId, await resolveTeam(db, f.provider, t));
  const [t1, t2] = f.teams.map((t) => teamId.get(t.extId)!) as [string, string];
  const venueId = f.venue ? await resolveBySlug(db, f.provider, "venue", f.venue.extId, slugify(f.venue.name), { name: f.venue.name.slice(0, 160), city: f.venue.city?.slice(0, 80) ?? null }) : null;
  const seriesId = f.series ? await resolveBySlug(db, f.provider, "series", f.series.extId, slugify(`${f.series.name}-${f.series.season ?? ""}`), { name: f.series.name.slice(0, 160), season: f.series.season?.slice(0, 20) ?? null }) : null;

  // Every player in the lineup or in any delivery, with the team they played for.
  const people = new Map(f.players.map((p) => [p.extId, p]));
  const playerId = new Map<string, string>();
  for (const p of people.values()) playerId.set(p.extId, await resolvePlayer(db, f.provider, p));
  const pid = (ext: string | null) => (ext ? playerId.get(ext) ?? null : null);
  const missing = new Set<string>();
  for (const b of f.balls) for (const x of [b.strikerExtId, b.nonStrikerExtId, b.bowlerExtId]) if (!playerId.has(x)) missing.add(x);
  if (missing.size) f.warnings.push(`${missing.size} player(s) in deliveries without details; those deliveries are skipped`);

  const title = `${f.teams[0].name} vs ${f.teams[1].name}${f.round ? `, ${f.round}` : f.series ? `, ${f.series.name}` : ""}`.slice(0, 160);
  const matchValues = {
    seriesId, venueId, format: f.format, status: f.status, startsAt: f.startsAt, oversPerInnings: f.oversPerInnings,
    tossWinnerId: f.tossWinnerExtId ? teamId.get(f.tossWinnerExtId) ?? null : null, tossDecision: f.tossDecision,
    winnerId: f.winnerExtId ? teamId.get(f.winnerExtId) ?? null : null,
    resultText: DONE.has(f.status) ? f.resultText?.slice(0, 200) ?? null : null,
  };

  const result = await db.transaction(async (tx) => {
    let matchId = existing?.id;
    if (!matchId) {
      const slug = `${slugify(`${f.teams[0].name}-vs-${f.teams[1].name}-${f.round ?? ""}`)}-${f.provider.slice(0, 2)}${f.extId}`.slice(0, 200);
      const [row] = await tx.insert(matches).values({ ...matchValues, team1Id: t1, team2Id: t2, title, slug, feedProvider: f.provider, feedMatchId: f.extId })
        .onConflictDoNothing().returning({ id: matches.id });
      matchId = row?.id ?? (await tx.select({ id: matches.id }).from(matches).where(and(eq(matches.feedProvider, f.provider), eq(matches.feedMatchId, f.extId))))[0]!.id;
    }
    // Lock the match: serialises with manual scoring and with a second worker that lost its leader lock mid-sync.
    const [m] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
    if (m!.feedPaused) return { matchId, slug: m!.slug, changed: false, ballsWritten: 0, rebuiltInnings: [] as number[] };
    let changed = !existing;

    // Squad: lineup players plus anyone who appears in a delivery.
    const squadTeam = new Map<string, string>();
    for (const p of people.values()) if (p.teamExtId && teamId.has(p.teamExtId)) squadTeam.set(playerId.get(p.extId)!, teamId.get(p.teamExtId)!);
    const otherTeam = (ext: string) => (ext === f.teams[0].extId ? t2 : t1);
    for (const b of f.balls) {
      const bat = teamId.get(b.battingTeamExtId);
      if (!bat) continue;
      for (const x of [b.strikerExtId, b.nonStrikerExtId, b.dismissedExtId]) if (pid(x) && !squadTeam.has(pid(x)!)) squadTeam.set(pid(x)!, bat);
      for (const x of [b.bowlerExtId, b.fielderExtId]) if (pid(x) && !squadTeam.has(pid(x)!)) squadTeam.set(pid(x)!, otherTeam(b.battingTeamExtId));
    }
    if (squadTeam.size) {
      const lineup = new Map(f.players.map((p) => [playerId.get(p.extId)!, p]));
      const inserted = await tx.insert(matchPlayers).values([...squadTeam].map(([playerId, teamId]) => ({
        matchId, playerId, teamId, isPlayingXi: true, isCaptain: !!lineup.get(playerId)?.isCaptain, isKeeper: !!lineup.get(playerId)?.isKeeper,
      }))).onConflictDoNothing().returning({ playerId: matchPlayers.playerId });
      if (inserted.length) changed = true;
    }

    // Innings and deliveries.
    const byInnings = new Map<number, FeedBall[]>();
    for (const b of f.balls) if (pid(b.strikerExtId) && pid(b.nonStrikerExtId) && pid(b.bowlerExtId)) byInnings.set(b.inningsNumber, [...(byInnings.get(b.inningsNumber) ?? []), b]);
    const numbers = [...byInnings.keys()].sort((a, b) => a - b);
    const stored = await tx.select().from(innings).where(eq(innings.matchId, matchId)).orderBy(asc(innings.number));
    let ballsWritten = 0;
    const rebuiltInnings: number[] = [];
    let prevRuns: number | null = null;
    for (const n of numbers) {
      const feedBalls = byInnings.get(n)!;
      const battingTeamId = teamId.get(feedBalls[0]!.battingTeamExtId)!;
      const bowlingTeamId = battingTeamId === t1 ? t2 : t1;
      const target: number | null = m!.oversPerInnings != null && n === 2 && prevRuns != null ? prevRuns + 1 : null;
      let inn = stored.find((i) => i.number === n);
      if (!inn) {
        [inn] = await tx.insert(innings).values({ matchId, number: n, battingTeamId, bowlingTeamId, target }).returning();
        changed = true;
      }
      const limits = { ballsPerOver: m!.ballsPerOver, maxOvers: m!.oversPerInnings, target };

      const incoming: (Delivery & { idempotencyKey: string })[] = feedBalls.map((b) => ({
        idempotencyKey: `${f.provider}-${b.extId}`,
        strikerId: pid(b.strikerExtId)!, nonStrikerId: pid(b.nonStrikerExtId)!, bowlerId: pid(b.bowlerExtId)!,
        runsBat: Math.min(12, b.runsBat), extraType: b.extraType, extraRuns: Math.min(12, b.extraRuns), isBoundary: b.isBoundary,
        dismissal: b.dismissal, dismissedPlayerId: pid(b.dismissedExtId), fielderId: pid(b.fielderExtId),
      }));
      const have = await tx.select().from(balls).where(eq(balls.inningsId, inn!.id)).orderBy(asc(balls.seq));
      const isPrefix = have.length <= incoming.length && have.every((h, k) => h.idempotencyKey === incoming[k]!.idempotencyKey && fingerprint(h as Delivery) === fingerprint(incoming[k]!));
      let start = have.length;
      if (!isPrefix) { await tx.delete(balls).where(eq(balls.inningsId, inn!.id)); start = 0; rebuiltInnings.push(n); }
      if (start < incoming.length) {
        // Over/ball numbers are derived from the delivery order, exactly as the scorer endpoint does.
        let legal = 0;
        const rows = incoming.map((d, k) => {
          const overNumber = Math.floor(legal / m!.ballsPerOver);
          if (isLegal(d)) legal += 1;
          const ballInOver = legal - overNumber * m!.ballsPerOver;
          return { ...d, inningsId: inn!.id, seq: k + 1, overNumber, ballInOver, isLegal: isLegal(d) };
        }).slice(start);
        for (let k = 0; k < rows.length; k += 1000) await tx.insert(balls).values(rows.slice(k, k + 1000));
        ballsWritten += rows.length;
        changed = true;
      }
      const s = computeInnings(incoming, limits);
      const complete = n < numbers.at(-1)! || DONE.has(f.status) || isInningsComplete(s, limits);
      if (inn!.runs !== s.runs || inn!.wickets !== s.wickets || inn!.legalBalls !== s.legalBalls || inn!.isComplete !== complete || inn!.target !== target) {
        await tx.update(innings).set({ runs: s.runs, wickets: s.wickets, legalBalls: s.legalBalls, extras: s.extras.total, isComplete: complete, target }).where(eq(innings.id, inn!.id));
        changed = true;
      }
      prevRuns = s.runs;
    }

    const meta = Object.entries(matchValues).some(([k, v]) => {
      const cur = (m as Record<string, unknown>)[k];
      return cur instanceof Date && v instanceof Date ? cur.getTime() !== v.getTime() : (cur ?? null) !== (v ?? null);
    });
    if (meta || changed) {
      await tx.update(matches).set({ ...matchValues, version: sql`${matches.version} + 1`, feedSyncedAt: new Date() }).where(eq(matches.id, matchId));
      changed = true;
    } else {
      await tx.update(matches).set({ feedSyncedAt: new Date() }).where(eq(matches.id, matchId));
    }
    return { matchId, slug: m!.slug, changed, ballsWritten, rebuiltInnings };
  });

  if (result.changed) await refreshSnapshot(db, redis, result.matchId);
  return result;
}

/** Matches linked to a feed that haven't finished yet (polled individually once they drop off the live list). */
export async function openFeedMatches(db: Database, provider: string) {
  return db.select({ id: matches.id, feedMatchId: matches.feedMatchId }).from(matches)
    .where(and(eq(matches.feedProvider, provider), eq(matches.feedPaused, false), inArray(matches.status, ["SCHEDULED", "TOSS", "LIVE", "INNINGS_BREAK", "STUMPS", "DELAYED"])));
}

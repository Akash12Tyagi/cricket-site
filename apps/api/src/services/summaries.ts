import { asc, inArray } from "drizzle-orm";
import { innings, type Database } from "@cricket/db";

export type InningsTotal = { number: number; battingTeamId: string; runs: number; wickets: number; legalBalls: number; target: number | null; isComplete: boolean; isDeclared: boolean };

/** Adds innings totals to match summaries in one query (lists show scores without loading every snapshot). */
export async function withInnings<T extends { id: string }>(db: Database, rows: T[]): Promise<(T & { innings: InningsTotal[] })[]> {
  if (!rows.length) return [];
  const all = await db.select({
    matchId: innings.matchId, number: innings.number, battingTeamId: innings.battingTeamId, runs: innings.runs, wickets: innings.wickets,
    legalBalls: innings.legalBalls, target: innings.target, isComplete: innings.isComplete, isDeclared: innings.isDeclared,
  }).from(innings).where(inArray(innings.matchId, rows.map((r) => r.id))).orderBy(asc(innings.number));
  const by = new Map<string, InningsTotal[]>();
  for (const { matchId, ...i } of all) by.set(matchId, [...(by.get(matchId) ?? []), i]);
  return rows.map((r) => ({ ...r, innings: by.get(r.id) ?? [] }));
}

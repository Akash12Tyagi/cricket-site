import { and, desc, eq, lt, or } from "drizzle-orm";
import { balls, commentary, innings, type Database } from "@cricket/db";
import { ballLabel, type BallEntry, type Delivery } from "@cricket/shared";

/**
 * Ball-by-ball feed, newest first, keyset-paginated on (innings number, seq) so deep pages stay
 * as fast as the first one (no OFFSET scans).
 */
export async function listBalls(db: Database, matchId: string, opts: { limit: number; before?: { inningsNumber: number; seq: number } }): Promise<BallEntry[]> {
  const cursor = opts.before
    ? or(lt(innings.number, opts.before.inningsNumber), and(eq(innings.number, opts.before.inningsNumber), lt(balls.seq, opts.before.seq)))
    : undefined;
  const rows = await db
    .select({ ball: balls, inningsNumber: innings.number, text: commentary.text })
    .from(balls)
    .innerJoin(innings, eq(innings.id, balls.inningsId))
    .leftJoin(commentary, eq(commentary.ballId, balls.id))
    .where(and(eq(innings.matchId, matchId), cursor))
    .orderBy(desc(innings.number), desc(balls.seq))
    .limit(opts.limit);
  return rows.map(({ ball: b, inningsNumber, text }) => ({
    id: b.id,
    inningsNumber,
    seq: b.seq,
    over: `${b.overNumber}.${b.ballInOver}`,
    label: ballLabel(b as Delivery),
    bowlerId: b.bowlerId,
    strikerId: b.strikerId,
    runs: b.runsBat + b.extraRuns,
    isWicket: b.dismissal != null && b.dismissal !== "RETIRED_HURT",
    isBoundary: b.isBoundary,
    text: text ?? null,
    createdAt: b.createdAt.toISOString(),
  }));
}


import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Redis } from "ioredis";
import { matches, teams, type Database } from "@cricket/db";
import type { StoredScorecard } from "@cricket/shared";
import type { HighlightlyClient } from "./highlightly.js";
import { syncHlMatch } from "./scorecard-sync.js";

/**
 * Spends the plan's daily requests where they matter. Fans never trigger requests (they read our cache), so the plan
 * only decides how fresh scores are:
 *   - fixtures for the next two days, twice a day (4 requests);
 *   - while matches are live or about to start: one request lists every match today (scores for all of them), at an
 *     interval that spreads 75 % of what's left over the rest of today's play (not the whole day: see `horizon`);
 *     otherwise every 2 h;
 *   - the rest: full scorecards, once per finished match and periodically for live ones, internationals first.
 * Free plan (100/day) ≈ list every ~15 min; PRO (7,500/day) ≈ every 15 s (HIGHLIGHTLY_MIN_LIST_SECONDS).
 */
const LIVE = ["TOSS", "LIVE", "INNINGS_BREAK", "STUMPS", "DELAYED"] as const;
type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

export function createHighlightlyRunner(deps: {
  db: Database; redis: Redis; client: HighlightlyClient; log: Log;
  autoCreate: boolean; dailyRequests: number; minListSeconds: number;
  onChange: (slug: string) => void; now?: () => Date;
  /** Redis key prefix for this runner's counters and timers (tests use their own). */
  keyPrefix?: string;
}) {
  const P = deps.keyPrefix ?? "hl";
  const { db, redis, client, log } = deps;
  const now = deps.now ?? (() => new Date());
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const plusDays = (d: Date, n: number) => day(new Date(d.getTime() + n * 86_400_000));
  const spentKey = (d: Date) => `${P}:spent:${day(d)}`;
  const t1 = alias(teams, "hl_t1"), t2 = alias(teams, "hl_t2");

  async function spend(d: Date) { await redis.multi().incr(spentKey(d)).expire(spentKey(d), 3 * 86_400).exec().catch(() => undefined); }
  async function remaining(d: Date) {
    const q = client.quota;
    // Trust the provider's own counter when it is from today; otherwise our count.
    if (q.remaining != null && day(new Date(q.at)) === day(d)) return q.remaining;
    return Math.max(0, deps.dailyRequests - Number((await redis.get(spentKey(d)).catch(() => null)) ?? 0));
  }
  const stamp = async (k: string) => redis.set(k, String(Date.now()), "EX", 3 * 86_400).catch(() => undefined);
  const since = async (k: string) => Date.now() - Number((await redis.get(k).catch(() => null)) ?? 0);

  async function syncAll(list: Awaited<ReturnType<HighlightlyClient["matchesOn"]>>) {
    let changed = 0;
    for (const m of list) {
      try {
        const r = await syncHlMatch(db, redis, m, { autoCreate: deps.autoCreate });
        if (r.changed && r.slug) { changed++; deps.onChange(r.slug); }
      } catch (err) { log.warn({ fixture: m.extId, err: (err as Error).message }, "highlightly sync failed for match"); }
    }
    return changed;
  }

  return async function tick() {
    const d = now();
    let left = await remaining(d);
    if (left <= 2) return { skipped: "quota" as const };
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const secondsLeft = Math.max(60, (midnight - d.getTime()) / 1000);
    const stats = { lists: 0, details: 0, changed: 0 };

    // 1. Fixtures: today on start-up, the next two days twice a day.
    if ((await since(`${P}:last:fixtures`)) > 12 * 3600_000) {
      await stamp(`${P}:last:fixtures`);
      for (const date of [day(d), plusDays(d, 1), plusDays(d, 2)]) {
        if (left <= 3) break;
        stats.changed += await syncAll(await client.matchesOn(date)); await spend(d); stats.lists++; left--;
      }
    }

    // 2. Live list: all of today's matches in one request.
    const active = await db.select({ n: sql<number>`count(*)::int` }).from(matches).where(and(
      eq(matches.feedProvider, "highlightly"), eq(matches.feedPaused, false),
      or(inArray(matches.status, [...LIVE]), and(eq(matches.status, "SCHEDULED"), gte(matches.startsAt, new Date(d.getTime() - 3 * 3600_000)), lte(matches.startsAt, new Date(d.getTime() + 15 * 60_000)))),
    ));
    const isActive = (active[0]?.n ?? 0) > 0;
    // How long the budget has to last: until the last of today's scheduled matches should be over (T20 ≈ 4 h, anything
    // longer ≈ 9 h), and at least 6 h while something is in play (multi-day matches have no known end). Spreading
    // the budget over the whole day to midnight would starve the hours when fans are actually watching.
    const [lastEnd] = await db.select({ end: sql<Date | string | null>`max(${matches.startsAt} + case when ${matches.format} in ('TEST','FIRST_CLASS','ODI','LIST_A') then interval '9 hours' else interval '4 hours' end)` })
      .from(matches).where(and(
        eq(matches.feedProvider, "highlightly"), eq(matches.feedPaused, false), inArray(matches.status, ["SCHEDULED", ...LIVE]),
        gte(matches.startsAt, new Date(d.getTime() - 12 * 3600_000)), lte(matches.startsAt, new Date(midnight)),
      ));
    const scheduledEnd = lastEnd?.end ? (new Date(lastEnd.end).getTime() - d.getTime()) / 1000 : 0;
    const liveFloor = isActive ? 6 * 3600 : 0;
    const horizon = Math.min(secondsLeft, Math.max(1800, scheduledEnd, liveFloor));
    const listShare = Math.max(1, Math.floor((left - 3) * 0.75));
    const listEvery = isActive ? Math.max(deps.minListSeconds, horizon / listShare) : 2 * 3600;
    if (left > 3 && (await since(`${P}:last:list`)) > listEvery * 1000) {
      await stamp(`${P}:last:list`);
      stats.changed += await syncAll(await client.matchesOn(day(d))); await spend(d); stats.lists++; left--;
    }

    // 3. Scorecards: one at a time, paced so they use what the remaining list calls today don't need.
    //    Order: finished matches without a full card (once each), then matches in play, then multi-day matches
    //    at stumps/delayed (every 2 h, since they aren't in today's list); internationals first within each group.
    const reserve = Math.ceil(horizon / Math.max(listEvery, 60)) + 2;
    const detailBudget = left - reserve;
    const detailGap = detailBudget > 0 ? Math.max(deps.minListSeconds, horizon / detailBudget) : Infinity;
    if (detailBudget > 0 && (await since(`${P}:last:detail`)) > detailGap * 1000) {
      const rows = await db.select({ id: matches.id, ext: matches.feedMatchId, status: matches.status, card: matches.scorecard, startsAt: matches.startsAt, k1: t1.kind, k2: t2.kind })
        .from(matches).innerJoin(t1, eq(t1.id, matches.team1Id)).innerJoin(t2, eq(t2.id, matches.team2Id))
        .where(and(eq(matches.feedProvider, "highlightly"), eq(matches.feedPaused, false), or(
          and(eq(matches.status, "COMPLETED"), gte(matches.startsAt, new Date(d.getTime() - 3 * 86_400_000))),
          inArray(matches.status, [...LIVE]),
        ))).orderBy(asc(matches.startsAt)).limit(300);
      const full = (c: unknown) => ((c as StoredScorecard | null)?.innings ?? []).some((i) => i.batters.length > 0);
      const intl = (r: (typeof rows)[number]) => (r.k1.startsWith("INTERNATIONAL") && r.k2.startsWith("INTERNATIONAL") ? 0 : 1);
      const byPriority = (a: (typeof rows)[number], b: (typeof rows)[number]) => intl(a) - intl(b) || b.startsAt.getTime() - a.startsAt.getTime();
      const startOfDay = new Date(`${day(d)}T00:00:00Z`);
      let pick: (typeof rows)[number] | undefined;
      for (const r of rows.filter((x) => x.status === "COMPLETED" && !full(x.card)).sort(byPriority)) {
        if (!(await redis.get(`${P}:card:done:${r.ext}`).catch(() => null))) { pick = r; break; }
      }
      if (!pick) for (const r of rows.filter((x) => ["LIVE", "INNINGS_BREAK", "TOSS"].includes(x.status)).sort(byPriority)) {
        if ((await since(`${P}:card:at:${r.ext}`)) > Math.max(deps.minListSeconds * 4, 600) * 1000) { pick = r; break; }
      }
      if (!pick) for (const r of rows.filter((x) => (x.status === "STUMPS" || x.status === "DELAYED") && x.startsAt < startOfDay).sort(byPriority)) {
        if ((await since(`${P}:card:at:${r.ext}`)) > 2 * 3600_000) { pick = r; break; }
      }
      if (pick?.ext) {
        await stamp(`${P}:last:detail`);
        const detail = await client.detail(pick.ext); await spend(d); stats.details++; left--;
        await stamp(`${P}:card:at:${pick.ext}`);
        if (pick.status === "COMPLETED") await redis.set(`${P}:card:done:${pick.ext}`, "1", "EX", 4 * 86_400).catch(() => undefined);
        if (detail) {
          const res = await syncHlMatch(db, redis, detail, { autoCreate: deps.autoCreate });
          if (res.changed && res.slug) { stats.changed++; deps.onChange(res.slug); }
          if (detail.warnings.length) log.warn({ fixture: pick.ext, warnings: [...new Set(detail.warnings)].slice(0, 5) }, "highlightly mapping warnings");
        }
      }
    }
    return { ...stats, left, listEverySeconds: Math.round(listEvery), horizonHours: Math.round((horizon / 3600) * 10) / 10, detailEverySeconds: Number.isFinite(detailGap) ? Math.round(detailGap) : null, active: isActive };
  };
}

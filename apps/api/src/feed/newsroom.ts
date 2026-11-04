import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { articles, articleTags, matches, newsEvents, tags, watchOptions, type Database } from "@cricket/db";
import { formatLabel, LIVE_STATUSES, type LiveSnapshot } from "@cricket/shared";
import { renderArticle } from "../lib/markdown.js";
import { getSnapshot } from "../services/snapshot.js";
import { slugify } from "./sync.js";

/**
 * Automated newsroom. Writes original stories from our own ball-by-ball data the moment something happens:
 * a result, a hundred, a five-wicket haul, and a preview the day before a match. Nothing is copied from other
 * publishers. Every story says it was generated automatically and links to the scorecard it came from.
 * Each event becomes exactly one article (claimed in `news_events`), even across restarts and worker replicas.
 */
export type Story = { key: string; kind: "result" | "milestone" | "preview"; title: string; summary: string; markdown: string; tags: string[] };

const AUTO_NOTE = "\n\n---\n\n*This report was generated automatically from our ball-by-ball data. Corrections: see our [data sources](/data) page.*";
const name = (s: LiveSnapshot, playerId: string) => { const p = s.players.find((x) => x.playerId === playerId); return p?.knownAs ?? p?.name ?? "Unknown"; };
const team = (s: LiveSnapshot, teamId: string) => s.teams.find((t) => t.id === teamId)?.name ?? "Unknown";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const context = (s: LiveSnapshot) => s.match.title.includes(", ") ? s.match.title.slice(s.match.title.indexOf(", ") + 2) : formatLabel(s.match.format);
const where = (s: LiveSnapshot) => (s.venue ? ` at ${s.venue.name}${s.venue.city && !s.venue.name.includes(s.venue.city) ? `, ${s.venue.city}` : ""}` : "");
const scoreOf = (i: LiveSnapshot["innings"][number]) => `${i.runs}${i.wickets < 10 ? `/${i.wickets}` : ""}${i.isDeclared ? "d" : ""}`;
const matchLink = (s: LiveSnapshot, tab = "/scorecard") => `/match/${s.match.slug}${tab}`;
const baseTags = (s: LiveSnapshot) => [...s.teams.map((t) => t.name), formatLabel(s.match.format)];

/** Result report, written once the match is complete. */
export function writeResult(s: LiveSnapshot): Story | null {
  if (s.match.status !== "COMPLETED" || !s.match.resultText || s.innings.length === 0) return null;
  const lines = s.innings.map((i) => {
    const bats = [...i.batters].sort((a, b) => b.runs - a.runs || a.balls - b.balls).slice(0, 2).filter((b) => b.runs > 0)
      .map((b) => `${name(s, b.playerId)} ${b.runs}${b.out ? "" : "*"} (${b.balls})`);
    const best = [...i.bowlers].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
    const bowl = best && best.wickets > 0 ? `; ${name(s, best.playerId)} took ${best.wickets}/${best.runs}` : "";
    return `- **${team(s, i.battingTeamId)}** ${scoreOf(i)} (${i.overs} ov)${bats.length ? `: ${bats.join(", ")}` : ""}${bowl}`;
  });
  const top = s.innings.flatMap((i) => i.batters.map((b) => ({ ...b, inn: i }))).sort((a, b) => b.runs - a.runs)[0];
  const topBowl = s.innings.flatMap((i) => i.bowlers).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
  const stars = [
    top && top.runs >= 30 ? `${name(s, top.playerId)} top-scored with ${top.runs}${top.out ? "" : " not out"} off ${top.balls} balls` : null,
    topBowl && topBowl.wickets >= 3 ? `${name(s, topBowl.playerId)} was the pick of the bowlers with ${topBowl.wickets}/${topBowl.runs}` : null,
  ].filter(Boolean);
  const title = `${s.match.resultText}: ${s.teams[0]!.name} v ${s.teams[1]!.name}, ${context(s)}`.slice(0, 200);
  const lead = `${s.match.resultText} in the ${context(s)}${where(s)} on ${day(s.match.startsAt)}.`;
  return {
    key: `result:${s.match.id}`, kind: "result", title, summary: lead.slice(0, 400),
    markdown: `${lead}${stars.length ? ` ${stars.join(", and ")}.` : ""}\n\n## Scores\n\n${lines.join("\n")}\n\n[Full scorecard](${matchLink(s)}) · [Ball-by-ball commentary](${matchLink(s, "/commentary")})${AUTO_NOTE}`,
    tags: [...baseTags(s), "Match report"],
  };
}

/** Hundreds, double hundreds and five-wicket hauls, published while the match is live. */
export function writeMilestones(s: LiveSnapshot): Story[] {
  if (!LIVE_STATUSES.includes(s.match.status)) return []; // after the match, the result report covers it
  const out: Story[] = [];
  for (const i of s.innings) {
    for (const b of i.batters) {
      for (const mark of [200, 100]) {
        if (b.runs < mark) continue;
        const who = name(s, b.playerId), side = team(s, i.battingTeamId);
        const label = mark === 200 ? "double hundred" : "hundred";
        out.push({
          key: `${mark === 200 ? "double" : "hundred"}:${s.match.id}:${i.number}:${b.playerId}`, kind: "milestone",
          title: `${who} hits ${label} for ${side} against ${team(s, i.bowlingTeamId)}`.slice(0, 200),
          summary: `${who} reached a ${label} for ${side} in the ${context(s)}${where(s)}.`.slice(0, 400),
          markdown: `${who} brought up a ${label} for ${side} in the ${context(s)}${where(s)}. ${b.out ? `${who} was eventually out for ${b.runs}` : `${who} is ${b.runs} not out`} from ${b.balls} balls, with ${b.fours} fours and ${b.sixes} sixes.\n\n${side} ${scoreOf(i)} (${i.overs} ov) at the time of this report.\n\n[Live score](${matchLink(s, "")}) · [Scorecard](${matchLink(s)})${AUTO_NOTE}`,
          tags: [...baseTags(s), who, "Milestone"],
        });
        break; // only the highest mark reached; a hundred story written earlier keeps its own key
      }
    }
    for (const w of i.bowlers) {
      if (w.wickets < 5) continue;
      const who = name(s, w.playerId), side = team(s, i.bowlingTeamId);
      out.push({
        key: `fivefor:${s.match.id}:${i.number}:${w.playerId}`, kind: "milestone",
        title: `${who} takes five wickets for ${side} against ${team(s, i.battingTeamId)}`.slice(0, 200),
        summary: `${who} took ${w.wickets}/${w.runs} in the ${context(s)}.`.slice(0, 400),
        markdown: `${who} took a five-wicket haul for ${side} in the ${context(s)}${where(s)}: ${w.wickets}/${w.runs} from ${Math.floor(w.legalBalls / s.match.ballsPerOver)}.${w.legalBalls % s.match.ballsPerOver} overs.\n\n${team(s, i.battingTeamId)} ${scoreOf(i)} (${i.overs} ov) at the time of this report.\n\n[Live score](${matchLink(s, "")}) · [Scorecard](${matchLink(s)})${AUTO_NOTE}`,
        tags: [...baseTags(s), who, "Milestone"],
      });
    }
  }
  return out;
}

export type PreviewFacts = {
  headToHead: { played: number; wins: Record<string, number> };
  form: Record<string, string>; // team id → e.g. "W L W W N"
  watch: { region: string; name: string }[];
};

/** Preview, published once a match is less than 24 hours away. */
export function writePreview(s: LiveSnapshot, f: PreviewFacts): Story | null {
  if (s.match.status !== "SCHEDULED" && s.match.status !== "TOSS") return null;
  const [a, b] = s.teams as [LiveSnapshot["teams"][number], LiveSnapshot["teams"][number]];
  const h = f.headToHead;
  const h2h = h.played
    ? `In ${formatLabel(s.match.format)} matches in our records, ${a.name} and ${b.name} have met ${h.played} time${h.played === 1 ? "" : "s"}: ${a.name} won ${h.wins[a.id] ?? 0} and ${b.name} won ${h.wins[b.id] ?? 0}.`
    : `This is their first ${formatLabel(s.match.format)} meeting in our records.`;
  const form = s.teams.map((t) => (f.form[t.id] ? `- **${t.name}** last results (newest first): ${f.form[t.id]}` : null)).filter(Boolean);
  const watch = f.watch.length ? `\n\n## Where to watch\n\n${f.watch.map((w) => `- ${w.region === "WW" ? "Worldwide" : w.region}: ${w.name}`).join("\n")}` : "";
  const when = new Date(s.match.startsAt).toUTCString().replace(":00 GMT", " GMT");
  const title = `Preview: ${a.name} v ${b.name}, ${context(s)}`.slice(0, 200);
  return {
    key: `preview:${s.match.id}`, kind: "preview", title,
    summary: `${a.name} meet ${b.name} in the ${context(s)}${where(s)}, starting ${when}.`.slice(0, 400),
    markdown: `${a.name} take on ${b.name} in the ${context(s)}${where(s)}. The match starts at ${when} (your local time is on the [match page](${matchLink(s, "")})).\n\n## Head to head\n\n${h2h}${form.length ? `\n\n## Form\n\n${form.join("\n")}` : ""}${watch}\n\nFollow it [live, ball by ball](${matchLink(s, "")}).${AUTO_NOTE}`,
    tags: [...baseTags(s), "Preview"],
  };
}

async function previewFacts(db: Database, s: LiveSnapshot, matchId: string, seriesId: string | null): Promise<PreviewFacts> {
  const [a, b] = s.teams.map((t) => t.id) as [string, string];
  const between = or(and(eq(matches.team1Id, a), eq(matches.team2Id, b)), and(eq(matches.team1Id, b), eq(matches.team2Id, a)));
  const h2h = await db.select({ winnerId: matches.winnerId, n: sql<number>`count(*)::int` }).from(matches)
    .where(and(between, eq(matches.format, s.match.format), eq(matches.status, "COMPLETED"))).groupBy(matches.winnerId);
  const form: Record<string, string> = {};
  for (const t of [a, b]) {
    const last = await db.select({ winnerId: matches.winnerId }).from(matches)
      .where(and(or(eq(matches.team1Id, t), eq(matches.team2Id, t)), eq(matches.status, "COMPLETED"), eq(matches.format, s.match.format)))
      .orderBy(desc(matches.startsAt)).limit(5);
    if (last.length) form[t] = last.map((m) => (m.winnerId === t ? "W" : m.winnerId ? "L" : "N")).join(" ");
  }
  const watch = await db.select({ region: watchOptions.region, name: watchOptions.name }).from(watchOptions)
    .where(or(eq(watchOptions.matchId, matchId), seriesId ? eq(watchOptions.seriesId, seriesId) : sql`false`)).orderBy(watchOptions.sort, watchOptions.region);
  return {
    headToHead: { played: h2h.reduce((n, r) => n + r.n, 0), wins: Object.fromEntries(h2h.filter((r) => r.winnerId).map((r) => [r.winnerId!, r.n])) },
    form, watch,
  };
}

/** Claims the event, then publishes the article; a second replica racing on the same event writes nothing. */
async function publish(db: Database, matchId: string, story: Story): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx.insert(newsEvents).values({ key: story.key, matchId }).onConflictDoNothing().returning({ key: newsEvents.key });
    if (!claimed) return null;
    const slug = `${slugify(story.title).slice(0, 180)}-${story.key.split(":").slice(1).join("").replace(/-/g, "").slice(0, 10)}`.replace(/-+$/, "");
    const [a] = await tx.insert(articles).values({
      title: story.title, slug, summary: story.summary, bodyMarkdown: story.markdown, bodyHtml: renderArticle(story.markdown), publishedAt: new Date(),
    }).onConflictDoNothing().returning({ id: articles.id, slug: articles.slug });
    if (!a) return null;
    const unique = [...new Map(story.tags.map((t) => [slugify(t), t.slice(0, 80)])).entries()].filter(([s]) => s);
    if (unique.length) {
      await tx.insert(tags).values(unique.map(([slug, name]) => ({ slug, name }))).onConflictDoNothing();
      const rows = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.slug, unique.map(([s]) => s)));
      await tx.insert(articleTags).values(rows.map((r) => ({ articleId: a.id, tagId: r.id }))).onConflictDoNothing();
    }
    await tx.update(newsEvents).set({ articleId: a.id }).where(eq(newsEvents.key, story.key));
    return a.slug;
  });
}

/**
 * One newsroom round: live and just-finished matches (results, milestones) and matches starting within 24 h (previews).
 * Matches only from our own live sources and recent imports: the 8,000-match archive never triggers stories.
 */
export async function newsroomRound(db: Database, redis: Redis, opts: { now?: Date; matchIds?: string[] } = {}) {
  const now = opts.now ?? new Date();
  const candidates = await db.select({ id: matches.id, seriesId: matches.seriesId, status: matches.status }).from(matches).where(and(
    opts.matchIds ? inArray(matches.id, opts.matchIds) : undefined,
    or(
      and(inArray(matches.status, [...LIVE_STATUSES]), gte(matches.startsAt, new Date(now.getTime() - 6 * 86_400_000))),
      and(eq(matches.status, "COMPLETED"), gte(matches.startsAt, new Date(now.getTime() - 3 * 86_400_000))),
      and(inArray(matches.status, ["SCHEDULED", "TOSS"]), gte(matches.startsAt, now), lte(matches.startsAt, new Date(now.getTime() + 86_400_000))),
    ),
  )).limit(200);
  if (!candidates.length) return [];
  const done = new Set((await db.select({ key: newsEvents.key }).from(newsEvents).where(inArray(newsEvents.matchId, candidates.map((c) => c.id)))).map((r) => r.key));
  const published: string[] = [];
  for (const c of candidates) {
    const s = await getSnapshot(db, redis, c.id);
    if (!s) continue;
    const stories: Story[] = [];
    if (s.match.source !== "archive") stories.push(...writeMilestones(s));
    const result = writeResult(s);
    if (result) stories.push(result);
    if (!done.has(`preview:${c.id}`) && (c.status === "SCHEDULED" || c.status === "TOSS")) {
      const p = writePreview(s, await previewFacts(db, s, c.id, c.seriesId));
      if (p) stories.push(p);
    }
    for (const story of stories) {
      if (done.has(story.key)) continue;
      const slug = await publish(db, c.id, story);
      if (slug) published.push(slug);
    }
  }
  return published;
}

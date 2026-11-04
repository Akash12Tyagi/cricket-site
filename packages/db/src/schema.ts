import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";
import { DISMISSAL_TYPES, EXTRA_TYPES, MATCH_FORMATS, MATCH_STATUSES, TEAM_KINDS, USER_ROLES } from "@cricket/shared";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const userRole = pgEnum("user_role", USER_ROLES);
export const matchFormat = pgEnum("match_format", MATCH_FORMATS);
export const matchStatus = pgEnum("match_status", MATCH_STATUSES);
export const extraType = pgEnum("extra_type", EXTRA_TYPES);
export const dismissalType = pgEnum("dismissal_type", DISMISSAL_TYPES);
export const teamKind = pgEnum("team_kind", TEAM_KINDS);

/* ───────────────────────── Accounts & security ───────────────────────── */

export const users = pgTable("users", {
  id: id(),
  // Stored lower-cased; never returned by public APIs.
  email: varchar("email", { length: 254 }).notNull(),
  displayName: varchar("display_name", { length: 80 }),
  role: userRole("role").notNull().default("fan"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

/** Server-side sessions. Only an HMAC of the cookie token is stored, so a DB leak cannot be replayed. */
export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  userAgent: varchar("user_agent", { length: 300 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

/** One-time login codes (passwordless). Only an HMAC of the code is stored. */
export const authCodes = pgTable("auth_codes", {
  id: id(),
  email: varchar("email", { length: 254 }).notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  attempts: smallint("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("auth_codes_email_idx").on(t.email, t.createdAt)]);

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 80 }).notNull(),
  entity: varchar("entity", { length: 40 }).notNull(),
  entityId: uuid("entity_id"),
  // Before/after diff. Must never contain secrets or codes.
  changes: jsonb("changes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_actor_idx").on(t.actorId)]);

/* ───────────────────────── Cricket masters ───────────────────────── */

export const teams = pgTable("teams", {
  id: id(),
  name: varchar("name", { length: 120 }).notNull(),
  shortName: varchar("short_name", { length: 12 }).notNull(),
  slug: varchar("slug", { length: 140 }).notNull(),
  kind: teamKind("kind").notNull(),
  logoUrl: text("logo_url"),
  ...timestamps,
}, (t) => [uniqueIndex("teams_slug_uq").on(t.slug), index("teams_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`)]);

export const players = pgTable("players", {
  id: id(),
  fullName: varchar("full_name", { length: 120 }).notNull(),
  knownAs: varchar("known_as", { length: 80 }),
  slug: varchar("slug", { length: 140 }).notNull(),
  country: varchar("country", { length: 80 }),
  dateOfBirth: timestamp("date_of_birth", { mode: "date" }),
  battingStyle: varchar("batting_style", { length: 40 }),
  bowlingStyle: varchar("bowling_style", { length: 60 }),
  playingRole: varchar("playing_role", { length: 40 }),
  imageUrl: text("image_url"),
  birthPlace: varchar("birth_place", { length: 120 }),
  heightCm: smallint("height_cm"),
  /** External identifiers (Cricsheet register; ESPNcricinfo/Wikidata keys used only for enrichment matching). */
  cricsheetId: varchar("cricsheet_id", { length: 16 }),
  wikidataId: varchar("wikidata_id", { length: 16 }),
  ...timestamps,
}, (t) => [uniqueIndex("players_slug_uq").on(t.slug), uniqueIndex("players_cricsheet_uq").on(t.cricsheetId), index("players_name_trgm").using("gin", sql`${t.fullName} gin_trgm_ops`)]);

export const venues = pgTable("venues", {
  id: id(),
  name: varchar("name", { length: 160 }).notNull(),
  city: varchar("city", { length: 80 }),
  country: varchar("country", { length: 80 }),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  slug: varchar("slug", { length: 180 }).notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("venues_slug_uq").on(t.slug)]);

export const series = pgTable("series", {
  id: id(),
  name: varchar("name", { length: 160 }).notNull(),
  season: varchar("season", { length: 20 }),
  slug: varchar("slug", { length: 180 }).notNull(),
  startDate: timestamp("start_date", { mode: "date" }),
  endDate: timestamp("end_date", { mode: "date" }),
  ...timestamps,
}, (t) => [uniqueIndex("series_slug_uq").on(t.slug), index("series_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`)]);

/* ───────────────────────── Matches & scoring ───────────────────────── */

export const matches = pgTable("matches", {
  id: id(),
  seriesId: uuid("series_id").references(() => series.id, { onDelete: "set null" }),
  venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
  team1Id: uuid("team1_id").notNull().references(() => teams.id),
  team2Id: uuid("team2_id").notNull().references(() => teams.id),
  title: varchar("title", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 200 }).notNull(),
  format: matchFormat("format").notNull(),
  status: matchStatus("status").notNull().default("SCHEDULED"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  oversPerInnings: smallint("overs_per_innings"),
  ballsPerOver: smallint("balls_per_over").notNull().default(6),
  tossWinnerId: uuid("toss_winner_id").references(() => teams.id),
  tossDecision: varchar("toss_decision", { length: 8 }),
  resultText: varchar("result_text", { length: 200 }),
  winnerId: uuid("winner_id").references(() => teams.id),
  /** Bumped on every scoring change; used for ETags and cache-busting. */
  version: integer("version").notNull().default(0),
  /** Set for matches imported from Cricsheet (makes the import idempotent). */
  cricsheetId: varchar("cricsheet_id", { length: 24 }),
  /**
   * Licensed live-score feed this match is synced from (e.g. "sportmonks" + its fixture id). While set and not
   * paused, the feed worker owns the ball log and manual scoring is refused, so the two can never interleave.
   */
  feedProvider: varchar("feed_provider", { length: 20 }),
  feedMatchId: varchar("feed_match_id", { length: 40 }),
  feedPaused: boolean("feed_paused").notNull().default(false),
  feedSyncedAt: timestamp("feed_synced_at", { withTimezone: true }),
  /**
   * Scorecard-only feeds (e.g. Highlightly) send batting/bowling cards, not deliveries. Stored here in our own
   * innings shape and used by the live snapshot when the match has no ball log. Cleared if ball-by-ball data arrives.
   */
  scorecard: jsonb("scorecard"),
  ...timestamps,
}, (t) => [
  uniqueIndex("matches_slug_uq").on(t.slug),
  uniqueIndex("matches_cricsheet_uq").on(t.cricsheetId),
  uniqueIndex("matches_feed_uq").on(t.feedProvider, t.feedMatchId),
  index("matches_status_start_idx").on(t.status, t.startsAt),
  index("matches_series_idx").on(t.seriesId),
  check("matches_distinct_teams", sql`${t.team1Id} <> ${t.team2Id}`),
]);

/** Squad / playing XI per match. */
export const matchPlayers = pgTable("match_players", {
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  isPlayingXi: boolean("is_playing_xi").notNull().default(false),
  isCaptain: boolean("is_captain").notNull().default(false),
  isKeeper: boolean("is_keeper").notNull().default(false),
  battingOrder: smallint("batting_order"),
}, (t) => [primaryKey({ columns: [t.matchId, t.playerId] }), index("match_players_player_idx").on(t.playerId)]);

export const innings = pgTable("innings", {
  id: id(),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  number: smallint("number").notNull(),
  battingTeamId: uuid("batting_team_id").notNull().references(() => teams.id),
  bowlingTeamId: uuid("bowling_team_id").notNull().references(() => teams.id),
  // Running totals, maintained in the same transaction as each ball (always re-derivable from `balls`).
  runs: integer("runs").notNull().default(0),
  wickets: smallint("wickets").notNull().default(0),
  legalBalls: integer("legal_balls").notNull().default(0),
  extras: integer("extras").notNull().default(0),
  target: integer("target"),
  isDeclared: boolean("is_declared").notNull().default(false),
  isFollowOn: boolean("is_follow_on").notNull().default(false),
  isComplete: boolean("is_complete").notNull().default(false),
  ...timestamps,
}, (t) => [uniqueIndex("innings_match_number_uq").on(t.matchId, t.number)]);

/** One row per delivery: the single source of truth for every score on the site. */
export const balls = pgTable("balls", {
  id: id(),
  inningsId: uuid("innings_id").notNull().references(() => innings.id, { onDelete: "cascade" }),
  /** Monotonic order within the innings (includes wides/no-balls). */
  seq: integer("seq").notNull(),
  overNumber: smallint("over_number").notNull(),
  ballInOver: smallint("ball_in_over").notNull(),
  strikerId: uuid("striker_id").notNull().references(() => players.id),
  nonStrikerId: uuid("non_striker_id").notNull().references(() => players.id),
  bowlerId: uuid("bowler_id").notNull().references(() => players.id),
  runsBat: smallint("runs_bat").notNull().default(0),
  extraType: extraType("extra_type"),
  extraRuns: smallint("extra_runs").notNull().default(0),
  isLegal: boolean("is_legal").notNull().default(true),
  isBoundary: boolean("is_boundary").notNull().default(false),
  dismissal: dismissalType("dismissal"),
  dismissedPlayerId: uuid("dismissed_player_id").references(() => players.id),
  fielderId: uuid("fielder_id").references(() => players.id),
  /** Client-generated key so a retried/double-clicked submit never creates two balls (plan §4.3). */
  idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("balls_innings_seq_uq").on(t.inningsId, t.seq),
  uniqueIndex("balls_idempotency_uq").on(t.idempotencyKey),
  // Player-profile aggregates filter by these; without indexes they scan every ball ever bowled.
  index("balls_striker_idx").on(t.strikerId),
  index("balls_non_striker_idx").on(t.nonStrikerId),
  index("balls_bowler_idx").on(t.bowlerId),
  // Every foreign key needs an index: without them, deleting a player/user scans all ~4M deliveries.
  index("balls_dismissed_idx").on(t.dismissedPlayerId),
  index("balls_fielder_idx").on(t.fielderId),
  index("balls_created_by_idx").on(t.createdBy),
  check("balls_runs_range", sql`${t.runsBat} between 0 and 12 and ${t.extraRuns} between 0 and 12`),
]);

export const commentary = pgTable("commentary", {
  id: id(),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  ballId: uuid("ball_id").references(() => balls.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  ...timestamps,
}, (t) => [index("commentary_match_idx").on(t.matchId, t.createdAt), index("commentary_ball_idx").on(t.ballId)]);

/* ───────────────────────── Content & fans ───────────────────────── */

export const articles = pgTable("articles", {
  id: id(),
  title: varchar("title", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 220 }).notNull(),
  summary: varchar("summary", { length: 400 }),
  /** What editors write. */
  bodyMarkdown: text("body_markdown").notNull().default(""),
  /** Rendered from Markdown and sanitised on the server at save time; the only form ever sent to browsers. */
  bodyHtml: text("body_html").notNull(),
  heroImageUrl: text("hero_image_url"),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  uniqueIndex("articles_slug_uq").on(t.slug),
  index("articles_published_idx").on(t.publishedAt),
  index("articles_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
]);

export const tags = pgTable("tags", {
  id: id(),
  name: varchar("name", { length: 80 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").references(() => players.id, { onDelete: "cascade" }),
  seriesId: uuid("series_id").references(() => series.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("tags_slug_uq").on(t.slug)]);

export const articleTags = pgTable("article_tags", {
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.articleId, t.tagId] })]);

export const userFollows = pgTable("user_follows", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").references(() => players.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_follows_team_uq").on(t.userId, t.teamId).where(sql`${t.teamId} is not null`),
  uniqueIndex("user_follows_player_uq").on(t.userId, t.playerId).where(sql`${t.playerId} is not null`),
  check("user_follows_one_target", sql`(${t.teamId} is null) <> (${t.playerId} is null)`),
]);

/* ───────────────────────── Live feed, broadcast links & video ───────────────────────── */

/** Maps a licensed data provider's ids (teams, players, venues, series) to ours, so re-syncs never duplicate rows. */
export const externalIds = pgTable("external_ids", {
  provider: varchar("provider", { length: 20 }).notNull(),
  kind: varchar("kind", { length: 12 }).notNull(),
  externalId: varchar("external_id", { length: 40 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.provider, t.kind, t.externalId] }), index("external_ids_entity_idx").on(t.entityId)]);

/**
 * "Where to watch": links to the official rights holder per region (e.g. JioHotstar in India). We only link out;
 * no video is hosted or re-streamed. Attached to one match or to a whole series.
 */
export const watchOptions = pgTable("watch_options", {
  id: id(),
  matchId: uuid("match_id").references(() => matches.id, { onDelete: "cascade" }),
  seriesId: uuid("series_id").references(() => series.id, { onDelete: "cascade" }),
  /** ISO 3166-1 alpha-2 country code, or "WW" for worldwide. */
  region: varchar("region", { length: 2 }).notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  url: text("url").notNull(),
  kind: varchar("kind", { length: 8 }).notNull().default("stream"),
  note: varchar("note", { length: 160 }),
  sort: smallint("sort").notNull().default(0),
  ...timestamps,
}, (t) => [
  index("watch_options_match_idx").on(t.matchId),
  index("watch_options_series_idx").on(t.seriesId),
  check("watch_options_one_target", sql`(${t.matchId} is null) <> (${t.seriesId} is null)`),
  check("watch_options_https", sql`${t.url} like 'https://%'`),
]);

/** Official YouTube channels whose uploads we list (boards, ICC). Only these are fetched automatically. */
export const videoChannels = pgTable("video_channels", {
  channelId: varchar("channel_id", { length: 24 }).primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  /** YouTube Data API back-catalogue import: the channel's uploads playlist and where the import has got to. */
  uploadsPlaylistId: varchar("uploads_playlist_id", { length: 40 }),
  backfillPageToken: varchar("backfill_page_token", { length: 120 }),
  backfillDone: boolean("backfill_done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Official YouTube videos (highlights, live streams published by the rights holder), embedded via YouTube's player. */
export const videos = pgTable("videos", {
  id: id(),
  youtubeId: varchar("youtube_id", { length: 11 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  channelId: varchar("channel_id", { length: 24 }),
  channelName: varchar("channel_name", { length: 80 }),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  isShort: boolean("is_short").notNull().default(false),
  isLive: boolean("is_live").notNull().default(false),
  /** YouTube's oEmbed check: the owner allows embedding. Non-embeddable videos are never shown in our player. */
  embeddable: boolean("embeddable").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  matchId: uuid("match_id").references(() => matches.id, { onDelete: "set null" }),
  seriesId: uuid("series_id").references(() => series.id, { onDelete: "set null" }),
  source: varchar("source", { length: 8 }).notNull().default("channel"),
  /**
   * From the YouTube Data API. YouTube's developer policies allow storing these statistics for at most 30 days, so
   * the worker refreshes them and clears any it couldn't refresh in time (viewCount back to null = "not shown").
   */
  viewCount: bigint("view_count", { mode: "number" }),
  durationSeconds: integer("duration_seconds"),
  statsFetchedAt: timestamp("stats_fetched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("videos_youtube_uq").on(t.youtubeId),
  index("videos_views_idx").on(t.viewCount),
  index("videos_stats_idx").on(t.statsFetchedAt),
  index("videos_match_idx").on(t.matchId, t.publishedAt),
  index("videos_series_idx").on(t.seriesId),
  index("videos_published_idx").on(t.publishedAt),
  check("videos_youtube_id_format", sql`${t.youtubeId} ~ '^[A-Za-z0-9_-]{11}$'`),
]);

/**
 * The automated newsroom's memory: one row per story event it has written ("result:<match>", "hundred:<match>:<inn>:<player>"),
 * so every event becomes exactly one article even with several worker replicas or restarts.
 */
export const newsEvents = pgTable("news_events", {
  key: varchar("key", { length: 160 }).primaryKey(),
  matchId: uuid("match_id").references(() => matches.id, { onDelete: "cascade" }),
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("news_events_match_idx").on(t.matchId), index("news_events_article_idx").on(t.articleId)]);

/**
 * Authorised playback sources for a match (or a whole series): the data behind the Watch tab. We only ever list a
 * source an operator has recorded a right to use (`rightsNote`): an official board/broadcaster stream we may embed,
 * or a licensed HLS feed. Nothing here is scraped, and DRM-protected or session-bound streams have no place in it.
 *   youtube = an official YouTube live stream/video that allows embedding;
 *   hls     = a licensed HLS (.m3u8) feed on a host in STREAM_HLS_HOSTS, played in our own player;
 *   embed   = a provider-approved iframe player on a host in STREAM_EMBED_HOSTS.
 * `lastStatus` is the worker's verdict, and only "live" may be shown as live (see api/src/streams).
 */
export const streamSources = pgTable("stream_sources", {
  id: id(),
  matchId: uuid("match_id").references(() => matches.id, { onDelete: "cascade" }),
  seriesId: uuid("series_id").references(() => series.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 8 }).notNull(),
  label: varchar("label", { length: 60 }).notNull(),
  url: text("url").notNull(),
  /** Territory the rights holder allows: ISO 3166-1 alpha-2, or "WW". Display/ordering only; the provider enforces it. */
  region: varchar("region", { length: 2 }).notNull().default("WW"),
  priority: smallint("priority").notNull().default(0),
  /** Who authorised this stream and on what basis (contract, board permission, public embed terms). Required. */
  rightsNote: varchar("rights_note", { length: 300 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** Name of a server environment variable (STREAM_TOKEN_*) holding an access token appended at playback time. Never the token itself. */
  authEnv: varchar("auth_env", { length: 40 }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  /** live (verified) | vod (playable, not live) | unknown (reachable, liveness unproven) | offline | error */
  lastStatus: varchar("last_status", { length: 8 }),
  lastDetail: varchar("last_detail", { length: 160 }),
  checkState: jsonb("check_state"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [
  index("stream_sources_match_idx").on(t.matchId),
  index("stream_sources_series_idx").on(t.seriesId),
  index("stream_sources_created_by_idx").on(t.createdBy),
  check("stream_sources_one_target", sql`(${t.matchId} is null) <> (${t.seriesId} is null)`),
  check("stream_sources_https", sql`${t.url} like 'https://%'`),
  check("stream_sources_kind", sql`${t.kind} in ('youtube', 'hls', 'embed')`),
]);

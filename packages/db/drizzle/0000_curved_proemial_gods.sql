CREATE TYPE "public"."dismissal_type" AS ENUM('BOWLED', 'CAUGHT', 'LBW', 'RUN_OUT', 'STUMPED', 'HIT_WICKET', 'HANDLED_BALL', 'OBSTRUCTING_FIELD', 'TIMED_OUT', 'RETIRED_HURT', 'RETIRED_OUT');--> statement-breakpoint
CREATE TYPE "public"."extra_type" AS ENUM('WIDE', 'NO_BALL', 'BYE', 'LEG_BYE', 'PENALTY');--> statement-breakpoint
CREATE TYPE "public"."match_format" AS ENUM('TEST', 'ODI', 'T20I', 'T20', 'LIST_A', 'FIRST_CLASS', 'T10', 'HUNDRED');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('SCHEDULED', 'TOSS', 'LIVE', 'INNINGS_BREAK', 'STUMPS', 'DELAYED', 'COMPLETED', 'ABANDONED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."team_kind" AS ENUM('INTERNATIONAL_MEN', 'INTERNATIONAL_WOMEN', 'LEAGUE', 'DOMESTIC');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('fan', 'scorer', 'editor', 'admin');--> statement-breakpoint
CREATE TABLE "article_tags" (
	"article_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "article_tags_article_id_tag_id_pk" PRIMARY KEY("article_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"slug" varchar(220) NOT NULL,
	"summary" varchar(400),
	"body_html" text NOT NULL,
	"hero_image_url" text,
	"author_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(80) NOT NULL,
	"entity" varchar(40) NOT NULL,
	"entity_id" uuid,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"innings_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"over_number" smallint NOT NULL,
	"ball_in_over" smallint NOT NULL,
	"striker_id" uuid NOT NULL,
	"non_striker_id" uuid NOT NULL,
	"bowler_id" uuid NOT NULL,
	"runs_bat" smallint DEFAULT 0 NOT NULL,
	"extra_type" "extra_type",
	"extra_runs" smallint DEFAULT 0 NOT NULL,
	"is_legal" boolean DEFAULT true NOT NULL,
	"is_boundary" boolean DEFAULT false NOT NULL,
	"dismissal" "dismissal_type",
	"dismissed_player_id" uuid,
	"fielder_id" uuid,
	"idempotency_key" varchar(64) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balls_runs_range" CHECK ("balls"."runs_bat" between 0 and 7 and "balls"."extra_runs" between 0 and 7)
);
--> statement-breakpoint
CREATE TABLE "commentary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"ball_id" uuid,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "innings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"batting_team_id" uuid NOT NULL,
	"bowling_team_id" uuid NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"wickets" smallint DEFAULT 0 NOT NULL,
	"legal_balls" integer DEFAULT 0 NOT NULL,
	"extras" integer DEFAULT 0 NOT NULL,
	"target" integer,
	"is_declared" boolean DEFAULT false NOT NULL,
	"is_follow_on" boolean DEFAULT false NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"is_playing_xi" boolean DEFAULT false NOT NULL,
	"is_captain" boolean DEFAULT false NOT NULL,
	"is_keeper" boolean DEFAULT false NOT NULL,
	"batting_order" smallint,
	CONSTRAINT "match_players_match_id_player_id_pk" PRIMARY KEY("match_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid,
	"venue_id" uuid,
	"team1_id" uuid NOT NULL,
	"team2_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"slug" varchar(200) NOT NULL,
	"format" "match_format" NOT NULL,
	"status" "match_status" DEFAULT 'SCHEDULED' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"overs_per_innings" smallint,
	"balls_per_over" smallint DEFAULT 6 NOT NULL,
	"toss_winner_id" uuid,
	"toss_decision" varchar(8),
	"result_text" varchar(200),
	"winner_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_distinct_teams" CHECK ("matches"."team1_id" <> "matches"."team2_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"known_as" varchar(80),
	"slug" varchar(140) NOT NULL,
	"country" varchar(80),
	"date_of_birth" timestamp,
	"batting_style" varchar(40),
	"bowling_style" varchar(60),
	"playing_role" varchar(40),
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"season" varchar(20),
	"slug" varchar(180) NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"team_id" uuid,
	"player_id" uuid,
	"series_id" uuid
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"short_name" varchar(12) NOT NULL,
	"slug" varchar(140) NOT NULL,
	"kind" "team_kind" NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"user_id" uuid NOT NULL,
	"team_id" uuid,
	"player_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_one_target" CHECK (("user_follows"."team_id" is null) <> ("user_follows"."player_id" is null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"display_name" varchar(80),
	"role" "user_role" DEFAULT 'fan' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"city" varchar(80),
	"country" varchar(80),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"slug" varchar(180) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balls" ADD CONSTRAINT "balls_innings_id_innings_id_fk" FOREIGN KEY ("innings_id") REFERENCES "public"."innings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balls" ADD CONSTRAINT "balls_striker_id_players_id_fk" FOREIGN KEY ("striker_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balls" ADD CONSTRAINT "balls_non_striker_id_players_id_fk" FOREIGN KEY ("non_striker_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balls" ADD CONSTRAINT "balls_bowler_id_players_id_fk" FOREIGN KEY ("bowler_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balls" ADD CONSTRAINT "balls_dismissed_player_id_players_id_fk" FOREIGN KEY ("dismissed_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balls" ADD CONSTRAINT "balls_fielder_id_players_id_fk" FOREIGN KEY ("fielder_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balls" ADD CONSTRAINT "balls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commentary" ADD CONSTRAINT "commentary_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commentary" ADD CONSTRAINT "commentary_ball_id_balls_id_fk" FOREIGN KEY ("ball_id") REFERENCES "public"."balls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "innings" ADD CONSTRAINT "innings_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "innings" ADD CONSTRAINT "innings_batting_team_id_teams_id_fk" FOREIGN KEY ("batting_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "innings" ADD CONSTRAINT "innings_bowling_team_id_teams_id_fk" FOREIGN KEY ("bowling_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team1_id_teams_id_fk" FOREIGN KEY ("team1_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team2_id_teams_id_fk" FOREIGN KEY ("team2_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_toss_winner_id_teams_id_fk" FOREIGN KEY ("toss_winner_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_id_teams_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_slug_uq" ON "articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "articles_published_idx" ON "articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "auth_codes_email_idx" ON "auth_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "balls_innings_seq_uq" ON "balls" USING btree ("innings_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "balls_idempotency_uq" ON "balls" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "commentary_match_idx" ON "commentary" USING btree ("match_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "innings_match_number_uq" ON "innings" USING btree ("match_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_slug_uq" ON "matches" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "matches_status_start_idx" ON "matches" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "matches_series_idx" ON "matches" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_slug_uq" ON "players" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "series_slug_uq" ON "series" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_uq" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_uq" ON "teams" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_follows_team_uq" ON "user_follows" USING btree ("user_id","team_id") WHERE "user_follows"."team_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_follows_player_uq" ON "user_follows" USING btree ("user_id","player_id") WHERE "user_follows"."player_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_slug_uq" ON "venues" USING btree ("slug");
CREATE TABLE "external_ids" (
	"provider" varchar(20) NOT NULL,
	"kind" varchar(12) NOT NULL,
	"external_id" varchar(40) NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_ids_provider_kind_external_id_pk" PRIMARY KEY("provider","kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "video_channels" (
	"channel_id" varchar(24) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_id" varchar(11) NOT NULL,
	"title" varchar(200) NOT NULL,
	"channel_id" varchar(24),
	"channel_name" varchar(80),
	"published_at" timestamp with time zone NOT NULL,
	"is_short" boolean DEFAULT false NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"embeddable" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"match_id" uuid,
	"series_id" uuid,
	"source" varchar(8) DEFAULT 'channel' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_youtube_id_format" CHECK ("videos"."youtube_id" ~ '^[A-Za-z0-9_-]{11}$')
);
--> statement-breakpoint
CREATE TABLE "watch_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid,
	"series_id" uuid,
	"region" varchar(2) NOT NULL,
	"name" varchar(80) NOT NULL,
	"url" text NOT NULL,
	"kind" varchar(8) DEFAULT 'stream' NOT NULL,
	"note" varchar(160),
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_options_one_target" CHECK (("watch_options"."match_id" is null) <> ("watch_options"."series_id" is null)),
	CONSTRAINT "watch_options_https" CHECK ("watch_options"."url" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "feed_provider" varchar(20);--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "feed_match_id" varchar(40);--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "feed_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "feed_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_options" ADD CONSTRAINT "watch_options_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_options" ADD CONSTRAINT "watch_options_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_ids_entity_idx" ON "external_ids" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_youtube_uq" ON "videos" USING btree ("youtube_id");--> statement-breakpoint
CREATE INDEX "videos_match_idx" ON "videos" USING btree ("match_id","published_at");--> statement-breakpoint
CREATE INDEX "videos_series_idx" ON "videos" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "videos_published_idx" ON "videos" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "watch_options_match_idx" ON "watch_options" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "watch_options_series_idx" ON "watch_options" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_feed_uq" ON "matches" USING btree ("feed_provider","feed_match_id");--> statement-breakpoint
-- Official channels verified on 2026-10-27 (handle → channel id → feed title). Admins can add/disable more.
INSERT INTO "video_channels" ("channel_id", "name") VALUES
  ('UCt2JXOLNxqry7B_4rRZME3Q', 'ICC'),
  ('UC2MHTOXktfTK26aDKyQs3cQ', 'Windies Cricket'),
  ('UC1xHJoiSXk4JGRlSG1XrjYg', 'Proteas Cricket'),
  ('UCkBY0aHJP9BwjZLDYxAQrKg', 'cricket.com.au'),
  ('UCJA-NQ4MtcRIog66wziD8fA', 'Sri Lanka Cricket'),
  ('UCdFZnFf0nGeync5_gLJvcfg', 'Afghanistan Cricket Board'),
  ('UCxW_kE15S9x9q-mCkmUG4FQ', 'Cricket Ireland')
ON CONFLICT DO NOTHING;

CREATE TABLE "stream_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid,
	"series_id" uuid,
	"kind" varchar(8) NOT NULL,
	"label" varchar(60) NOT NULL,
	"url" text NOT NULL,
	"region" varchar(2) DEFAULT 'WW' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"rights_note" varchar(300) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auth_env" varchar(40),
	"last_checked_at" timestamp with time zone,
	"last_status" varchar(8),
	"last_detail" varchar(160),
	"check_state" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stream_sources_one_target" CHECK (("stream_sources"."match_id" is null) <> ("stream_sources"."series_id" is null)),
	CONSTRAINT "stream_sources_https" CHECK ("stream_sources"."url" like 'https://%'),
	CONSTRAINT "stream_sources_kind" CHECK ("stream_sources"."kind" in ('youtube', 'hls', 'embed'))
);
--> statement-breakpoint
ALTER TABLE "stream_sources" ADD CONSTRAINT "stream_sources_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_sources" ADD CONSTRAINT "stream_sources_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_sources" ADD CONSTRAINT "stream_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stream_sources_match_idx" ON "stream_sources" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "stream_sources_series_idx" ON "stream_sources" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "stream_sources_created_by_idx" ON "stream_sources" USING btree ("created_by");
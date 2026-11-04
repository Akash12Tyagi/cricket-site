ALTER TABLE "video_channels" ADD COLUMN "uploads_playlist_id" varchar(40);--> statement-breakpoint
ALTER TABLE "video_channels" ADD COLUMN "backfill_page_token" varchar(120);--> statement-breakpoint
ALTER TABLE "video_channels" ADD COLUMN "backfill_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "view_count" bigint;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "stats_fetched_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "videos_views_idx" ON "videos" USING btree ("view_count");--> statement-breakpoint
CREATE INDEX "videos_stats_idx" ON "videos" USING btree ("stats_fetched_at");
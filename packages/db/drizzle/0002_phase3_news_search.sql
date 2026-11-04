ALTER TABLE "articles" ADD COLUMN "body_markdown" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "articles_title_trgm" ON "articles" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "players_name_trgm" ON "players" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "series_name_trgm" ON "series" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "teams_name_trgm" ON "teams" USING gin ("name" gin_trgm_ops);
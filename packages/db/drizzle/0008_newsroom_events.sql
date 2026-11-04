CREATE TABLE "news_events" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"match_id" uuid,
	"article_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_events_match_idx" ON "news_events" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "news_events_article_idx" ON "news_events" USING btree ("article_id");
ALTER TABLE "matches" ADD COLUMN "cricsheet_id" varchar(24);--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "birth_place" varchar(120);--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "height_cm" smallint;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "cricsheet_id" varchar(16);--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "wikidata_id" varchar(16);--> statement-breakpoint
CREATE INDEX "balls_striker_idx" ON "balls" USING btree ("striker_id");--> statement-breakpoint
CREATE INDEX "balls_non_striker_idx" ON "balls" USING btree ("non_striker_id");--> statement-breakpoint
CREATE INDEX "balls_bowler_idx" ON "balls" USING btree ("bowler_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_cricsheet_uq" ON "matches" USING btree ("cricsheet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_cricsheet_uq" ON "players" USING btree ("cricsheet_id");
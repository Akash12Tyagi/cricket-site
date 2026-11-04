CREATE INDEX "balls_dismissed_idx" ON "balls" USING btree ("dismissed_player_id");--> statement-breakpoint
CREATE INDEX "balls_fielder_idx" ON "balls" USING btree ("fielder_id");--> statement-breakpoint
CREATE INDEX "balls_created_by_idx" ON "balls" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "commentary_ball_idx" ON "commentary" USING btree ("ball_id");--> statement-breakpoint
CREATE INDEX "match_players_player_idx" ON "match_players" USING btree ("player_id");
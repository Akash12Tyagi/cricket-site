ALTER TYPE "public"."dismissal_type" ADD VALUE 'HIT_BALL_TWICE' BEFORE 'OBSTRUCTING_FIELD';--> statement-breakpoint
ALTER TABLE "balls" DROP CONSTRAINT "balls_runs_range";--> statement-breakpoint
ALTER TABLE "balls" ADD CONSTRAINT "balls_runs_range" CHECK ("balls"."runs_bat" between 0 and 12 and "balls"."extra_runs" between 0 and 12);
ALTER TABLE "moves" ADD COLUMN "eval_cp" integer;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "eval_mate" integer;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "eval_source" text;--> statement-breakpoint
CREATE INDEX "moves_needs_eval_idx" ON "moves" USING btree ("game_id","ply") WHERE "moves"."superseded" = false and "moves"."eval_source" is null;
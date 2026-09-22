DROP INDEX "moves_identity_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "moves_identity_idx" ON "moves" USING btree ("game_id","ply","source") WHERE "moves"."superseded" = false;
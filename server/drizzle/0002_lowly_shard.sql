ALTER TABLE "moves" ADD COLUMN "version" integer NOT NULL;--> statement-breakpoint
CREATE INDEX "moves_game_version_idx" ON "moves" USING btree ("game_id","version");
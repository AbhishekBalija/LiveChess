CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"white" text NOT NULL,
	"black" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"current_fen" text DEFAULT '' NOT NULL,
	"last_ply" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"ply" integer NOT NULL,
	"san" text NOT NULL,
	"fen" text NOT NULL,
	"clock" text,
	"superseded" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "games_source_idx" ON "games" USING btree ("source","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moves_identity_idx" ON "moves" USING btree ("game_id","ply","source");--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_source_idx" ON "tournaments" USING btree ("source","source_id");
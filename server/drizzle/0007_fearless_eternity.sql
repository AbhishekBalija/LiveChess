ALTER TABLE "games" ADD COLUMN "white_rating" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_rating" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "white_title" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_title" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "white_fide_id" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_fide_id" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "white_fed" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_fed" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "white_team" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_team" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "board" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "tier" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "fide_tc" text;
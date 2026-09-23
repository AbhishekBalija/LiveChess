ALTER TABLE "games" ADD COLUMN "result" text DEFAULT '*' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
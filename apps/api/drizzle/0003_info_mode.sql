ALTER TABLE "asks" ADD COLUMN "via" text DEFAULT 'prompt' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "info_mode" text DEFAULT 'prompt' NOT NULL;
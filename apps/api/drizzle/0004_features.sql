ALTER TABLE "out_calls" ADD COLUMN "hold_for_me" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "out_calls" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "out_calls" ADD COLUMN "saved_cents" integer;--> statement-breakpoint
ALTER TABLE "out_calls" ADD COLUMN "follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "out_calls" ADD COLUMN "follow_up_note" text;--> statement-breakpoint
ALTER TABLE "out_calls" ADD COLUMN "appointment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "out_calls" ADD COLUMN "calendar_event_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_calendar_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_refresh_token" "bytea";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_check" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_save" boolean DEFAULT true NOT NULL;
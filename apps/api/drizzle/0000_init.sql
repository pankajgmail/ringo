CREATE TYPE "public"."ask_me" AS ENUM('ask', 'decline', 'end');--> statement-breakpoint
CREATE TYPE "public"."carrier" AS ENUM('att', 'tmobile', 'verizon');--> statement-breakpoint
CREATE TYPE "public"."call_category" AS ENUM('billing', 'service', 'reservation', 'general');--> statement-breakpoint
CREATE TYPE "public"."in_call_type" AS ENUM('important', 'message', 'spam');--> statement-breakpoint
CREATE TYPE "public"."out_call_status" AS ENUM('scheduled', 'queued', 'dialing', 'in_progress', 'awaiting_user', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('success', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."call_priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."call_stage" AS ENUM('queue', 'dial', 'menu', 'hold', 'talk', 'done');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_number_enc" "bytea" NOT NULL,
	"account_number_last4" text NOT NULL,
	"holder_name" text,
	"pin_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"out_call_id" uuid NOT NULL,
	"kind" text DEFAULT 'decision' NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"retell_call_id" text,
	"from_number" text NOT NULL,
	"caller_name" text,
	"type" "in_call_type" DEFAULT 'message' NOT NULL,
	"summary" text,
	"callback_number" text,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_sec" integer,
	"cost_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "in_calls_retell_call_id_unique" UNIQUE("retell_call_id")
);
--> statement-breakpoint
CREATE TABLE "out_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"number" text NOT NULL,
	"category" "call_category" NOT NULL,
	"priority" "call_priority" NOT NULL,
	"goal" text NOT NULL,
	"limits" text DEFAULT '' NOT NULL,
	"ask_me" "ask_me" DEFAULT 'ask' NOT NULL,
	"reservation" jsonb,
	"status" "out_call_status" DEFAULT 'scheduled' NOT NULL,
	"stage" "call_stage" DEFAULT 'queue' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"job_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retell_call_id" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	"hold_sec" integer,
	"hold_started_at" timestamp with time zone,
	"outcome" "call_outcome",
	"summary" text,
	"reference" text,
	"disconnection_reason" text,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recording_key" text,
	"cost_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "out_calls_retell_call_id_unique" UNIQUE("retell_call_id")
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"address" text DEFAULT '' NOT NULL,
	"carrier" "carrier" DEFAULT 'att' NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"ringo_number" text,
	"twilio_number_sid" text,
	"forwarding_active" boolean DEFAULT false NOT NULL,
	"monthly_budget_cents" integer DEFAULT 2000 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_sub_unique" UNIQUE("auth_sub"),
	CONSTRAINT "users_ringo_number_unique" UNIQUE("ringo_number")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_out_call_id_out_calls_id_fk" FOREIGN KEY ("out_call_id") REFERENCES "public"."out_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_calls" ADD CONSTRAINT "in_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "out_calls" ADD CONSTRAINT "out_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_provider_uq" ON "accounts" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE INDEX "in_calls_user_started_idx" ON "in_calls" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "out_calls_user_sched_idx" ON "out_calls" USING btree ("user_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "out_calls_status_idx" ON "out_calls" USING btree ("status");
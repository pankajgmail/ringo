import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
import { ASK_ME, CARRIERS, CATEGORIES, IN_CALL_TYPES, OUTCOMES, OUT_CALL_STATUSES, PRIORITIES, STAGES } from "@ringo/shared";
import type { InfoMode, Offer, TranscriptLine } from "@ringo/shared";


export const carrierEnum = pgEnum("carrier", CARRIERS);
export const categoryEnum = pgEnum("call_category", CATEGORIES);
export const priorityEnum = pgEnum("call_priority", PRIORITIES);
export const askMeEnum = pgEnum("ask_me", ASK_ME);
export const outStatusEnum = pgEnum("out_call_status", OUT_CALL_STATUSES);
export const stageEnum = pgEnum("call_stage", STAGES);
export const outcomeEnum = pgEnum("call_outcome", OUTCOMES);
export const inTypeEnum = pgEnum("in_call_type", IN_CALL_TYPES);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Cognito `sub`. */
  authSub: text("auth_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  phone: text("phone"),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  address: text("address").notNull().default(""),
  /** US ZIP for local business search (Google Places). Required in the profile form; the street address is optional. */
  zip: text("zip").notNull().default(""),
  carrier: carrierEnum("carrier").notNull().default("att"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  /** Dedicated per-user number (decision D3). Identifies the user on forwarded inbound calls. */
  ringoNumber: text("ringo_number").unique(),
  twilioNumberSid: text("twilio_number_sid"),
  /** "prompt" = ask in the app; "conference" = call the user's phone and connect them to the rep. */
  infoMode: text("info_mode").$type<InfoMode>().notNull().default("prompt"),
  /** Stripe billing. Status mirrors the Stripe subscription (active, trialing, past_due, canceled…), kept fresh by webhook. */
  stripeCustomerId: text("stripe_customer_id").unique(),
  subscriptionId: text("subscription_id"),
  subscriptionStatus: text("subscription_status"),
  subscriptionPeriodEnd: timestamp("subscription_period_end", { withTimezone: true }),
  subscriptionCancelAtPeriodEnd: boolean("subscription_cancel_at_period_end").notNull().default(false),
  /** Google Calendar link. The refresh token is envelope-encrypted (KMS), bound to the user id. */
  googleCalendarEmail: text("google_calendar_email"),
  googleRefreshToken: bytea("google_refresh_token"),
  /** Ringvo may read free/busy before agreeing a time. */
  calendarCheck: boolean("calendar_check").notNull().default(true),
  /** Ringvo may add confirmed bookings and appointments to the calendar. */
  calendarSave: boolean("calendar_save").notNull().default(true),
  forwardingActive: boolean("forwarding_active").notNull().default(false),
  monthlyBudgetCents: integer("monthly_budget_cents").notNull().default(2000),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
});

export const outCalls = pgTable("out_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  name: text("name").notNull(),
  number: text("number").notNull(),
  category: categoryEnum("category").notNull(),
  priority: priorityEnum("priority").notNull(),
  goal: text("goal").notNull(),
  limits: text("limits").notNull().default(""),
  askMe: askMeEnum("ask_me").notNull().default("ask"),
  holdForMe: boolean("hold_for_me").notNull().default(false),
  /** Set when this call repeats or follows up an earlier one. */
  parentId: uuid("parent_id"),
  reservation: jsonb("reservation").$type<{ date: string; time: string; party: number } | null>(),
  status: outStatusEnum("status").notNull().default("scheduled"),
  stage: stageEnum("stage").notNull().default("queue"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  jobId: text("job_id"),
  attempts: integer("attempts").notNull().default(0),
  retellCallId: text("retell_call_id").unique(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSec: integer("duration_sec"),
  holdSec: integer("hold_sec"),
  holdStartedAt: timestamp("hold_started_at", { withTimezone: true }),
  outcome: outcomeEnum("outcome"),
  summary: text("summary"),
  reference: text("reference"),
  disconnectionReason: text("disconnection_reason"),
  savedCents: integer("saved_cents"),
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  followUpNote: text("follow_up_note"),
  appointmentAt: timestamp("appointment_at", { withTimezone: true }),
  calendarEventId: text("calendar_event_id"),
  transcript: jsonb("transcript").$type<TranscriptLine[]>().notNull().default(sql`'[]'::jsonb`),
  recordingKey: text("recording_key"),
  costCents: integer("cost_cents"),
  ...timestamps,
}, (t) => [index("out_calls_user_sched_idx").on(t.userId, t.scheduledAt), index("out_calls_status_idx").on(t.status)]);

/** Mid-call questions to the user (ask_user tool). */
export const asks = pgTable("asks", {
  id: uuid("id").primaryKey().defaultRandom(),
  outCallId: uuid("out_call_id").notNull().references(() => outCalls.id, { onDelete: "cascade" }),
  /**
   * "decision" = accept/counter/takeover/end; "code" = free text such as an OTP the provider texted the user;
   * "info" = something the rep asked for that Ringvo doesn't have (account number, PIN, party size).
   */
  kind: text("kind").$type<"decision" | "code" | "info">().notNull().default("decision"),
  question: text("question").notNull(),
  answer: text("answer"),
  note: text("note"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  /** How this ask reached the user: in the app, by SMS or WhatsApp, or by conferencing them in. */
  via: text("via").$type<InfoMode>().notNull().default("prompt"),
  /** Twilio SIDs of the question text and the reply, deleted from Twilio once answered (they can hold PINs). */
  messageSids: jsonb("message_sids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  ...timestamps,
});

export const inCalls = pgTable("in_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  retellCallId: text("retell_call_id").unique(),
  fromNumber: text("from_number").notNull(),
  callerName: text("caller_name"),
  type: inTypeEnum("type").notNull().default("message"),
  summary: text("summary"),
  callbackNumber: text("callback_number"),
  offer: jsonb("offer").$type<Offer>(),
  transcript: jsonb("transcript").$type<TranscriptLine[]>().notNull().default(sql`'[]'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  durationSec: integer("duration_sec"),
  costCents: integer("cost_cents"),
  ...timestamps,
}, (t) => [index("in_calls_user_started_idx").on(t.userId, t.startedAt)]);

/** Star rating + comment from the app's feedback screen. Deleted with the user. */
export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  platform: text("platform"),
  appVersion: text("app_version"),
  ...timestamps,
}, (t) => [index("feedback_created_idx").on(t.createdAt)]);

export const pushTokens = pgTable("push_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  platform: text("platform").notNull(),
  ...timestamps,
});

/** Who touched sensitive data or placed calls. Append-only. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

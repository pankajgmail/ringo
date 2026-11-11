import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ASK_ME, CARRIERS, CATEGORIES, IN_CALL_TYPES, OUTCOMES, OUT_CALL_STATUSES, PRIORITIES, STAGES } from "@ringo/shared";
import type { TranscriptLine } from "@ringo/shared";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

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
  carrier: carrierEnum("carrier").notNull().default("att"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  /** Dedicated per-user number (decision D3). Identifies the user on forwarded inbound calls. */
  ringoNumber: text("ringo_number").unique(),
  twilioNumberSid: text("twilio_number_sid"),
  forwardingActive: boolean("forwarding_active").notNull().default(false),
  monthlyBudgetCents: integer("monthly_budget_cents").notNull().default(2000),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
});

/** Per-provider account details. Sensitive values are KMS envelope-encrypted. */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  accountNumberEnc: bytea("account_number_enc").notNull(),
  accountNumberLast4: text("account_number_last4").notNull(),
  holderName: text("holder_name"),
  pinEnc: bytea("pin_enc"),
  ...timestamps,
}, (t) => [uniqueIndex("accounts_user_provider_uq").on(t.userId, t.providerId)]);

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
  transcript: jsonb("transcript").$type<TranscriptLine[]>().notNull().default(sql`'[]'::jsonb`),
  recordingKey: text("recording_key"),
  costCents: integer("cost_cents"),
  ...timestamps,
}, (t) => [index("out_calls_user_sched_idx").on(t.userId, t.scheduledAt), index("out_calls_status_idx").on(t.status)]);

/** Mid-call questions to the user (ask_user tool). */
export const asks = pgTable("asks", {
  id: uuid("id").primaryKey().defaultRandom(),
  outCallId: uuid("out_call_id").notNull().references(() => outCalls.id, { onDelete: "cascade" }),
  /** "decision" = accept/counter/takeover/end; "code" = free text such as an OTP the provider texted the user. */
  kind: text("kind").$type<"decision" | "code">().notNull().default("decision"),
  question: text("question").notNull(),
  answer: text("answer"),
  note: text("note"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
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
  transcript: jsonb("transcript").$type<TranscriptLine[]>().notNull().default(sql`'[]'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  durationSec: integer("duration_sec"),
  costCents: integer("cost_cents"),
  ...timestamps,
}, (t) => [index("in_calls_user_started_idx").on(t.userId, t.startedAt)]);

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

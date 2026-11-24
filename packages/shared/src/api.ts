import { z } from "zod";
import { ASK_ME, CARRIERS, INFO_MODES, CATEGORIES, IN_CALL_TYPES, OUTCOMES, OUT_CALL_STATUSES, PRIORITIES, STAGES } from "./domain.ts";

// Request/response contracts. The API validates with these; the app reuses them for forms and typing.

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, e.g. +14155550142");

export const ProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: e164,
  email: z.email(),
  /** Optional; read to the business only when the goal needs it. */
  address: z.string().trim().max(300).default(""),
  /** Required: business search looks near this ZIP. */
  zip: z.string().trim().regex(/^\d{5}$/, "Enter your 5-digit ZIP code"),
  /** Only used to pick forwarding codes; the app no longer asks for it. */
  carrier: z.enum(CARRIERS).optional(),
  timezone: z.string().default("America/Los_Angeles"),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const PreferencesSchema = z.object({
  infoMode: z.enum(INFO_MODES).optional(),
  /** Let Ringo look at free/busy on the connected Google Calendar before agreeing a time. */
  calendarCheck: z.boolean().optional(),
  /** Save confirmed bookings and appointments to the connected Google Calendar. */
  calendarSave: z.boolean().optional(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const ForwardingSchema = z.object({ active: z.boolean() });

export const ReservationSchema = z.object({
  date: z.iso.date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  party: z.int().min(1).max(30),
});

export const OutCallInputSchema = z
  .object({
    providerId: z.string().min(1),
    /** Required when providerId === "custom". */
    name: z.string().trim().max(120).optional(),
    number: e164.optional(),
    category: z.enum(CATEGORIES),
    priority: z.enum(PRIORITIES).default("medium"),
    goal: z.string().trim().min(3).max(1000),
    limits: z.string().trim().max(1000).default(""),
    askMe: z.enum(ASK_ME).default("ask"),
    /** "Hold for me": Ringo waits through menus and hold, then connects the user once a person answers. */
    holdForMe: z.boolean().default(false),
    /** Omit to call as soon as possible. */
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    reservation: ReservationSchema.optional(),
  })
  .refine((v) => v.providerId !== "custom" || (v.name && v.number), { message: "Custom calls need a name and number", path: ["number"] })
  .refine((v) => v.category !== "reservation" || v.reservation, { message: "Bookings need date, time and party size", path: ["reservation"] });
export type OutCallInput = z.infer<typeof OutCallInputSchema>;

export const TranscriptLineSchema = z.object({ role: z.enum(["agent", "other", "user"]), text: z.string(), at: z.number().optional() });
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

export const OutCallSchema = z.object({
  id: z.uuid(),
  providerId: z.string(),
  name: z.string(),
  number: z.string(),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  goal: z.string(),
  limits: z.string(),
  askMe: z.enum(ASK_ME),
  reservation: ReservationSchema.nullable(),
  status: z.enum(OUT_CALL_STATUSES),
  stage: z.enum(STAGES),
  scheduledAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSec: z.number().nullable(),
  holdSec: z.number().nullable(),
  outcome: z.enum(OUTCOMES).nullable(),
  summary: z.string().nullable(),
  reference: z.string().nullable(),
  costCents: z.number().nullable(),
  holdForMe: z.boolean(),
  /** Money the call saved the user (credits, refunds, lower bills), in cents. */
  savedCents: z.number().nullable(),
  /** When the rep said to call back, if they did. */
  followUpAt: z.string().nullable(),
  followUpNote: z.string().nullable(),
  /** Confirmed booking/appointment time, and whether Ringo put it on the user's calendar. */
  appointmentAt: z.string().nullable(),
  onCalendar: z.boolean(),
});
export type OutCall = z.infer<typeof OutCallSchema>;

export const InCallSchema = z.object({
  id: z.uuid(),
  fromNumber: z.string(),
  callerName: z.string().nullable(),
  type: z.enum(IN_CALL_TYPES),
  summary: z.string().nullable(),
  callbackNumber: z.string().nullable(),
  startedAt: z.string(),
  durationSec: z.number().nullable(),
});
export type InCall = z.infer<typeof InCallSchema>;

/** User's answer to an ask_user prompt raised mid-call. */
export const AnswerSchema = z.object({
  choice: z.enum(["accept", "counter", "takeover", "end", "reply"]),
  /** Free-text reply, e.g. the one-time code the provider texted the user. Required when choice === "reply". */
  note: z.string().trim().max(500).optional(),
}).refine((a) => a.choice !== "reply" || a.note, { message: "Reply text is required", path: ["note"] });
export type Answer = z.infer<typeof AnswerSchema>;

/** Repeat a past call's brief, now or at a later time (follow-up). */
export const RepeatCallSchema = z.object({ scheduledAt: z.iso.datetime({ offset: true }).optional() });

export const PhoneVerifyStartSchema = z.object({ phone: e164 });
export const PhoneVerifyCheckSchema = z.object({ phone: e164, code: z.string().regex(/^\d{4,10}$/) });

export const PushTokenSchema = z.object({ token: z.string().min(10), platform: z.enum(["ios", "android", "web"]) });

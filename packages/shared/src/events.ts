import type { Answer, OutCall, TranscriptLine } from "./api.ts";
import type { Stage } from "./domain.ts";

/** Messages pushed from API to clients over the WebSocket (/v1/live). */
export type LiveEvent =
  | { type: "call.updated"; call: OutCall }
  | { type: "call.stage"; callId: string; stage: Stage; line: string }
  | { type: "call.transcript"; callId: string; line: TranscriptLine }
  | { type: "call.ask"; callId: string; askId: string; kind: "decision" | "code"; question: string; options: Answer["choice"][]; expiresAt: string }
  | { type: "call.ask_resolved"; callId: string; askId: string };

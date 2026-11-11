import type { WebSocket } from "ws";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { eq, inArray } from "drizzle-orm";
import type { LiveEvent } from "@ringo/shared";
import { db, schema } from "../db/client.ts";

// Fan-out of live call events to the user's open app sessions, plus push for when the app is closed.
// Single-process hub. When running >1 API task, relay through Postgres LISTEN/NOTIFY (see docs/architecture.md).

const sockets = new Map<string, Set<WebSocket>>();
const expo = new Expo();

export function attach(userId: string, ws: WebSocket) {
  const set = sockets.get(userId) ?? new Set();
  set.add(ws);
  sockets.set(userId, set);
  ws.on("close", () => {
    set.delete(ws);
    if (!set.size) sockets.delete(userId);
  });
}

export function publish(userId: string, event: LiveEvent) {
  const msg = JSON.stringify(event);
  for (const ws of sockets.get(userId) ?? []) if (ws.readyState === ws.OPEN) ws.send(msg);
}

export const isOnline = (userId: string) => (sockets.get(userId)?.size ?? 0) > 0;

export async function push(userId: string, title: string, body: string, data: Record<string, unknown> = {}) {
  const rows = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.userId, userId));
  const messages: ExpoPushMessage[] = rows
    .filter((r) => Expo.isExpoPushToken(r.token))
    .map((r) => ({ to: r.token, title, body, data, sound: "default", priority: "high" }));
  if (!messages.length) return;
  const dead: string[] = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    const tickets = await expo.sendPushNotificationsAsync(chunk).catch(() => []);
    tickets.forEach((t, i) => {
      if (t.status === "error" && t.details?.error === "DeviceNotRegistered") dead.push(String(chunk[i]?.to));
    });
  }
  if (dead.length) await db.delete(schema.pushTokens).where(inArray(schema.pushTokens.token, dead));
}

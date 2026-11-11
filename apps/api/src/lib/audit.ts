import { db, schema } from "../db/client.ts";

export function audit(userId: string | null, action: string, detail?: Record<string, unknown>) {
  return db.insert(schema.auditLog).values({ userId, action, detail }).catch(() => undefined);
}

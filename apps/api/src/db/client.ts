import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

/** RDS requires TLS (rds.force_ssl); the image trusts the RDS CA via NODE_EXTRA_CA_CERTS. Shared by every pool. */
export const dbSsl = env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined;

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10, ssl: dbSsl });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };

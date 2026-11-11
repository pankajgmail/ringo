import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.ts";

await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
console.log("migrations applied");
await pool.end();

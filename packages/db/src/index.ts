import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

export type Database = ReturnType<typeof createDb>["db"];

/**
 * One pool per process. Keep `max` small: in production many app instances share
 * Postgres through PgBouncer (plan §4.4), so per-instance pools must stay modest.
 */
export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, {
    max: opts.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 5,
    prepare: false, // required behind PgBouncer in transaction mode
  });
  return { db: drizzle(client, { schema, casing: "snake_case" }), client };
}

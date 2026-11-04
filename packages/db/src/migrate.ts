import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index.js";

config({ path: new URL("../../../.env", import.meta.url).pathname });

const { db, client } = createDb(process.env.DATABASE_URL ?? "", { max: 1 });
await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
await client.end();
process.stdout.write("migrations applied\n");

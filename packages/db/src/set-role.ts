// Usage: pnpm --filter @cricket/db set-role you@example.com scorer
// Roles are granted only from the server shell, never through a public API.
import { config } from "dotenv";
import { USER_ROLES, type UserRole } from "@cricket/shared";
import { auditLogs, createDb, users } from "./index.js";

config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });
const [email, role] = process.argv.slice(2);
if (!email || !USER_ROLES.includes(role as UserRole)) {
  process.stderr.write(`usage: set-role <email> <${USER_ROLES.join("|")}>\n`);
  process.exit(1);
}
const { db, client } = createDb(process.env.DATABASE_URL ?? "", { max: 1 });
const [u] = await db.insert(users).values({ email: email.toLowerCase(), role: role as UserRole })
  .onConflictDoUpdate({ target: users.email, set: { role: role as UserRole } }).returning({ id: users.id });
await db.insert(auditLogs).values({ action: "user.role", entity: "user", entityId: u!.id, changes: { role, via: "cli" } });
await client.end();
process.stdout.write(`${email} is now ${role}\n`);

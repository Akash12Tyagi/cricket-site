import { Redis } from "ioredis";
import { createDb } from "@cricket/db";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createSmtpMailer } from "./lib/mailer.js";

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
const app = await buildApp({ env, db, redis, mailer: createSmtpMailer(env.SMTP_URL, env.MAIL_FROM) });

// Without a listener, an unreachable Redis would emit unhandled 'error' events and crash the process.
redis.on("error", (err) => app.log.warn({ err: err.message }, "redis error"));

// Graceful shutdown (plan §4.4): stop accepting, finish in-flight requests, then close pools.
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "shutting down");
    const force = setTimeout(() => process.exit(1), 20_000).unref();
    await app.close();
    await Promise.allSettled([client.end({ timeout: 5 }), redis.quit()]);
    clearTimeout(force);
    process.exit(0);
  });
}

await app.listen({ port: env.API_PORT, host: env.API_HOST });

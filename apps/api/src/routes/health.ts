import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Database } from "@cricket/db";

export async function healthRoutes(app: FastifyInstance, deps: { db: Database; redis: Redis }) {
  // Liveness: process is up. Never touches dependencies, so a DB blip doesn't restart every instance.
  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ ok: true }));

  // Readiness: can we serve traffic? Load balancers stop routing here when this fails.
  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
    const timeout = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 1500))]);
    const [dbOk, redisOk] = await Promise.all([
      timeout(deps.db.execute(sql`select 1`)).then(() => true, () => false),
      timeout(deps.redis.ping()).then(() => true, () => false),
    ]);
    return reply.code(dbOk && redisOk ? 200 : 503).send({ db: dbOk, redis: redisOk });
  });
}

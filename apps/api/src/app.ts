import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { LogController, type FastifyServerOptions } from "fastify";
import type { Redis } from "ioredis";
import { ZodError } from "zod";
import type { Database } from "@cricket/db";
import type { Env } from "./env.js";
import type { Mailer } from "./lib/mailer.js";
export { isPublicRead } from "./plugins/public.js";
import { registerOriginCheck } from "./plugins/security.js";
import { isPublicRead } from "./plugins/public.js";
import { registerSession } from "./plugins/session.js";
import { createRevalidator } from "./lib/revalidate.js";
import { authRoutes } from "./routes/auth.js";
import { articleRoutes } from "./routes/articles.js";
import { catalogRoutes } from "./routes/catalog.js";
import { meRoutes } from "./routes/me.js";
import { searchRoutes } from "./routes/search.js";
import { healthRoutes } from "./routes/health.js";
import { matchRoutes } from "./routes/matches.js";
import { mediaRoutes } from "./routes/media.js";
import { scoringRoutes } from "./routes/scoring.js";
import { streamRoutes } from "./routes/streams.js";
import { streamConfig } from "./streams/index.js";

export interface AppDeps {
  env: Env;
  db: Database;
  redis: Redis;
  mailer: Mailer;
  logger?: FastifyServerOptions["logger"];
  /** Outbound HTTP for stream verification (injected in tests; defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

/** Log redaction (plan §5.5): cookies, auth headers and request bodies never reach logs. */
export const REDACT_PATHS = ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'];

/** The visitor's IP for rate limiting: the CDN's header when configured (see env.CLIENT_IP_HEADER), else the socket/trusted-proxy IP. */
export function clientIp(req: { ip: string; headers: Record<string, string | string[] | undefined> }, header?: string): string {
  const v = header ? req.headers[header] : undefined;
  const ip = (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim();
  return ip && ip.length <= 45 ? ip : req.ip;
}

export async function buildApp({ env, db, redis, mailer, logger, fetchImpl }: AppDeps) {
  const app = Fastify({
    logger: logger ?? { level: env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: "[redacted]" } },
    // Trust exactly N proxy hops (CDN, Next.js proxy) for the client IP used in rate limiting.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    bodyLimit: 16 * 1024,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    keepAliveTimeout: 65_000, // longer than typical load-balancer idle timeout (60 s)
    // Access logs come from the CDN/LB in prod; health probes are never logged.
    logController: new LogController({
      disableRequestLogging: (req) => env.NODE_ENV === "production" || req.url === "/healthz" || req.url === "/readyz",
    }),
  });

  await app.register(helmet, {
    // JSON API: nothing should ever be rendered or framed.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    redis, // shared counters across all API instances
    nameSpace: "rl:",
    skipOnError: true, // if Redis is down, keep serving rather than failing every request
    allowList: (req) => isPublicRead(req.method, req.url),
    keyGenerator: (req) => clientIp(req, env.CLIENT_IP_HEADER),
  });

  registerOriginCheck(app, env.WEB_ORIGIN);
  registerSession(app, db, env.AUTH_SECRET);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "invalid_input",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    // Database/Redis unreachable → 503 + Retry-After, so clients (and the scorer panel) know to retry.
    // Drizzle wraps driver errors (DrizzleQueryError), so the connection error code may sit on `cause`.
    const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code && ["ECONNREFUSED", "ECONNRESET", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "ETIMEDOUT", "57P01", "57P03"].includes(code)) {
      req.log.error({ err }, "dependency unavailable");
      return reply.code(503).header("retry-after", "5").send({ error: "service_unavailable", reference: req.id });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, "unhandled error");
      // Never leak stack traces or internals; the reference ID lets support find the log line.
      return reply.code(500).send({ error: "internal_error", reference: req.id });
    }
    const message = err instanceof Error ? err.message : "Request error";
    return reply.code(status).send({ error: (err as { code?: string }).code ?? "request_error", message });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found" }));

  await app.register(healthRoutes, { db, redis });
  await app.register(authRoutes, { db, mailer, secret: env.AUTH_SECRET });
  await app.register(matchRoutes, { db, redis });
  await app.register(scoringRoutes, { db, redis });
  await app.register(catalogRoutes, { db });
  await app.register(meRoutes, { db });
  const revalidate = createRevalidator(env.WEB_INTERNAL_URL, env.REVALIDATE_SECRET, app.log);
  await app.register(articleRoutes, { db, revalidate });
  await app.register(mediaRoutes, { db, redis, revalidate });
  await app.register(streamRoutes, { db, cfg: streamConfig(env), fetchImpl, revalidate });
  await app.register(searchRoutes, { db });

  return app;
}

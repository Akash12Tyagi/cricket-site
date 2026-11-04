import type { FastifyInstance } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard (plan §5.3): any state-changing request must come from our own web origin.
 * Combined with SameSite=Lax cookies this blocks cross-site form/fetch attacks.
 */
export function registerOriginCheck(app: FastifyInstance, webOrigin: string) {
  const allowed = new URL(webOrigin).origin;
  app.addHook("onRequest", async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    const fetchSite = req.headers["sec-fetch-site"];
    if (origin !== allowed || (fetchSite !== undefined && fetchSite !== "same-origin")) {
      return reply.code(403).send({ error: "forbidden_origin" });
    }
  });
}

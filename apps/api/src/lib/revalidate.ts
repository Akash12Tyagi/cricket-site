import type { FastifyBaseLogger } from "fastify";

/**
 * Asks the web app to rebuild cached pages now (see apps/web/src/app/internal/revalidate).
 * Fire-and-forget with a short timeout: a failure only means the page refreshes on its normal ISR timer.
 */
export function createRevalidator(webInternalUrl: string | undefined, secret: string | undefined, log: FastifyBaseLogger) {
  return (paths: string[]) => {
    if (!webInternalUrl || !secret || paths.length === 0) return;
    void fetch(`${webInternalUrl}/internal/revalidate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({ paths }),
      signal: AbortSignal.timeout(2000),
    }).then((r) => { if (!r.ok) log.warn({ status: r.status }, "revalidate rejected"); })
      .catch((err: Error) => log.warn({ err: err.message }, "revalidate failed"));
  };
}

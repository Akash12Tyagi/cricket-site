import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";

/**
 * On-demand ISR refresh, called server-to-server by the API (e.g. when a story is published) so editors
 * don't wait for the cache to expire. Protected by a shared secret; in production also block /internal/*
 * at the CDN so it is only reachable from the private network.
 */
export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET ?? "";
  const given = req.headers.get("x-revalidate-secret") ?? "";
  const ok = secret.length >= 32 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { paths?: unknown } | null;
  const paths = Array.isArray(body?.paths) ? body.paths.filter((p): p is string => typeof p === "string" && /^\/[a-z0-9/[\]-]*$/.test(p) && p.length < 200).slice(0, 50) : [];
  for (const p of paths) {
    if (p.includes("[")) revalidatePath(p, "page"); // dynamic route pattern, e.g. /news/tag/[tag]
    else revalidatePath(p);
  }
  return Response.json({ revalidated: paths });
}

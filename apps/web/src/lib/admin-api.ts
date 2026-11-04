import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@cricket/shared";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** Server-side GET for admin pages: forwards only the session cookie, never cached. Returns null on any failure. */
export async function adminGet<T>(path: string): Promise<T | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${API}${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` }, cache: "no-store", signal: AbortSignal.timeout(3000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

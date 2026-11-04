import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, type PublicUser } from "@cricket/shared";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** Server-side "who is logged in", forwarding only the session cookie to the API. Never cached. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${API}/v1/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${token}` }, cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return ((await res.json()) as { user: PublicUser }).user;
  } catch {
    return null;
  }
}

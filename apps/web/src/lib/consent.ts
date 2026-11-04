/**
 * Cookie consent (plan §2.7, §5.6). The choice lives in a first-party cookie (not localStorage).
 * Any future analytics or ads MUST check `hasConsent("analytics")` before loading a single script.
 */
export type ConsentLevel = "essential" | "all";
export const CONSENT_COOKIE = "consent";

export function readConsent(): ConsentLevel | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)consent=(essential|all)(?:;|$)/);
  return (m?.[1] as ConsentLevel | undefined) ?? null;
}
export function writeConsent(level: ConsentLevel) {
  document.cookie = `${CONSENT_COOKIE}=${level}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax; Secure`;
}
export function hasConsent(_purpose: "analytics" | "ads"): boolean {
  return readConsent() === "all";
}

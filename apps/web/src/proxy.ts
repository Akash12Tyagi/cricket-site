import { NextResponse, type NextRequest } from "next/server";

/**
 * Strict, nonce-based CSP for the admin area (ZAP finding: the site-wide CSP needs 'unsafe-inline').
 * Admin pages are rendered per request anyway, so a fresh nonce costs nothing here, and these are the
 * highest-value pages: injected script on a scorer's or editor's screen could change scores or articles.
 * Public pages keep the static CSP so they stay CDN/ISR-cacheable (see next.config.ts).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'", // element style="" attributes only; no inline <style>/<script>
    "img-src 'self' data: blob: https://i.ytimg.com", // video thumbnails in the media admin
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp); // Next.js reads this to nonce its own scripts
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [{ source: "/admin/:path*", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};

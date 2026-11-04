import type { NextConfig } from "next";

const apiInternal = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/**
 * Content-Security-Policy (plan §5.3).
 * Trade-off: nonce-based CSP forces every page to render per request, which would defeat
 * CDN/ISR caching, our main defence against traffic spikes (plan §1). So we use a static policy:
 * scripts only from our own origin (no third-party script hosts), no plugins, no framing, and
 * forms/fetches only to ourselves. 'unsafe-inline' is needed for Next's inline bootstrap scripts;
 * XSS risk is reduced by React escaping and by sanitising all article HTML on save.
 * Add third-party hosts here deliberately, one by one, when consent-gated analytics arrive.
 * YouTube: official highlights play in YouTube's privacy-enhanced player (youtube-nocookie.com), loaded only after
 * the visitor clicks play; thumbnails come from i.ytimg.com. No YouTube script runs on our pages.
 */
/**
 * Live video hosts, from the environment (the same lists the API validates against): HLS feeds we play in our own
 * player, and provider-approved embed hosts. Nothing is opened unless an operator listed it.
 */
const hosts = (raw = "") => raw.split(",").map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter((h) => /^[a-z0-9.-]+$/.test(h));
const hlsHosts = hosts(process.env.STREAM_HLS_HOSTS).flatMap((h) => [`https://${h}`, `https://*.${h}`]);
const embedHosts = hosts(process.env.STREAM_EMBED_HOSTS).flatMap((h) => [`https://${h}`, `https://*.${h}`]);

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com",
  "font-src 'self'",
  `frame-src https://www.youtube-nocookie.com ${embedHosts.join(" ")}`.trim(),
  `connect-src 'self' ${hlsHosts.join(" ")}`.trim(),
  `media-src 'self' blob: ${hlsHosts.join(" ")}`.trim(),
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // ZAP finding: stop other sites from embedding our files (social crawlers fetch server-side and are unaffected).
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Plan §5.5: source maps are never served publicly (upload privately to error monitoring instead).
  productionBrowserSourceMaps: false,
  // Plan §5.5: strip every console.* call from production bundles.
  compiler: { removeConsole: process.env.NODE_ENV === "production" },
  transpilePackages: ["@cricket/shared"],
  output: "standalone",
  // Same-origin API: the browser only ever talks to our own domain, so the session cookie stays first-party and CORS stays closed.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiInternal}/:path*` }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Static CSP everywhere except /admin, which gets a stricter per-request nonce CSP from src/proxy.ts.
      { source: "/((?!admin(?:/|$)).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
};

export default config;

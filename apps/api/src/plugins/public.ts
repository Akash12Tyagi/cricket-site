/**
 * Public, read-only, identical-for-everyone GET routes. They are CDN-cached and cheap, so they are NOT
 * rate-limited per IP at the origin: carrier-grade NAT puts thousands of mobile fans behind one IP, and a
 * per-IP limit would lock them out on match day (found by the load test). Abuse protection for these lives
 * at the edge (CDN/WAF rate rules). /v1/search is deliberately absent: it stays limited.
 */
const PUBLIC_READ = /^\/(?:healthz|readyz|v1\/(?:matches|schedule|series|teams|players|articles|videos|sitemap))(?:[/?]|$)/;
export const isPublicRead = (method: string, url: string) => (method === "GET" || method === "HEAD") && PUBLIC_READ.test(url);

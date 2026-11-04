// Targeted security probes against a running stack (local or staging). Prints PASS/FAIL per check.
//   WEB=http://localhost:3100 API=http://127.0.0.1:4000 node scripts/security-probe.mjs
const WEB = process.env.WEB ?? "http://localhost:3100";
const API = process.env.API ?? "http://127.0.0.1:4000";
let failed = 0;
const result = (ok, name, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const post = (url, body, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", origin: WEB, ...headers }, body: JSON.stringify(body) });
const rnd = () => Math.random().toString(36).slice(2, 8);

// 1. Login-code rate limit can't be dodged by spoofing X-Forwarded-For through the public proxy.
{
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await post(`${WEB}/api/v1/auth/code`, { email: `probe-${rnd()}@example.com` }, { "x-forwarded-for": `203.0.113.${i + 1}` })).status);
  result(codes.includes(429), "login-code limit holds when X-Forwarded-For is spoofed", codes.join(","));
}
// 2. CSRF: state-changing request from another origin, or with no origin, is refused.
result((await post(`${API}/v1/auth/logout`, {}, { origin: "https://evil.example" })).status === 403, "cross-site POST rejected");
result((await fetch(`${API}/v1/auth/logout`, { method: "POST" })).status === 403, "POST without Origin rejected");
// 3. Authorization: admin/user endpoints need a session.
for (const [m, u] of [["GET", "/v1/admin/articles"], ["GET", "/v1/me"], ["POST", "/v1/admin/matches/00000000-0000-4000-8000-000000000000/status"], ["DELETE", "/v1/me"]]) {
  const r = await fetch(`${API}${u}`, { method: m, headers: { origin: WEB, "content-type": "application/json" }, body: m === "GET" ? undefined : "{}" });
  result(r.status === 401, `${m} ${u} requires login`, String(r.status));
}
// 4. Forged/garbage session cookies are ignored.
result((await fetch(`${API}/v1/auth/me`, { headers: { cookie: "__Host-sid=" + "A".repeat(43) } })).status === 401, "forged session cookie rejected");
// 5. Injection probes: rejected by validation or treated as plain text; never a 500.
for (const u of ["/v1/search?q=%27%20OR%201%3D1--", "/v1/search?q=%3Cscript%3E", "/v1/teams/x'%20or%20'1'='1", "/v1/players/..%2F..%2Fetc%2Fpasswd", "/v1/matches/%27%3B%20DROP%20TABLE%20balls%3B--/live"]) {
  const r = await fetch(`${API}${u}`);
  const body = await r.text();
  result(r.status < 500 && !/at .*\.(ts|js):\d+|syntax error|postgres/i.test(body), `injection probe ${u}`, String(r.status));
}
// 6. Oversized body refused (16 KB limit).
result((await post(`${API}/v1/auth/logout`, { pad: "x".repeat(20_000) })).status === 413, "oversized body rejected"); // not the login-code route: its limit was used up by check 1
// 7. On-demand revalidation can't be triggered by the public.
result((await post(`${WEB}/internal/revalidate`, { paths: ["/"] })).status === 403, "/internal/revalidate requires the secret");
// 8. Security headers on the website and the API.
const wh = (await fetch(`${WEB}/`)).headers;
for (const h of ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"]) result(wh.has(h), `web header ${h}`);
result(!wh.has("x-powered-by"), "web hides X-Powered-By");
result(wh.get("cross-origin-resource-policy") === "same-site", "web CORP same-site");
// Admin pages get a strict per-request nonce CSP (no 'unsafe-inline' for scripts), even on the login redirect.
const adminCsp = (await fetch(`${WEB}/admin`, { redirect: "manual" })).headers.get("content-security-policy") ?? "";
result(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/.test(adminCsp) && !/script-src[^;]*unsafe-inline/.test(adminCsp), "admin CSP is nonce-based and strict");
const ah = (await fetch(`${API}/v1/teams`)).headers;
for (const h of ["content-security-policy", "strict-transport-security", "x-content-type-options"]) result(ah.has(h), `api header ${h}`);
// 9. Unknown routes and errors don't leak internals.
const nf = await fetch(`${API}/v1/does-not-exist`);
result(nf.status === 404 && (await nf.text()) === '{"error":"not_found"}', "404 body is minimal");
// 10. Source maps are not served.
const html = await (await fetch(`${WEB}/`)).text();
const chunk = html.match(/\/_next\/static\/chunks\/[^"]+\.js/)?.[0];
result(!!chunk && (await fetch(`${WEB}${chunk}.map`)).status === 404, "browser source maps not served", chunk ?? "no chunk found");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);

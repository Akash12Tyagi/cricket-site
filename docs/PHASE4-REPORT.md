# Phase 4: Hardening report

Date: 26 October 2026. Environment: one MacBook (8 CPU, 8 GB RAM) running the load generator (k6 in Docker), Postgres, Redis,
**one** API process and **one** web process, with **no CDN**. Production adds a CDN and several instances of each service, so these
numbers are a worst case for the origin.

## 1. Load tests (`loadtest/`)

Viewers are modelled by request rate: N viewers polling every 10 s = N/10 requests/s. Each simulated viewer keeps its ETag like a browser tab.

| Test | Result | Target |
|---|---|---|
| **Baseline, 10k viewers (before fixes)** | **99 % rejected with 429**: per-IP rate limit (single IP) | no rejections |
| 10k viewers steady (1,000 req/s), API | p50 0.8 ms · **p95 2.7 ms** · p99 12 ms · 0 errors · 99.3 % answered `304` | p95 < 200 ms |
| 10k steady → **50k spike** (5,000 req/s), with a scorer bot adding a ball every 10 s | 279k requests · **0 errors** · p95 198 ms · p99 328 ms · 12/12 balls scored · 2 % of planned requests not sent (load generator saturated) | p95 < 200 ms |
| Page loads through Next.js, 170 pages/s (10k fans arriving in a minute) | **p95 4.6 ms** · 0 failures | p95 < 500 ms |
| **Final regression run, after all fixes**: 10k steady | **p95 1.2 ms** · p99 5.8 ms · 0 errors (faster: memory cache + no session lookup on public reads) | p95 < 200 ms |

**Finding 1: per-IP rate limit would have locked out fans (fixed).** Carrier-grade NAT (very common on Indian mobile networks) puts
thousands of phones behind one IP. Public, cacheable read routes are now exempt from per-IP limits at the origin
(`apps/api/src/plugins/public.ts`, unit-tested); their abuse protection belongs at the CDN/WAF edge. Login, search, scoring and account
routes keep their limits.

## 2. Failure drills

| Drill (10k viewers polling) | Before fixes | After fixes |
|---|---|---|
| **Redis stopped 15 s** | p95 **6.96 s**, ~15,000 requests dropped, DB pool exhausted | p95 **2.1 ms**, **0 dropped**, 0 errors |
| **Postgres stopped** | live polls fine; **home page cached the error message and stayed broken after the DB recovered** | live polls fine (logged-in too); pages keep last good version; scoring returns **503 + Retry-After** |
| **API process killed** | (n/a) | home, match, schedule, team, news pages all **200 from cache**; live poll shows "Reconnecting…" |

**Finding 2: no in-memory fallback (fixed).** Without Redis, every poll rebuilt the snapshot from Postgres. Added a per-process cache
with single-flight and stale-on-error (`apps/api/src/lib/memo.ts`): 1 s fresh, up to 5 min stale. Unit-tested (500 concurrent misses → 1 load).

**Finding 3: error pages got cached (fixed).** ISR pages returned an "unavailable" message on API failure, which Next.js then cached.
Data helpers now throw `UpstreamError`, so a failed background refresh keeps the last good page (`apps/web/src/lib/api.ts`).

**Finding 4: session lookup on public reads (fixed).** Every poll from a logged-in fan ran a session query, so during a DB outage their
live score failed while anonymous fans' worked. Public reads now skip session lookup (also one less DB query per poll).

**Finding 5: unclear error during DB outage (fixed).** Database connection failures (including errors wrapped by the ORM) now return
`503 service_unavailable` with `Retry-After: 5`. The scorer panel keeps the same idempotency key on 503, so retrying can't double-count a ball.

**Remaining limits (documented in runbooks):** a page never rendered since a deploy has no cached copy to fall back on (warm key pages
after deploys); a cold API process with Redis empty *and* Postgres down cannot serve a match it has never seen.

## 3. Security

Automated probes: `scripts/security-probe.mjs` (29 checks, now in CI against the running stack): CSRF, auth on admin/user routes, forged
cookies, injection probes (SQL/XSS/path traversal), body size, revalidation secret, security headers, no source maps, minimal error bodies.

**Finding 6: login rate limit could be bypassed by spoofing X-Forwarded-For (fixed).** The Next.js proxy forwards a client-supplied
`X-Forwarded-For` unchanged and doesn't add the real IP, so the API trusted attacker input (and without spoofing, every visitor shared one
IP, so one attacker could lock everyone out of login). Now forwarded headers are ignored by default (`TRUST_PROXY_HOPS=0`). Production reads
the real IP from the CDN's header via `CLIENT_IP_HEADER`, which is safe only with an origin firewall that admits the CDN alone.
Integration test: 7 requests with rotating spoofed IPs → 5×202, 2×429.

Other: open-redirect guard on login (`safeNext`, 8 tests); Markdown XSS sanitising (7 tests, Phase 3); `pnpm audit` in CI.

ZAP baseline scan: see section 5.

## 4. Operations

Runbooks in `docs/runbooks/`: big-match checklist, site degraded, Redis down, Postgres down, API down/rollback, scorer problems, security incident.

## 5. OWASP ZAP baseline (`docs/security/zap-baseline.html`)

Final run: **0 failures, 62 passed, 6 warnings.**

| Warning | Decision |
|---|---|
| CSP `script-src 'unsafe-inline'` (Medium) | **Fixed for `/admin`**: strict per-request nonce CSP (`apps/web/src/proxy.ts`); 0 admin URLs flagged in the final scan, 0 CSP violations in the browser. **Accepted for public pages**: a nonce makes every page uncacheable, which conflicts with the CDN/ISR design; mitigated by own-origin-only scripts, React escaping, server-side HTML sanitising. Revisit with hash-based CSP if Next.js adds it for ISR. |
| Cross-Origin-Resource-Policy missing (Low) | **Fixed**: `same-site` on the website (the API already sends `same-origin`). |
| Cross-Origin-Embedder-Policy missing (Low) | Accepted: only needed for cross-origin isolation (SharedArrayBuffer), which we don't use; enabling it would break images from other https hosts. |
| Big redirect on `/admin` (Low) | Accepted: logged-out redirect to `/login`, no user data in the body. |
| Content-Type missing on `/api/`, `/internal/` 404s; "Modern web app"; cacheability notes | Informational. |

## 6. Launch blockers that remain (need decisions/accounts)

1. **Hosting + CDN**: choose a provider (e.g. AWS + Cloudflare). Needed for staging, the real 5× load test with a CDN in front,
   `CLIENT_IP_HEADER`, origin firewall, WAF rate rules, and autoscaling.
2. **Managed Postgres with PgBouncer + point-in-time recovery**, **managed Redis**.
3. **Error monitoring** (e.g. Sentry) and uptime/alerting (plan §7).
4. **Email provider** for login codes (SPF/DKIM/DMARC), replacing the local Mailpit.
5. **Legal review** of the draft Privacy/Cookies/Terms pages.

## 7. Test totals after Phase 4

114 automated tests (shared 38, web 8, API 68) + 29 security probes, all passing; lint, typecheck, production build and bundle gate clean.

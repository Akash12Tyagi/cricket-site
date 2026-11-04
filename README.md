# CricketLive

Live cricket scores site built for 10k+ concurrent users. See `../cricket-research/WEBSITE-PLAN.md` for the full plan.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js (App Router) site: SSR/ISR pages, security headers, `/api/*` proxied to the API (same-origin cookies) |
| `apps/api` | Fastify API: passwordless login, sessions, public match endpoints, health checks |
| `packages/db` | Drizzle schema (data model §4.1), migrations, seed |
| `packages/shared` | Zod schemas and constants shared by web and API (auth rules, cache policy, cricket enums) |
| `scripts/check-web-bundle.sh` | Release gate: no source maps or `console.*` in browser bundles |

## Local setup

Requires Node 24+, pnpm, Docker.

```bash
cp .env.example .env            # then set AUTH_SECRET: openssl rand -base64 48
pnpm install
pnpm db:up                      # Postgres :5440, Redis :6380, Mailpit :8025
pnpm db:migrate && pnpm db:seed
pnpm --filter @cricket/db seed-demo   # optional: a complete simulated T20 (fictional teams/players)
pnpm dev                        # web http://localhost:3100, API http://localhost:4000
```

Login codes arrive in the local inbox at http://localhost:8025. They are never written to logs.

Ports avoid 3000/5432/6379, which other local projects use.

## Real data (Cricsheet + Wikidata)

Completed matches come from [Cricsheet](https://cricsheet.org) (ODC-By 1.0: **attribution required**, shown in the footer and on `/data`);
player facts from Wikidata (CC0). Stories and bios from other sites are **not** copied.

```bash
mkdir -p data/cricsheet/register && cd data/cricsheet
for s in ipl_male t20s_male odis_male tests_male recently_played_30_male; do curl -sfLO https://cricsheet.org/downloads/${s}_json.zip && mkdir -p $s && (cd $s && unzip -qo ../${s}_json.zip); done
curl -sfL -o register/people.csv https://cricsheet.org/register/people.csv && cd ../..
for s in ipl_male t20s_male odis_male tests_male recently_played_30_male; do pnpm --filter @cricket/db import-cricsheet ../../data/cricsheet/$s; done
pnpm --filter @cricket/db enrich-wikidata ../../data/cricsheet/register/people.csv
node scripts/verify-cricsheet.mjs data/cricsheet/tests_male   # cross-check totals against the raw data
```

Imports are idempotent (re-running only adds new matches). Current load: 8,427 matches, 4.26M deliveries, 6,153 players.
Known gaps: deliveries with two dismissals keep only the first (5 of 18,488 innings differ by one wicket); Super Overs not shown;
matches involving Afghanistan men are withheld by Cricsheet.

## Live scores from a licensed feed, where to watch, videos

We never scrape other cricket sites or re-stream matches. Three legal sources instead:

**1. Licensed live-score feed** (`apps/api/src/feed/`). A separate worker polls a commercial provider
([Sportmonks Cricket API](https://docs.sportmonks.com/v2/cricket-api), paid plan) every few seconds and writes each delivery
through the same scoring engine as our scorers. Fans never call the provider: they read the same Redis/CDN snapshot as before,
so 10k or 1M viewers cost one provider request per poll.

```bash
# .env: FEED_PROVIDER=sportmonks, SPORTMONKS_API_TOKEN=..., optional FEED_POLL_SECONDS=5, FEED_AUTO_CREATE=true
pnpm --filter @cricket/api feed            # dev
node apps/api/dist/worker.js               # production (after pnpm build); run 2 replicas, a Redis lock keeps one active
# No token yet? Replay a saved provider response:
FEED_PROVIDER=sportmonks-file FEED_FILE=/path/to/fixture.json pnpm --filter @cricket/api feed
```

- Provider corrections (umpire reviews etc.) rebuild that innings automatically; re-syncs are idempotent.
- While a feed owns a match, manual scoring is refused (`409 feed_active`). An admin can pause the feed on
  **Admin → Media & feed** to hand the match to a scorer, and resume it later.
- Adding another provider means one adapter that returns `FeedFixture` (`feed/types.ts`); nothing else changes.
- Worker health (last poll, errors, mapping warnings) shows on **Admin → Media & feed**.

**Highlightly (free plan: fixtures, live scores, scorecards).** `FEED_PROVIDER=highlightly` + `HIGHLIGHTLY_API_KEY`.
Highlightly sends scorecards, not deliveries, so these matches run in *scorecard mode*: the live page shows totals, chase,
batting and bowling cards (stored in `matches.scorecard`); ball-by-ball commentary isn't available for them. The runner
(`feed/highlightly-runner.ts`) spreads the plan's daily requests: fixtures for 3 days twice a day, one request that updates every
match today (every ~15–25 min on the free plan, down to `HIGHLIGHTLY_MIN_LIST_SECONDS` on paid plans), and paced scorecard
fetches (finished matches once, internationals first). It reads the plan's remaining-requests header and stops before the limit.
Multi-day matches (Ranji, Tests) are advanced from the same list refresh (a team's k-th score line is its k-th innings, and a newly started innings is appended with totals until the next scorecard fetch), so they don't wait for the paced scorecard calls. Matches we already hold from another source are skipped; when Cricsheet later publishes the ball-by-ball file, the importer
upgrades the same match (same URL) instead of duplicating it. Check Highlightly's terms for commercial use of the free plan.

**2. Where to watch.** Editors add official broadcaster links per match or per series and country (e.g. IN → JioHotstar).
Links only; https only. The visitor's own country is listed first, worked out in the browser from the time zone (never sent to us).

**3. Official videos (free).** The worker reads the public YouTube feeds of an allow-list of official channels (ICC, boards;
seeded in migration 0006, editable in admin) every `YOUTUBE_POLL_MINUTES` (default 10), shows only videos whose owner allows
embedding, and links each video to a match when the title names both teams. Editors can add an official video or live stream by URL.

Add a free **YouTube Data API key** to unlock each channel's whole back catalogue, view counts and the
**Most viewed / Most viewed this week** lists at `/videos/popular` and `/videos/week`:
1. In [Google Cloud Console](https://console.cloud.google.com/) create a project → *APIs & Services* → enable **YouTube Data API v3**.
2. *Credentials* → *Create credentials* → *API key*; restrict it to the YouTube Data API. No billing account is needed.
3. Put it in `.env` as `YOUTUBE_API_KEY=...` and restart the worker.

The worker spends at most `YOUTUBE_DAILY_UNITS` (default 8,000 of the free 10,000) a day: never `search` (100 units), only 1-unit
list calls, so it imports about 50 videos per unit and finishes even large channels within a day or two. Following YouTube's API
policies, view counts are refreshed (last 7 days' uploads every 6 h, others every 20 days), cleared if older than 30 days, and
videos removed from YouTube are deleted. Videos play click-to-load in YouTube's privacy-enhanced player; CSP allows only
`youtube-nocookie.com` frames and `i.ytimg.com` images; Terms and Privacy pages carry the YouTube/Google notices the policies require.

**4. Automated newsroom** (`apps/api/src/feed/newsroom.ts`, runs in the worker every `NEWSROOM_SECONDS`, default 30).
Writes original stories from our own ball-by-ball data the moment they happen: match reports when a result comes in,
hundreds/double hundreds and five-wicket hauls while a match is live, and previews (head-to-head, form, where to watch) the
day before a match. Each event is published exactly once (`news_events`), every story is labelled as automatically generated
and links to its scorecard, and nothing is copied from other publishers. Only matches from the last 3 days or the next
24 hours are considered, so the historical archive never triggers stories. Editors can still edit or unpublish any story.

**5. Live video (Watch tab).** Multi-server player for *authorised* sources only: official YouTube streams, licensed HLS feeds
(played in our own player) and provider-approved embeds, with automatic failover, verification ("Live" only when proven),
territory ordering and server-held access tokens. Nothing is shown as live unless a real stream was verified. See
[docs/LIVE-VIDEO.md](docs/LIVE-VIDEO.md) for the MWSGuy research, the licensing routes (JioStar etc.), setup and what is still needed.

## Scoring (Phase 1)

1. Make yourself a scorer (server shell only; there is no public API for roles):
   `pnpm --filter @cricket/db set-role you@example.com scorer`
2. Log in at http://localhost:3100/login, then open http://localhost:3100/admin and pick a match.
3. Keyboard: `0`–`6` score a ball · `d` wide · `n` no-ball · `b` bye · `l` leg-bye · `w` wicket · `s` swap strike · `u` undo (press twice) · `Esc` reset.

How it works:
- **Engine** (`packages/shared/src/scoring.ts`): every total is derived from the ball log (runs, overs, extras, batting/bowling figures, maidens, FoW, partnership, run rates, chase, next striker). 35 unit tests cover the cricket rules.
- **Write path** (`apps/api/src/routes/scoring.ts`): one transaction per ball with a row lock on the innings, so two scorers can't interleave. Validated against the rules, idempotent on a client key (retries never double-score), audit-logged. Undo is just "delete the last ball" (audit-logged too).
- **Read path** (`apps/api/src/services/snapshot.ts`): after each write a single JSON snapshot per match is rebuilt into Redis. Fans poll `GET /v1/matches/{id|slug}/live` (CDN `s-maxage=5`, ETag → `304` when nothing changed). If Redis is down, the snapshot is rebuilt from Postgres.
- **Web**: `/match/[slug]` is ISR (5 s) plus client polling with jitter, tab-hidden pause and backoff; the live score is in the tab title. `/admin/*` is server-gated by role and never cached.

## Fan site (Phase 2)

| Page | Route | Cache |
|---|---|---|
| Match centre: Live / Scorecard / Commentary / Squads | `/match/[slug]`, `/scorecard`, `/commentary`, `/squads` | ISR 5 s + client polling |
| Schedule (fixtures and results by day) | `/schedule` | ISR 60 s |
| Series list / series | `/series`, `/series/[slug]` | ISR 5 min / 60 s |
| Teams list / team (fixtures, results, recent squad) | `/teams`, `/teams/[slug]` | ISR 1 h / 5 min |
| Player profile (career batting/bowling by format, aggregated from the ball log) | `/player/[slug]` | ISR 10 min |
| Share image with the live score | `/match/[slug]/opengraph-image` | ISR 60 s |
| `sitemap.xml` (all matches, series, teams, players) | `/sitemap.xml` | data cached 1 h |

- Match pages carry schema.org `SportsEvent` JSON-LD, canonical URLs, and the live score in `<title>`.
- Commentary "load older" uses keyset pagination (`/v1/matches/:key/balls`); older pages are immutable and CDN-cached for a day.
- Times render in UTC on the server (cache-friendly HTML) and switch to the visitor's timezone in the browser.

## Accounts, news, search (Phase 3)

- **Accounts** (`/account`): display name, follows (Follow buttons on team/player pages), download my data, log out / log out everywhere, delete account (type DELETE). Staff accounts can't self-delete.
- **Signed-in state without breaking caching**: pages are identical for everyone. Login also sets `signed_in=1`, a non-secret hint; only browsers with it call `/v1/auth/me`. Personal data is fetched client-side, kept in memory, and never written to browser storage.
- **News CMS** (`/admin/news`, roles `editor`/`admin`): Markdown in, server-side `marked` + `sanitize-html` allow-list out (no scripts, handlers, iframes, styles, non-https links). Drafts stay private until published. Publishing triggers **on-demand revalidation** (`/internal/revalidate`, shared secret), so stories go live in about 2 s instead of waiting for ISR.
- **Public news**: `/news`, `/news/[slug]` (NewsArticle JSON-LD), `/news/tag/[tag]`; articles are in the sitemap.
- **Search** (`/search`, header box): Postgres `pg_trgm` over players, teams, series and published stories; handles partial words and small typos; LIKE wildcards escaped; rate-limited.
- **Consent**: banner on first visit; choice stored in a `consent` cookie. Future analytics/ads must check `hasConsent()` (`apps/web/src/lib/consent.ts`) before loading. Draft `/privacy`, `/cookies`, `/terms` describe exactly what the code does; **have them reviewed by a lawyer before launch.**
- Roles: `pnpm --filter @cricket/db set-role you@example.com editor` (or `scorer`, `admin`).

## Hardening (Phase 4)

- Report with all load-test, failure-drill and security results: [`docs/PHASE4-REPORT.md`](docs/PHASE4-REPORT.md)
- Runbooks (big-match checklist, outages, scorer issues, security incidents): [`docs/runbooks/`](docs/runbooks/README.md)
- Load tests: `loadtest/live-match.js`, `loadtest/pages.js` (k6 via Docker, commands in the file headers); `loadtest/scorer-bot.mjs` scores during tests.
- Security probes: `node scripts/security-probe.mjs` (also runs in CI).
- Production settings: `CLIENT_IP_HEADER` (CDN real-IP header) **only** with an origin firewall that admits the CDN alone; leave `TRUST_PROXY_HOPS` at 0.

## Checks

```bash
pnpm check                      # lint + typecheck + tests (tests need `pnpm db:up`)
pnpm --filter @cricket/web build && ./scripts/check-web-bundle.sh
```

CI (`.github/workflows/ci.yml`) runs all of this plus a dependency audit on every push and PR.

## Security decisions (plan §5)

- **No secrets in the browser.** The session is an `__Host-sid` cookie: `HttpOnly; Secure; SameSite=Lax`. Only an HMAC of the token is stored server-side. Nothing is written to localStorage, sessionStorage or IndexedDB (verified with REA, evidence `ev_32a52c4f…`).
- **Passwordless login.** 6-digit email codes, HMAC-stored, 10-minute expiry, 5 attempts, single use, rate-limited per IP and per email. Responses never reveal whether an account exists.
- **CSRF.** State-changing requests must come from `WEB_ORIGIN` (Origin + `Sec-Fetch-Site` check) on top of SameSite cookies.
- **No console output in production.** ESLint `no-console` is an error, `compiler.removeConsole` is on, browser source maps are off, and the bundle gate runs in CI. API logs go through pino with cookie/auth headers redacted.
- **Headers.** Strict CSP (own origin only), HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, no `X-Powered-By`.
  The CSP is static rather than nonce-based so pages stay CDN-cacheable (see the comment in `apps/web/next.config.ts`).
- **Errors.** Clients get a generic message plus a reference ID; stack traces stay in server logs.

## Scaling decisions (plan §1, §3)

- Public data is the same for every visitor and is sent with `s-maxage` + `stale-while-revalidate` + `stale-if-error`, so the CDN absorbs polling and serves stale data if the origin fails.
- Pages use ISR (home page revalidates every 10 s); the API fetch has a 3 s timeout and the page degrades to a friendly message instead of erroring.
- API is stateless (sessions in Postgres, rate-limit counters in Redis), has `/healthz` (liveness) and `/readyz` (DB + Redis), and shuts down gracefully.
- DB pool is small per instance, with `prepare: false` so it works behind PgBouncer.

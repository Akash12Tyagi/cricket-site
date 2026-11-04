# API down or bad deploy

**What fans see:** cached pages keep working (drill: home, match, schedule, team, news all 200 with the API process killed).
Live score polling fails; the page shows "Reconnecting…" and backs off (up to 2 min). Scoring is impossible.

**Exception (drill finding):** a page that hasn't rendered since the last deploy has no cached copy and shows the error page.
That's why the big-match checklist warms key pages after every deploy. The CDN's `stale-if-error` also covers this in production.

**Do:**
1. Recently deployed? **Roll back first, investigate later** (re-deploy the previous image tag; it's stateless).
2. Not a deploy: check instance logs for the `reference` ID users report (every 500 response carries one).
3. Crash loop on boot with `Invalid environment: …` → a missing/invalid env var (the message lists names only, never values).
4. Database migrations: always backwards-compatible (add columns, never rename/drop in the same release), so rolling back code never needs a DB rollback.

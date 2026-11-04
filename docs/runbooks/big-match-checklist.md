# Big match checklist (T−24 h to T+1 h)

**T−24 h**
- [ ] No deploys from T−24 h until the match ends (code freeze).
- [ ] Autoscaling minimum raised: API ≥ 4 instances, web ≥ 4, across 2 zones.
- [ ] `/readyz` green on every instance; error rate < 0.1 %; p95 < 200 ms on the dashboard.
- [ ] Database: backup completed in the last 24 h and point-in-time recovery enabled; replica lag < 1 s.
- [ ] Load test staging at **5× the expected peak** (`loadtest/live-match.js` with `VIEWERS` and `SPIKE`). Pass = p95 < 200 ms, 0 errors.

**T−2 h**
- [ ] Match, teams, squads and playing XI entered and checked (public `/match/<slug>/squads`).
- [ ] **Warm the caches**: open `/`, `/match/<slug>`, `/match/<slug>/scorecard` once per web instance after the last deploy.
      (Drill finding: a page never rendered since a deploy can't be served stale if the API then fails.)
- [ ] CDN: cache rules active for `/_next/static/*`, HTML pages, and `/api/v1/matches/*/live` (respect origin `s-maxage`);
      cookies stripped from public GETs so they are cacheable.
- [ ] Two scorers logged in on separate devices and networks; one is the backup. Both know the keyboard shortcuts and **Undo needs two presses**.
- [ ] Scorer laptops: close other tabs. Never leave the scorer tab focused while typing elsewhere: keyboard shortcuts score balls.

**During**
- [ ] Watch: requests/s, CDN hit ratio (target > 95 %), p95 latency, 5xx rate, queue/snapshot lag (ball entered → visible ≤ 10 s).
- [ ] Spot-check the public page against TV coverage every few overs.

**After**
- [ ] Set the result and status COMPLETED. Lower autoscaling minimums the next day.

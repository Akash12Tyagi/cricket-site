# Postgres down

**What fans see:** live scores keep working (from Redis and memory). Pages keep showing their last good version.
Drill result: logged-in and anonymous polls 200 in about 6 ms; home and match pages unchanged; nothing broken after recovery.

**What breaks:**
- **Scoring:** the API returns `503 service_unavailable` with `Retry-After: 5`. The scorer panel says the ball may not be saved and to press the
  same button again; the retry reuses the same idempotency key, so the ball can't be counted twice.
- Login, accounts, news editing, search, and any page or match **not already cached** (those return 503 or the friendly error page).

**Do:**
1. Confirm: `/readyz` → `"db":false`; check provider status / connection count / disk space.
2. Tell scorers: keep scoring on paper with over and ball numbers; enter the balls in order when the database returns.
3. Managed DB: fail over to the replica (promote). Self-managed: restart. If data is lost, restore with point-in-time recovery.
4. After recovery, scorers enter the backlog; each ball refreshes the snapshot. Verify the scorecard against the paper record.

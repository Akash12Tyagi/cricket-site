# Redis down

**What fans see:** nothing. Drill result: 10,000 viewers polling, Redis stopped for 15 s → p95 2.1 ms, 0 errors, 0 dropped.
Each API process keeps a 1-second in-memory copy of every live snapshot and rebuilds it from Postgres once per second (single-flight).

**What breaks:** per-IP rate limiting fails open (by design: `skipOnError`), so login and search are only protected by the per-email and
per-code limits in Postgres during the outage. Snapshots aren't shared between API instances (each rebuilds its own, about 1 query batch/s each).

**Do:**
1. Confirm: `/readyz` → `"redis":false`.
2. Restart or fail over Redis (managed service: trigger failover). No data needs restoring: Redis only holds caches and counters.
3. After recovery, no action: the next ball rebuilds the shared snapshot.
4. If the outage lasts long during a big match, watch Postgres CPU (each API instance rebuilds snapshots once per second per live match).

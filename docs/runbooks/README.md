# Runbooks

Step-by-step guides for on-call. Each one says what fans see, how to confirm it, and what to do.
Everything here was exercised in the Phase 4 drills (results in `../PHASE4-REPORT.md`).

| Situation | Runbook |
|---|---|
| Big match coming (pre-flight) | [big-match-checklist.md](big-match-checklist.md) |
| Site slow or erroring | [site-degraded.md](site-degraded.md) |
| Redis down | [redis-down.md](redis-down.md) |
| Postgres down | [postgres-down.md](postgres-down.md) |
| API down / bad deploy | [api-down-and-rollback.md](api-down-and-rollback.md) |
| Scorer problems | [scorer-problems.md](scorer-problems.md) |
| Security incident (login abuse, leaked secret) | [security-incident.md](security-incident.md) |

**Health endpoints:** `GET /healthz` (process alive; use for liveness, never restarts on dependency blips) and `GET /readyz` (`{"db":true,"redis":true}`; use for load-balancer readiness and alerts).

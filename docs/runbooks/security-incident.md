# Security incident

**Login abuse (code spam / brute force)**
- Limits: 5 code requests/min and 10 verifies/min per IP; 3 codes per email per 15 min; 5 attempts per code; codes expire in 10 min.
- Per-IP limits rely on the real client IP: production must set `CLIENT_IP_HEADER` (e.g. `cf-connecting-ip`) **and** firewall the origin
  so only the CDN can reach it. Otherwise IPs can be spoofed (Phase 4 finding) or everyone shares one IP.
- Escalate at the edge: CDN/WAF rate rule or challenge on `/api/v1/auth/*`.

**Leaked secret**
- `AUTH_SECRET` leaked → rotate it. This invalidates every session and every pending login code (they are HMACs keyed by it): everyone logs in again.
- `REVALIDATE_SECRET` leaked → rotate on both web and API; worst case before rotation is extra cache refreshes (no data exposure).
- Database credentials leaked → rotate, review `audit_logs` and `pg_stat_activity`.

**Suspicious admin activity**
- Every scoring, news and role change is in `audit_logs` (actor, action, entity, time). Roles can only be changed from the server shell (`set-role`).
- Demote with `pnpm --filter @cricket/db set-role <email> fan` and log out all their sessions:
  `delete from sessions where user_id = (select id from users where email = '<email>');`

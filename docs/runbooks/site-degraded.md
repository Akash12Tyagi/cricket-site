# Site slow or erroring

1. **Is it everyone or some?** Check CDN dashboard 5xx and latency by region. One region only → CDN/provider status page.
2. **Origin health:** `curl https://api.<domain>/readyz` on each instance.
   - `db:false` → [postgres-down.md](postgres-down.md); `redis:false` → [redis-down.md](redis-down.md).
3. **Traffic spike?** Requests/s far above normal while CDN hit ratio drops:
   - Check that cache rules are applied (look for `cf-cache-status: HIT` / `age` headers on `/api/v1/matches/<id>/live`).
   - Scale out API and web (they are stateless). Each API process served about **1,000 polls/s at p95 2.7 ms** in tests.
4. **Rate-limit complaints ("too many requests")** from many users on one network:
   - Public read routes are intentionally not rate-limited per IP (carrier NAT). If 429s appear on them, someone changed `apps/api/src/plugins/public.ts`.
   - Login/search 429s for everyone at once usually means the API sees the CDN's IP as the client: check `CLIENT_IP_HEADER` and the origin firewall.
5. **Recently deployed?** → [api-down-and-rollback.md](api-down-and-rollback.md).

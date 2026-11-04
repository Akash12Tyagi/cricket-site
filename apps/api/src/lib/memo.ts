/**
 * Tiny per-process cache with single-flight (plan §4.4: "if Redis is down, serve from the database with a
 * short in-memory cache"). Found necessary by the Redis-outage drill: without it every poll rebuilt the
 * snapshot from Postgres and latency went from ~3 ms to 3–7 s.
 *
 * - Fresh hits are served from memory for `ttlMs`.
 * - Concurrent misses for the same key share ONE in-flight load (no thundering herd).
 * - If a load fails, the last good value is served for up to `staleMs` (stale beats down).
 */
export function createMemo<T>(opts: { ttlMs: number; staleMs: number; max: number }) {
  const store = new Map<string, { value: T; at: number }>();
  const inflight = new Map<string, Promise<T>>();

  const set = (key: string, value: T) => {
    if (store.size >= opts.max && !store.has(key)) store.delete(store.keys().next().value!); // drop oldest
    store.set(key, { value, at: Date.now() });
  };

  async function get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = store.get(key);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < opts.ttlMs) return hit.value;
    let p = inflight.get(key);
    if (!p) {
      p = load().then((v) => { set(key, v); return v; }).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    try {
      return await p;
    } catch (err) {
      if (hit && age < opts.staleMs) return hit.value;
      throw err;
    }
  }

  return { get, set, delete: (key: string) => store.delete(key), size: () => store.size };
}

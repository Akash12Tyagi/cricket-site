// Load test: fans watching a live match (plan §8.4).
// N viewers polling every 10 s ≈ N/10 requests per second, so we drive the *rate* directly
// (10k viewers = 1,000 rps, 50k spike = 5,000 rps) instead of simulating 10k browsers.
//
//   docker run --rm -i -v "$PWD/loadtest:/scripts" grafana/k6 run /scripts/live-match.js \
//     -e BASE=http://host.docker.internal:4000 -e MATCH=<id-or-slug> -e VIEWERS=10000 -e DURATION=60s
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE ?? "http://host.docker.internal:4000";
const PATH = __ENV.PATH_PREFIX ?? ""; // "/api" when going through the Next.js proxy
const MATCH = __ENV.MATCH;
const VIEWERS = Number(__ENV.VIEWERS ?? 10000);
const SPIKE = Number(__ENV.SPIKE ?? 0); // e.g. 50000 → ramps to 5× traffic after the steady phase
const DURATION = __ENV.DURATION ?? "60s";
const rate = (viewers) => Math.round(viewers / 10);

const notModified = new Counter("status_304");
const ok = new Counter("status_200");
const limited = new Counter("status_429");
const failed = new Counter("status_5xx_or_error");
const liveLatency = new Trend("live_latency", true);

const scenarios = {
  steady: {
    executor: "constant-arrival-rate", rate: rate(VIEWERS), timeUnit: "1s", duration: DURATION,
    preAllocatedVUs: 300, maxVUs: 3000,
  },
};
if (SPIKE) {
  scenarios.spike = {
    executor: "ramping-arrival-rate", startTime: DURATION, startRate: rate(VIEWERS), timeUnit: "1s",
    preAllocatedVUs: 600, maxVUs: 6000,
    stages: [{ target: rate(SPIKE), duration: "15s" }, { target: rate(SPIKE), duration: "30s" }, { target: rate(VIEWERS), duration: "10s" }],
  };
}

export const options = {
  scenarios,
  discardResponseBodies: false,
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
  thresholds: {
    live_latency: ["p(95)<200"], // plan §1: p95 < 200 ms at origin
    status_5xx_or_error: ["count<1"],
  },
};

// Each VU remembers the version it saw, like a browser tab does.
let etag = "";
export default function () {
  const res = http.get(`${BASE}${PATH}/v1/matches/${MATCH}/live`, { headers: etag ? { "If-None-Match": etag } : {}, tags: { name: "live" } });
  liveLatency.add(res.timings.duration);
  if (res.status === 304) notModified.add(1);
  else if (res.status === 200) { ok.add(1); etag = res.headers["Etag"] ?? etag; }
  else if (res.status === 429) limited.add(1);
  else failed.add(1);
  check(res, { "200 or 304": (r) => r.status === 200 || r.status === 304 });
}

// Load test: fans opening pages (HTML) through the Next.js server.
// 10k fans arriving within a minute ≈ 170 page loads/s. Pages are ISR-cached, so this mostly measures
// how well caching holds up; in production the CDN serves these and the origin sees very little.
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE ?? "http://host.docker.internal:3100";
const PAGES = (__ENV.PAGES ?? "/").split(",");
export const options = {
  scenarios: { arrivals: { executor: "constant-arrival-rate", rate: Number(__ENV.RATE ?? 170), timeUnit: "1s", duration: __ENV.DURATION ?? "45s", preAllocatedVUs: 200, maxVUs: 2000 } },
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
  thresholds: { http_req_failed: ["rate<0.001"], http_req_duration: ["p(95)<500"] },
};
export default function () {
  const path = PAGES[Math.floor(Math.random() * PAGES.length)];
  const res = http.get(`${BASE}${path}`, { tags: { name: path } });
  check(res, { "status 200": (r) => r.status === 200, "has content": (r) => (r.body?.length ?? 0) > 1000 });
}

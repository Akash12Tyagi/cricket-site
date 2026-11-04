import { describe, expect, it } from "vitest";
import { clientIp } from "../src/app.js";

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => ({ ip: "10.0.0.5", headers });
  it("uses the socket IP when no CDN header is configured, ignoring client headers", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.6.7.8" }))).toBe("10.0.0.5");
  });
  it("uses the configured CDN header", () => {
    expect(clientIp(req({ "cf-connecting-ip": "5.6.7.8" }), "cf-connecting-ip")).toBe("5.6.7.8");
    expect(clientIp(req({ "cf-connecting-ip": "5.6.7.8, 9.9.9.9" }), "cf-connecting-ip")).toBe("5.6.7.8");
  });
  it("falls back to the socket IP when the header is missing or absurd", () => {
    expect(clientIp(req({}), "cf-connecting-ip")).toBe("10.0.0.5");
    expect(clientIp(req({ "cf-connecting-ip": "x".repeat(100) }), "cf-connecting-ip")).toBe("10.0.0.5");
  });
});

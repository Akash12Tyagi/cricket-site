import { describe, expect, it } from "vitest";
import { generateCode, generateSessionToken, hmac, safeEqualHex } from "../src/lib/crypto.js";

describe("crypto helpers", () => {
  it("generates 6-digit codes", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
  it("generates unguessable session tokens", () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSessionToken()).not.toBe(t);
  });
  it("hmac is keyed and purpose-scoped", () => {
    expect(hmac("k1", "otp", "x")).not.toBe(hmac("k2", "otp", "x"));
    expect(hmac("k1", "otp", "x")).not.toBe(hmac("k1", "session", "x"));
  });
  it("compares in constant time and handles length mismatch", () => {
    const h = hmac("k", "p", "v");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hmac("k", "p", "w"))).toBe(false);
    expect(safeEqualHex(h, "abcd")).toBe(false);
  });
});

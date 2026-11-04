import { describe, expect, it } from "vitest";
import { requestCodeSchema, verifyCodeSchema } from "./auth.ts";

describe("auth schemas", () => {
  it("normalises email", () => {
    expect(requestCodeSchema.parse({ email: "  Fan@Example.COM " }).email).toBe("fan@example.com");
  });
  it("rejects bad email", () => {
    expect(requestCodeSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });
  it("accepts only 6-digit codes", () => {
    expect(verifyCodeSchema.safeParse({ email: "a@b.co", code: "123456" }).success).toBe(true);
    expect(verifyCodeSchema.safeParse({ email: "a@b.co", code: "12345a" }).success).toBe(false);
    expect(verifyCodeSchema.safeParse({ email: "a@b.co", code: "1234567" }).success).toBe(false);
  });
});

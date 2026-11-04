import { describe, expect, it } from "vitest";
import { safeNext } from "./client-session";

describe("safeNext (open-redirect guard after login)", () => {
  it.each([["/teams/india", "/teams/india"], ["/account?tab=follows", "/account?tab=follows"]])("allows %s", (input, out) => expect(safeNext(input)).toBe(out));
  it.each([["//evil.com"], ["/\\evil.com"], ["https://evil.com"], ["javascript:alert(1)"], [""], [null]])("blocks %s", (input) => expect(safeNext(input)).toBe("/"));
});

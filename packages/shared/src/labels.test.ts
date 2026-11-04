import { describe, expect, it } from "vitest";
import { formatLabel, venueLabel } from "./cricket.ts";

describe("display labels", () => {
  it("formats match formats for people", () => {
    expect(formatLabel("LIST_A")).toBe("List A");
    expect(formatLabel("TEST")).toBe("Test");
    expect(formatLabel("UNKNOWN")).toBe("UNKNOWN");
  });
  it("doesn't repeat the city when the venue name contains it", () => {
    expect(venueLabel("Gaddafi Stadium, Lahore", "Lahore")).toBe("Gaddafi Stadium, Lahore");
    expect(venueLabel("Eden Gardens", "Kolkata")).toBe("Eden Gardens, Kolkata");
    expect(venueLabel("Lord's", null)).toBe("Lord's");
  });
});

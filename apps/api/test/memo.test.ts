import { describe, expect, it } from "vitest";
import { createMemo } from "../src/lib/memo.js";

describe("memo cache", () => {
  it("serves fresh values from memory and shares one load between concurrent misses", async () => {
    const m = createMemo<number>({ ttlMs: 1000, staleMs: 10_000, max: 10 });
    let loads = 0;
    const load = () => new Promise<number>((r) => setTimeout(() => r(++loads), 20));
    const results = await Promise.all(Array.from({ length: 500 }, () => m.get("k", load)));
    expect(new Set(results)).toEqual(new Set([1]));
    expect(loads).toBe(1);
    expect(await m.get("k", load)).toBe(1); // still fresh
  });

  it("serves the last good value when a reload fails, within the stale window", async () => {
    const m = createMemo<string>({ ttlMs: 0, staleMs: 10_000, max: 10 });
    await m.get("k", async () => "good");
    expect(await m.get("k", async () => { throw new Error("db down"); })).toBe("good");
    const strict = createMemo<string>({ ttlMs: 0, staleMs: 0, max: 10 });
    await strict.get("k", async () => "good");
    await expect(strict.get("k", async () => { throw new Error("db down"); })).rejects.toThrow("db down");
  });

  it("evicts the oldest entry when full", async () => {
    const m = createMemo<number>({ ttlMs: 60_000, staleMs: 60_000, max: 2 });
    await m.get("a", async () => 1); await m.get("b", async () => 2); await m.get("c", async () => 3);
    expect(m.size()).toBe(2);
    let reloaded = false;
    await m.get("a", async () => { reloaded = true; return 1; });
    expect(reloaded).toBe(true);
  });
});

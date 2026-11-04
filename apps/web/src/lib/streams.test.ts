import { describe, expect, it } from "vitest";
import type { PublicStream } from "./api";
import { nextServer, orderServers } from "./streams";

const s = (id: string, status: PublicStream["status"], region = "WW"): PublicStream => ({ id, kind: "hls", label: id, region, status, checkedAt: null, url: "https://x.test/a.m3u8" });

describe("orderServers", () => {
  it("puts proven-live first, then available, replay; hides offline when something works", () => {
    expect(orderServers([s("a", "offline"), s("b", "vod"), s("c", "live"), s("d", "unknown")], null).map((x) => x.id)).toEqual(["c", "d", "b"]);
  });
  it("prefers the visitor's own territory, keeps worldwide, drops other territories", () => {
    expect(orderServers([s("ww", "live"), s("in", "live", "IN"), s("gb", "live", "GB")], "IN").map((x) => x.id)).toEqual(["in", "ww"]);
    expect(orderServers([s("ww", "live"), s("in", "live", "IN")], null).map((x) => x.id)).toEqual(["ww", "in"]); // unknown territory: show all
  });
  it("shows offline servers only when nothing else exists, so the viewer can see why", () => {
    expect(orderServers([s("a", "offline")], null).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("nextServer", () => {
  it("walks the order skipping failed servers, then gives up", () => {
    const order = [s("a", "live"), s("b", "unknown"), s("c", "vod")];
    expect(nextServer(order, new Set(["a"]))!.id).toBe("b");
    expect(nextServer(order, new Set(["a", "b"]))!.id).toBe("c");
    expect(nextServer(order, new Set(["a", "b", "c"]))).toBeNull();
  });
});

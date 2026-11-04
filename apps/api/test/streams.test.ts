import { describe, expect, it } from "vitest";
import { embedProvider } from "../src/streams/embed.js";
import { hlsProvider, parsePlaylist, withToken } from "../src/streams/hls.js";
import { hostAllowed, parseHosts, type StreamConfig } from "../src/streams/types.js";
import { youtubeProvider } from "../src/streams/youtube.js";
import { rankOf, toPublic } from "../src/streams/index.js";

const cfg = (over: Partial<StreamConfig> = {}): StreamConfig => ({ hlsHosts: ["media.example-cdn.com"], embedHosts: ["player.board.example"], tokenParam: "token", secrets: {}, ...over });
const reply = (body: string, status = 200, url = "https://media.example-cdn.com/x.m3u8") => { const r = new Response(body, { status }); Object.defineProperty(r, "url", { value: url }); return r; };
const src = (over = {}) => ({ url: "https://media.example-cdn.com/live/match.m3u8", authEnv: null, checkState: null, lastCheckedAt: null as Date | null, ...over });
const media = (seq: number, extra = "", segs = 3) => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:${seq}\n${Array.from({ length: segs }, (_, k) => `#EXTINF:6.0,\nseg${seq + k}.ts`).join("\n")}\n${extra}`;
const fetcher = (map: Record<string, Response | (() => Response)>) => (async (u: string) => { const hit = Object.entries(map).find(([k]) => u.startsWith(k)); if (!hit) throw new Error("no route"); return typeof hit[1] === "function" ? hit[1]() : hit[1].clone(); }) as unknown as typeof fetch;

describe("hosts", () => {
  it("parses and matches allow-lists (exact or subdomain)", () => {
    expect(parseHosts(" Media.Example.com, https://b.test/path ,bad host")).toEqual(["media.example.com", "b.test"]);
    expect(hostAllowed("a.media.example.com", ["media.example.com"])).toBe(true);
    expect(hostAllowed("evilmedia.example.com", ["media.example.com"])).toBe(false);
  });
});

describe("playlist parsing", () => {
  it("reads media playlists, master playlists and end markers", () => {
    expect(parsePlaylist("<html>")).toBeNull();
    expect(parsePlaylist(media(100))).toMatchObject({ isMaster: false, segments: 3, mediaSequence: 100, targetDuration: 6, endlist: false });
    expect(parsePlaylist(media(1, "#EXT-X-ENDLIST"))!.endlist).toBe(true);
    expect(parsePlaylist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhi/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nlow/index.m3u8")).toMatchObject({ isMaster: true, variants: ["hi/index.m3u8", "low/index.m3u8"] });
  });
});

describe("HLS source validation", () => {
  it("accepts only https .m3u8 on allowed hosts and rejects credentials in the URL", () => {
    expect(hlsProvider.validate("https://media.example-cdn.com/a/b.m3u8", cfg())).toBeNull();
    expect(hlsProvider.validate("http://media.example-cdn.com/a.m3u8", cfg())).toMatch(/https/);
    expect(hlsProvider.validate("https://other.com/a.m3u8", cfg())).toMatch(/STREAM_HLS_HOSTS/);
    expect(hlsProvider.validate("https://media.example-cdn.com/a.mp4", cfg())).toMatch(/m3u8/);
    expect(hlsProvider.validate("https://u:p@media.example-cdn.com/a.m3u8", cfg())).toMatch(/credentials/);
    expect(hlsProvider.validate("https://media.example-cdn.com/a.m3u8", cfg({ hlsHosts: [] }))).toMatch(/disabled/);
  });
  it("appends the server-held token, and reports missing credentials instead of guessing", () => {
    expect(withToken("https://media.example-cdn.com/a.m3u8", "STREAM_TOKEN_X", cfg({ secrets: { STREAM_TOKEN_X: "abc" } }))).toBe("https://media.example-cdn.com/a.m3u8?token=abc");
    expect(withToken("https://media.example-cdn.com/a.m3u8", "STREAM_TOKEN_X", cfg())).toBeNull();
  });
});

describe("HLS verification: LIVE is only claimed when proven", () => {
  const url = "https://media.example-cdn.com/live/match.m3u8";
  it("ended playlist is vod, never live", async () => {
    const r = await hlsProvider.verify(src(), cfg(), fetcher({ [url]: reply(media(1, "#EXT-X-ENDLIST")) }));
    expect(r.status).toBe("vod");
  });
  it("first check of a live-looking playlist without timestamps is only 'unknown'", async () => {
    const r = await hlsProvider.verify(src(), cfg(), fetcher({ [url]: reply(media(500)) }));
    expect(r.status).toBe("unknown");
    expect(r.state).toEqual({ mediaSequence: 500 });
  });
  it("becomes live when the playlist advances between checks", async () => {
    const r = await hlsProvider.verify(src({ checkState: { mediaSequence: 500 }, lastCheckedAt: new Date(Date.now() - 60_000) }), cfg(), fetcher({ [url]: reply(media(504)) }));
    expect(r.status).toBe("live");
  });
  it("a frozen playlist (sequence not advancing) stays unknown", async () => {
    const r = await hlsProvider.verify(src({ checkState: { mediaSequence: 504 }, lastCheckedAt: new Date(Date.now() - 60_000) }), cfg(), fetcher({ [url]: reply(media(504)) }));
    expect(r.status).toBe("unknown");
  });
  it("a fresh program-date-time proves live on the first check; a stale one does not", async () => {
    const stamp = (ago: number) => `#EXT-X-PROGRAM-DATE-TIME:${new Date(Date.now() - ago).toISOString()}\n`;
    const fresh = media(1).replace("#EXTINF:6.0,\nseg3.ts", `${stamp(4000)}#EXTINF:6.0,\nseg3.ts`);
    const stale = media(1).replace("#EXTINF:6.0,\nseg3.ts", `${stamp(600_000)}#EXTINF:6.0,\nseg3.ts`);
    expect((await hlsProvider.verify(src(), cfg(), fetcher({ [url]: reply(fresh) }))).status).toBe("live");
    expect((await hlsProvider.verify(src(), cfg(), fetcher({ [url]: reply(stale) }))).status).toBe("unknown");
  });
  it("follows a master playlist to its first variant", async () => {
    const r = await hlsProvider.verify(src(), cfg(), fetcher({ [url]: reply("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv1/index.m3u8"), "https://media.example-cdn.com/live/v1/": reply(media(1, "#EXT-X-ENDLIST")) }));
    expect(r.status).toBe("vod");
  });
  it("reports provider refusals, outages and bad responses without leaking the URL or token", async () => {
    const secrets = { STREAM_TOKEN_X: "TOPSECRET" };
    for (const [status, expected] of [[403, "offline"], [404, "offline"], [502, "offline"]] as const) {
      const r = await hlsProvider.verify(src({ authEnv: "STREAM_TOKEN_X" }), cfg({ secrets }), fetcher({ [url]: reply("x", status) }));
      expect(r.status).toBe(expected);
      expect(JSON.stringify(r)).not.toContain("TOPSECRET");
      expect(JSON.stringify(r)).not.toContain("example-cdn");
    }
    expect((await hlsProvider.verify(src(), cfg(), fetcher({ [url]: reply("<html>not a playlist</html>") }))).status).toBe("error");
    expect((await hlsProvider.verify(src({ authEnv: "STREAM_TOKEN_X" }), cfg(), fetcher({}))).detail).toMatch(/credentials missing/);
  });
  it("refuses a redirect to a host that isn't allowed", async () => {
    const r = await hlsProvider.verify(src(), cfg(), fetcher({ [url]: () => reply(media(1), 200, "https://evil.example/hijack.m3u8") }));
    expect(r.status).toBe("error");
  });
});

describe("YouTube and embed sources", () => {
  it("validates links", () => {
    expect(youtubeProvider.validate("https://youtu.be/dQw4w9WgXcQ", cfg())).toBeNull();
    expect(youtubeProvider.validate("https://example.com/watch?v=dQw4w9WgXcQ", cfg())).toMatch(/YouTube/);
    expect(embedProvider.validate("https://player.board.example/live/1", cfg())).toBeNull();
    expect(embedProvider.validate("https://elsewhere.test/live/1", cfg())).toMatch(/STREAM_EMBED_HOSTS/);
  });
  it("embeds can never be 'live', only reachable", async () => {
    const r = await embedProvider.verify(src({ url: "https://player.board.example/live/1" }), cfg(), fetcher({ "https://player.board.example/": reply("ok", 200, "https://player.board.example/live/1") }));
    expect(r.status).toBe("unknown");
  });
});

describe("public shape", () => {
  const row = { id: "i", matchId: "m", seriesId: null, kind: "hls", label: "Server 1", url: "https://media.example-cdn.com/a.m3u8", region: "IN", priority: 0, rightsNote: "contract #7", enabled: true, authEnv: "STREAM_TOKEN_X", lastCheckedAt: null, lastStatus: null, lastDetail: null, checkState: null, createdBy: null, createdAt: new Date(), updatedAt: new Date() };
  it("never exposes the rights note, token variable, token, or the URL of a token-protected stream", () => {
    const p = toPublic(row);
    expect(p).toMatchObject({ needsToken: true, status: "pending" });
    expect(JSON.stringify(p)).not.toMatch(/contract|STREAM_TOKEN|media\.example/);
    expect(toPublic({ ...row, authEnv: null }).url).toBe(row.url);
  });
  it("orders live before unknown before replay before offline", () => {
    expect(["offline", "vod", "live", "unknown", null].sort((a, b) => rankOf(a) - rankOf(b))).toEqual(["live", "unknown", null, "vod", "offline"]);
  });
});

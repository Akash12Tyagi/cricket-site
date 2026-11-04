import { describe, expect, it } from "vitest";
import { checkEmbeddable, parseChannelFeed, youtubeIdFromUrl } from "../src/feed/youtube.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>ICC</title>
 <entry>
  <id>yt:video:AAAAAAAAAAA</id><yt:videoId>AAAAAAAAAAA</yt:videoId><yt:channelId>UCt2JXOLNxqry7B_4rRZME3Q</yt:channelId>
  <title>Highlights | India v Australia &amp; more &#39;quotes&#39;</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/>
  <published>2026-10-26T07:30:13+00:00</published>
 </entry>
 <entry>
  <yt:videoId>BBBBBBBBBBB</yt:videoId><yt:channelId>UCt2JXOLNxqry7B_4rRZME3Q</yt:channelId>
  <title>🔴 LIVE : Toronto v Montreal</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/BBBBBBBBBBB"/>
  <published>2026-10-25T07:30:13+00:00</published>
 </entry>
 <entry><yt:videoId>bad id!</yt:videoId><title>x</title><published>2026-10-25T07:30:13+00:00</published></entry>
</feed>`;

describe("YouTube channel feed", () => {
  it("parses entries, decodes entities and flags shorts/live", () => {
    const e = parseChannelFeed(FEED);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ youtubeId: "AAAAAAAAAAA", channelName: "ICC", title: "Highlights | India v Australia & more 'quotes'", isShort: false, isLive: false });
    expect(e[1]).toMatchObject({ youtubeId: "BBBBBBBBBBB", isShort: true, isLive: true });
  });
});

describe("youtubeIdFromUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=3", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", null], // https only
    ["https://evil.example/watch?v=dQw4w9WgXcQ", null],
    ["https://www.youtube.com/watch?v=short", null],
    ["javascript:alert(1)", null],
  ])("%s → %s", (input, expected) => expect(youtubeIdFromUrl(input)).toBe(expected));
});

describe("checkEmbeddable", () => {
  const fake = (status: number, body: object = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("trusts YouTube's oEmbed answer and reports 'unknown' on outages", async () => {
    expect(await checkEmbeddable("dQw4w9WgXcQ", fake(200, { title: "T", author_name: "ICC" }))).toEqual({ embeddable: true, title: "T", channelName: "ICC" });
    expect(await checkEmbeddable("dQw4w9WgXcQ", fake(401))).toEqual({ embeddable: false });
    expect(await checkEmbeddable("dQw4w9WgXcQ", fake(503))).toBeNull();
  });
});

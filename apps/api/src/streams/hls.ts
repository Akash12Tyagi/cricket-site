import { hostAllowed, type CheckResult, type SourceInput, type StreamConfig, type StreamProvider } from "./types.js";

/** What we need from an HLS playlist. */
export type Playlist = {
  isMaster: boolean; variants: string[]; endlist: boolean; segments: number; mediaSequence: number; targetDuration: number; lastProgramDate: Date | null;
};

/** Minimal RFC 8216 reader: enough to tell master from media playlists and live from ended. Pure; unit-tested. */
export function parsePlaylist(text: string): Playlist | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") return null;
  const p: Playlist = { isMaster: false, variants: [], endlist: false, segments: 0, mediaSequence: 0, targetDuration: 0, lastProgramDate: null };
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("#EXT-X-STREAM-INF")) { p.isMaster = true; const next = lines[i + 1]; if (next && !next.startsWith("#")) p.variants.push(next); }
    else if (l === "#EXT-X-ENDLIST") p.endlist = true;
    else if (l.startsWith("#EXT-X-MEDIA-SEQUENCE:")) p.mediaSequence = Number(l.split(":")[1]) || 0;
    else if (l.startsWith("#EXT-X-TARGETDURATION:")) p.targetDuration = Number(l.split(":")[1]) || 0;
    else if (l.startsWith("#EXTINF")) p.segments++;
    else if (l.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) { const d = new Date(l.slice(l.indexOf(":") + 1)); if (!Number.isNaN(d.getTime())) p.lastProgramDate = d; }
  }
  return p;
}

/** The URL we fetch: the stored one, plus the provider's access token (from the server environment) when one is configured. */
export function withToken(url: string, authEnv: string | null, cfg: StreamConfig): string | null {
  if (!authEnv) return url;
  const token = cfg.secrets[authEnv];
  if (!token) return null;
  const u = new URL(url);
  u.searchParams.set(cfg.tokenParam, token);
  return u.toString();
}

async function getText(url: string, cfg: StreamConfig, fetchImpl: typeof fetch): Promise<{ ok: true; text: string } | { ok: false; detail: string; offline: boolean }> {
  let res: Response;
  try { res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/vnd.apple.mpegurl, */*" } }); }
  catch { return { ok: false, detail: "could not connect", offline: true }; }
  // Redirects may only land on hosts we've been told to trust.
  try { if (res.url && !hostAllowed(new URL(res.url).hostname, cfg.hlsHosts)) return { ok: false, detail: "redirected to a host that isn't allowed", offline: false }; } catch { /* keep going */ }
  if (res.status === 401 || res.status === 403) return { ok: false, detail: `provider refused access (HTTP ${res.status}): check the token or territory`, offline: true };
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, offline: true };
  return { ok: true, text: (await res.text()).slice(0, 512 * 1024) };
}

const FRESH_AFTER_MS = 10 * 60_000;

export const hlsProvider: StreamProvider = {
  kind: "hls",
  validate(url, cfg) {
    let u: URL;
    try { u = new URL(url); } catch { return "not a valid URL"; }
    if (u.protocol !== "https:") return "must be an https:// URL";
    if (u.username || u.password) return "must not contain credentials: use a STREAM_TOKEN_* variable";
    if (!/\.m3u8$/i.test(u.pathname)) return "an HLS stream URL ends in .m3u8";
    if (cfg.hlsHosts.length === 0) return "HLS playback is disabled: set STREAM_HLS_HOSTS";
    if (!hostAllowed(u.hostname, cfg.hlsHosts)) return `host ${u.hostname} isn't in STREAM_HLS_HOSTS`;
    return null;
  },

  /**
   * Live is claimed only when proven: no end marker, segments present, and either the newest segment carries a fresh
   * program-date-time or the media sequence has advanced since the last check. The first check of a stream with no
   * timestamps is "unknown" (reachable, not yet proven live). An ended playlist is "vod".
   */
  async verify(src: SourceInput, cfg, fetchImpl): Promise<CheckResult> {
    const first = withToken(src.url, src.authEnv, cfg);
    if (!first) return { status: "error", detail: `credentials missing: ${src.authEnv} is not set on the server` };
    const a = await getText(first, cfg, fetchImpl);
    if (!a.ok) return { status: a.offline ? "offline" : "error", detail: a.detail };
    let pl = parsePlaylist(a.text);
    if (!pl) return { status: "error", detail: "not an HLS playlist" };
    if (pl.isMaster) {
      const variant = pl.variants[0];
      if (!variant) return { status: "error", detail: "master playlist has no variants" };
      const base = new URL(src.url);
      const next = new URL(variant, base);
      if (!hostAllowed(next.hostname, cfg.hlsHosts)) return { status: "error", detail: "variant playlist is on a host that isn't allowed" };
      if (src.authEnv && !next.searchParams.has(cfg.tokenParam)) next.searchParams.set(cfg.tokenParam, cfg.secrets[src.authEnv] ?? "");
      const b = await getText(next.toString(), cfg, fetchImpl);
      if (!b.ok) return { status: b.offline ? "offline" : "error", detail: b.detail };
      pl = parsePlaylist(b.text);
      if (!pl || pl.isMaster) return { status: "error", detail: "variant playlist is not a media playlist" };
    }
    if (pl.segments === 0) return { status: "error", detail: "playlist has no segments yet" };
    const state = { mediaSequence: pl.mediaSequence };
    if (pl.endlist) return { status: "vod", detail: "playable, not live (playlist has ended)", state };
    const prev = (src.checkState as { mediaSequence?: number } | null)?.mediaSequence;
    const recent = src.lastCheckedAt && Date.now() - src.lastCheckedAt.getTime() < FRESH_AFTER_MS;
    const slack = Math.max(30_000, (pl.targetDuration || 6) * 3000);
    if (pl.lastProgramDate && Date.now() - pl.lastProgramDate.getTime() < slack + 10_000 && Date.now() - pl.lastProgramDate.getTime() > -60_000) {
      return { status: "live", detail: "live: newest segment is current", state };
    }
    if (recent && typeof prev === "number" && pl.mediaSequence > prev) return { status: "live", detail: "live: playlist is advancing", state };
    return { status: "unknown", detail: "reachable; waiting to confirm it is live", state };
  },
};

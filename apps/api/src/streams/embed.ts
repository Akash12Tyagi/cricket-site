import { hostAllowed, type CheckResult, type SourceInput, type StreamConfig, type StreamProvider } from "./types.js";

/**
 * A provider-approved iframe player (an official broadcaster's embed page). We can prove the page is reachable but not
 * that its video is live, so the best verdict is "unknown": the player never claims LIVE for an embed.
 */
export const embedProvider: StreamProvider = {
  kind: "embed",
  validate(url, cfg) {
    let u: URL;
    try { u = new URL(url); } catch { return "not a valid URL"; }
    if (u.protocol !== "https:") return "must be an https:// URL";
    if (u.username || u.password) return "must not contain credentials";
    if (cfg.embedHosts.length === 0) return "embedded players are disabled: set STREAM_EMBED_HOSTS";
    if (!hostAllowed(u.hostname, cfg.embedHosts)) return `host ${u.hostname} isn't in STREAM_EMBED_HOSTS`;
    return null;
  },
  async verify(src: SourceInput, cfg: StreamConfig, fetchImpl): Promise<CheckResult> {
    try {
      const res = await fetchImpl(src.url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
      if (res.url && !hostAllowed(new URL(res.url).hostname, cfg.embedHosts)) return { status: "error", detail: "redirected to a host that isn't allowed" };
      if (res.status >= 500) return { status: "offline", detail: `HTTP ${res.status}` };
      if (res.status >= 400) return { status: "offline", detail: `provider answered HTTP ${res.status}` };
      return { status: "unknown", detail: "page reachable; the provider's player decides if it is live" };
    } catch { return { status: "offline", detail: "could not connect" }; }
  },
};

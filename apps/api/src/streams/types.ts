export type StreamKind = "youtube" | "hls" | "embed";
/** live = verified live; vod = playable but not live (replay/test); unknown = reachable, liveness unproven; offline/error = not playable. */
export type StreamStatus = "live" | "vod" | "unknown" | "offline" | "error";
export type CheckResult = { status: StreamStatus; detail: string; state?: Record<string, unknown> };

export interface StreamConfig {
  hlsHosts: string[];
  embedHosts: string[];
  tokenParam: string;
  youtubeApiKey?: string;
  /** Where STREAM_TOKEN_* secrets are read from. Injected so tests never touch the real environment. */
  secrets: Record<string, string | undefined>;
}

/** The fields of a stored source that providers look at. */
export interface SourceInput { url: string; authEnv: string | null; checkState: unknown; lastCheckedAt: Date | null }

/**
 * One provider per kind of source. Adding a provider (another licensed CDN, a rights-holder's player) means one file
 * here plus a line in the registry: validation at save time, verification by the worker, and what the player receives.
 */
export interface StreamProvider {
  readonly kind: StreamKind;
  /** Returns an error message when the URL isn't acceptable (wrong host, not https, malformed), else null. */
  validate(url: string, cfg: StreamConfig): string | null;
  verify(src: SourceInput, cfg: StreamConfig, fetchImpl: typeof fetch): Promise<CheckResult>;
}

/** What the website receives for one source. Never contains rights notes, token variable names or tokens. */
export interface PublicStream {
  id: string; kind: StreamKind; label: string; region: string; status: StreamStatus | "pending"; checkedAt: string | null;
  youtubeId?: string; url?: string; needsToken?: boolean;
}

export const hostAllowed = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));
export const parseHosts = (raw: string) => raw.split(",").map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter((h) => /^[a-z0-9.-]+$/.test(h));

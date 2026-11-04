import { checkEmbeddable, youtubeIdFromUrl } from "../feed/youtube.js";
import type { CheckResult, SourceInput, StreamConfig, StreamProvider } from "./types.js";

export const youtubeUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** An official YouTube stream/video that its owner allows to be embedded. Playback is YouTube's own player. */
export const youtubeProvider: StreamProvider = {
  kind: "youtube",
  validate(url) { return youtubeIdFromUrl(url) ? null : "not a YouTube watch, live, shorts or youtu.be link"; },

  async verify(src: SourceInput, cfg: StreamConfig, fetchImpl): Promise<CheckResult> {
    const id = youtubeIdFromUrl(src.url);
    if (!id) return { status: "error", detail: "not a YouTube link" };
    const embed = await checkEmbeddable(id, fetchImpl);
    if (embed === null) return { status: "error", detail: "YouTube didn't answer; will retry" };
    if (!embed.embeddable) return { status: "offline", detail: "the owner doesn't allow embedding, or the video is gone" };
    if (!cfg.youtubeApiKey) return { status: "unknown", detail: "embeddable; add YOUTUBE_API_KEY to confirm it is live" };
    try {
      const qs = new URLSearchParams({ part: "snippet,liveStreamingDetails", id, key: cfg.youtubeApiKey });
      const res = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?${qs}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { status: "unknown", detail: `embeddable; YouTube API answered HTTP ${res.status}` };
      const item = ((await res.json()) as { items?: { snippet?: { liveBroadcastContent?: string }; liveStreamingDetails?: { actualEndTime?: string } }[] }).items?.[0];
      const kind = item?.snippet?.liveBroadcastContent;
      if (kind === "live") return { status: "live", detail: "live on YouTube" };
      if (kind === "upcoming") return { status: "unknown", detail: "scheduled on YouTube, not started" };
      return { status: "vod", detail: item?.liveStreamingDetails?.actualEndTime ? "stream has ended (replay)" : "playable, not live" };
    } catch { return { status: "unknown", detail: "embeddable; couldn't reach the YouTube API" }; }
  },
};

import { STRIVER_VIDEOS, type StriverVideo } from "@/data/striverVideos";
import { YOUTUBE_ID_RE } from "@/lib/video-validation";

/**
 * Helpers for the "Striver's Video Explanation" section.
 *
 * The mapping itself lives in data/striverVideos.ts (keyed by problem id, separate from the
 * problem data). Only YouTube video ids are stored; every URL is built here at runtime, so a
 * mapping edit never needs a UI change. A problem without a verified mapping simply returns
 * `undefined` — callers must show the "not available yet" state, never a guessed video.
 */

export function isValidYouTubeId(id: unknown): id is string {
  return typeof id === "string" && YOUTUBE_ID_RE.test(id);
}

/** Verified video for a problem id, or undefined (also for malformed entries). */
export function getStriverVideo(
  problemId: number,
  map: Readonly<Record<number, StriverVideo>> = STRIVER_VIDEOS
): StriverVideo | undefined {
  if (!Number.isInteger(problemId)) return undefined;
  const v = Object.prototype.hasOwnProperty.call(map, problemId) ? map[problemId] : undefined;
  return v && isValidYouTubeId(v.videoId) ? v : undefined;
}

export function hasStriverVideo(problemId: number): boolean {
  return getStriverVideo(problemId) !== undefined;
}

function startOf(v: Pick<StriverVideo, "start">): number | undefined {
  return typeof v.start === "number" && Number.isInteger(v.start) && v.start > 0 ? v.start : undefined;
}

/** https://www.youtube.com/watch?v=ID[&t=123s] — the "Open on YouTube" link. */
export function youtubeWatchUrl(v: Pick<StriverVideo, "videoId" | "start">): string {
  const start = startOf(v);
  return `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}${start ? `&t=${start}s` : ""}`;
}

/**
 * Official embed URL, privacy-enhanced mode (youtube-nocookie.com). No autoplay parameter:
 * the viewer presses play in YouTube's own player. `rel=0` keeps suggested videos to the
 * same channel.
 */
export function youtubeEmbedUrl(v: Pick<StriverVideo, "videoId" | "start">): string {
  const start = startOf(v);
  const params = new URLSearchParams({ rel: "0" });
  if (start) params.set("start", String(start));
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.videoId)}?${params.toString()}`;
}

/** "1:02:03" / "4:10" for a start offset in seconds. */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export { YOUTUBE_ID_RE };
export type { StriverVideo };

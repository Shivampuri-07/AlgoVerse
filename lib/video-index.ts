/**
 * Browser-safe video lookups: whether a problem has a Striver video, and its title. No video ids
 * here — videos are Pro-only and their YouTube links come from GET /api/resources/[id].
 */
import { STRIVER_VIDEO_TITLES } from "@/data/videoIndex";

export function hasStriverVideo(problemId: number): boolean {
  return Number.isInteger(problemId) && Object.prototype.hasOwnProperty.call(STRIVER_VIDEO_TITLES, problemId);
}

export function striverVideoTitle(problemId: number): string | null {
  return hasStriverVideo(problemId) ? STRIVER_VIDEO_TITLES[problemId] : null;
}

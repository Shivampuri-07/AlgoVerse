/**
 * SERVER-ONLY: Pro learning resources for a problem — the Striver video (in-app official YouTube
 * player + the YouTube link) and the explanation article link. Owner decision 2026-09-28: Pro-only
 * in-app player, accepting the YouTube API policy III.F.3 risk (see docs/SAAS_ARCHITECTURE.md). Only GET /api/resources/[id] calls this, after checking the session
 * and the "learningResources" entitlement.
 */
import { ARTICLES } from "@/data/articles";
import { getProblemById } from "@/data/problems";
import { formatTimestamp, getStriverVideo, youtubeWatchUrl } from "@/lib/videos";

export interface LearningResources {
  problemId: number;
  video: {
    title: string;
    /** Unchanged external link (opens on YouTube). */
    watchUrl: string;
    startsAt: string | null;
    /** For the in-app official YouTube player. Only ever sent to entitled users by this API. */
    embed: { videoId: string; start: number | null; embeddable: boolean };
  } | null;
  article: { url: string; source: string } | null;
}

export function getLearningResources(problemId: number): LearningResources | null {
  if (!getProblemById(problemId)) return null;
  const v = getStriverVideo(problemId);
  const a = ARTICLES[problemId];
  return {
    problemId,
    video: v
      ? {
          title: v.title,
          watchUrl: youtubeWatchUrl(v),
          startsAt: v.start ? formatTimestamp(v.start) : null,
          embed: { videoId: v.videoId, start: v.start && v.start > 0 ? v.start : null, embeddable: v.embeddable !== false },
        }
      : null,
    article: a ? { url: a.url, source: a.source } : null,
  };
}

/**
 * SERVER-ONLY: Pro learning resources for a problem — the Striver video link (opens on YouTube;
 * no embedded player, per the owner's decision and YouTube API policy III.F.3) and the
 * explanation article link. Only GET /api/resources/[id] calls this, after checking the session
 * and the "learningResources" entitlement.
 */
import { ARTICLES } from "@/data/articles";
import { getProblemById } from "@/data/problems";
import { formatTimestamp, getStriverVideo, youtubeWatchUrl } from "@/lib/videos";

export interface LearningResources {
  problemId: number;
  video: { title: string; watchUrl: string; startsAt: string | null } | null;
  article: { url: string; source: string } | null;
}

export function getLearningResources(problemId: number): LearningResources | null {
  if (!getProblemById(problemId)) return null;
  const v = getStriverVideo(problemId);
  const a = ARTICLES[problemId];
  return {
    problemId,
    video: v ? { title: v.title, watchUrl: youtubeWatchUrl(v), startsAt: v.start ? formatTimestamp(v.start) : null } : null,
    article: a ? { url: a.url, source: a.source } : null,
  };
}

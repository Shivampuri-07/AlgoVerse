/**
 * A2Z dataset validation.
 *
 *   npm run validate:data
 *
 * Runs with Node's built-in TypeScript type-stripping (Node >= 22.6), so no extra
 * dependency is needed. Exits with code 1 if any check fails.
 */
import { ARTICLES } from "../data/articles.ts";
import { a2zProblems } from "../data/a2zProblems.ts";
import { TOPICS } from "../data/topics.ts";
import { SHARED_LINK_GROUPS, REVIEWED_EQUIVALENTS } from "../data/a2zLinkReview.ts";
import { validateDataset, formatReport } from "../lib/dataset-validation.ts";
import { STRIVER_VIDEOS } from "../data/striverVideos.ts";
import { validateVideoMap, formatVideoReport } from "../lib/video-validation.ts";

const report = validateDataset(
  [...a2zProblems].sort((a, b) => a.order - b.order),
  TOPICS,
  { sharedLinkGroups: SHARED_LINK_GROUPS, reviewedEquivalents: REVIEWED_EQUIVALENTS },
  ARTICLES
);

const videos = validateVideoMap(STRIVER_VIDEOS, a2zProblems.map((p) => p.id));

console.log(formatReport(report));
console.log("");
console.log(formatVideoReport(videos));
if (!report.ok || !videos.ok) process.exit(1);

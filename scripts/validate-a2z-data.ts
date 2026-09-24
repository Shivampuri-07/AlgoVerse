/**
 * A2Z dataset validation.
 *
 *   npm run validate:data
 *
 * Runs with Node's built-in TypeScript type-stripping (Node >= 22.6), so no extra
 * dependency is needed. Exits with code 1 if any check fails.
 */
import { a2zProblems } from "../data/a2zProblems.ts";
import { TOPICS } from "../data/topics.ts";
import { SHARED_LINK_GROUPS, REVIEWED_EQUIVALENTS } from "../data/a2zLinkReview.ts";
import { validateDataset, formatReport } from "../lib/dataset-validation.ts";

const report = validateDataset([...a2zProblems].sort((a, b) => a.order - b.order), TOPICS, {
  sharedLinkGroups: SHARED_LINK_GROUPS,
  reviewedEquivalents: REVIEWED_EQUIVALENTS,
});

console.log(formatReport(report));
if (!report.ok) process.exit(1);

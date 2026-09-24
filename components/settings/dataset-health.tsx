"use client";

import * as React from "react";
import { CheckCircle2, XCircle, Database } from "lucide-react";
import { PROBLEMS } from "@/data/problems";
import { TOPICS } from "@/data/topics";
import { validateDataset } from "@/lib/dataset-validation";
import { REVIEWED_EQUIVALENTS, SHARED_LINK_GROUPS } from "@/data/a2zLinkReview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Live summary of the bundled dataset — same checks as `npm run validate:data`. */
export function DatasetHealth() {
  const report = React.useMemo(
    () =>
      validateDataset(PROBLEMS, TOPICS, {
        sharedLinkGroups: SHARED_LINK_GROUPS,
        reviewedEquivalents: REVIEWED_EQUIVALENTS,
      }),
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" /> Dataset health
        </CardTitle>
        <CardDescription>
          {report.total} entries ({report.practice} problems, {report.theoryItems} lessons) in {TOPICS.length} topics
          &middot; {report.links.leetcode} LeetCode &middot; {report.links.gfg} GFG &middot; {report.links.other}{" "}
          TakeUForward/other &middot; {report.links.articles} articles &middot; {report.links.code360} Code360
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {report.checks.map((c) => (
          <p key={c.name} className="flex items-start gap-2">
            {c.passed ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="passed" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="failed" />
            )}
            <span>
              {c.name}
              {c.detail && <span className="text-muted-foreground"> — {c.detail}</span>}
            </span>
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

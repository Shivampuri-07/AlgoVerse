"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, FileText, ListChecks } from "lucide-react";
import { getTopicById } from "@/data/topics";
import { platformLabel, primaryPlatform } from "@/lib/constants";
import { DifficultyBadge } from "@/components/problems/difficulty-badge";
import { CompletionCheckbox } from "@/components/problems/completion-checkbox";
import { BookmarkButton } from "@/components/problems/bookmark-button";
import { EmptyState } from "@/components/problems/empty-state";
import { ArticleButton } from "@/components/problems/platform-links";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Problem } from "@/lib/types";

function Meta({ problem, showTopic }: { problem: Problem; showTopic: boolean }) {
  const topic = getTopicById(problem.topic);
  const parts = [showTopic ? topic?.name : null, problem.section].filter(Boolean);
  if (parts.length === 0 && !problem.kind && !problem.premium) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {parts.length > 0 && <span>{parts.join(" › ")}</span>}
      {problem.kind === "theory" && (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
          Theory
        </Badge>
      )}
      {problem.premium && (
        <Badge variant="warning" className="px-1.5 py-0 text-[10px] font-normal">
          LC Premium
        </Badge>
      )}
    </div>
  );
}

const PAGE = 100;

/**
 * Renders rows progressively (100 at a time, more as you scroll) so the full 455-item
 * list stays fast on phones. The count only grows, so ticking a checkbox (which
 * re-filters the list) never collapses rows you've already scrolled to.
 */
function useProgressiveList<T>(items: T[]) {
  const [count, setCount] = React.useState(PAGE);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || count >= items.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(c + PAGE, items.length));
      },
      { rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [count, items.length]);

  return {
    visible: items.slice(0, count),
    hasMore: count < items.length,
    showAll: () => setCount(items.length),
    sentinelRef,
  };
}

export function ProblemTable({
  problems,
  showTopic = false,
}: {
  problems: Problem[];
  showTopic?: boolean;
}) {
  const { visible, hasMore, showAll, sentinelRef } = useProgressiveList(problems);

  if (problems.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No problems match your filters"
        description="Try loosening a filter or clearing your search to see more problems."
      />
    );
  }

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-hidden rounded-xl border border-border md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-14 px-4 py-3 font-medium" title="Position in the roadmap">#</th>
              <th className="px-4 py-3 font-medium">Problem</th>
              <th className="px-4 py-3 font-medium">Difficulty</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="hidden px-4 py-3 font-medium xl:table-cell">Tags</th>
              <th className="w-10 px-4 py-3 font-medium">
                <span className="sr-only">Completed</span>
              </th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((problem) => {
              const primary = primaryPlatform(problem);
              const sourceCount = Object.values(problem.platforms).filter(Boolean).length;
              return (
                <tr
                  key={problem.id}
                  className="group border-b border-border/70 last:border-b-0 transition-colors hover:bg-accent/50"
                >
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">{problem.order}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/problems/${problem.id}`}
                      className="font-medium hover:text-primary hover:underline underline-offset-2"
                    >
                      {problem.title}
                    </Link>
                    <Meta problem={problem} showTopic={showTopic} />
                  </td>
                  <td className="px-4 py-3">
                    <DifficultyBadge difficulty={problem.difficulty} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {primary ? platformLabel(problem, primary.key, true) : "—"}
                    {sourceCount > 1 && (
                      <span className="ml-1 text-xs text-muted-foreground/70">+{sourceCount - 1}</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 xl:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {problem.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="secondary" className="font-normal">
                          {tag}
                        </Badge>
                      ))}
                      {problem.tags.length > 2 && (
                        <Badge variant="secondary" className="font-normal">
                          +{problem.tags.length - 2}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <CompletionCheckbox problemId={problem.id} title={problem.title} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <BookmarkButton problemId={problem.id} size="icon" />
                      <ArticleButton article={problem.article} title={problem.title} size="icon" compact />
                      <Button variant="ghost" size="icon" asChild aria-label={`Open notes for ${problem.title}`}>
                        <Link href={`/problems/${problem.id}`}>
                          <FileText className="h-4 w-4" />
                        </Link>
                      </Button>
                      {primary ? (
                        <Button asChild size="sm">
                          <a
                            href={primary.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Solve ${problem.title} on ${platformLabel(problem, primary.key)} (opens in new tab)`}
                          >
                            Solve <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled>
                          No link
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2.5 md:hidden">
        {visible.map((problem) => {
          const primary = primaryPlatform(problem);
          return (
            <li key={problem.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <CompletionCheckbox problemId={problem.id} title={problem.title} />
                <div className="min-w-0 flex-1">
                  <Link href={`/problems/${problem.id}`} className="font-medium leading-snug">
                    <span className="text-muted-foreground tabular-nums">{problem.order}.</span> {problem.title}
                  </Link>
                  <Meta problem={problem} showTopic={showTopic} />
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <DifficultyBadge difficulty={problem.difficulty} />
                    {primary && (
                      <Badge variant="secondary" className="font-normal">
                        {platformLabel(problem, primary.key, true)}
                      </Badge>
                    )}
                  </div>
                </div>
                <BookmarkButton problemId={problem.id} size="icon" className="shrink-0" />
              </div>
              <div className="mt-3 flex items-center gap-2">
                {primary ? (
                  <Button asChild size="sm" className="flex-1">
                    <a
                      href={primary.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Solve ${problem.title} on ${platformLabel(problem, primary.key)} (opens in new tab)`}
                    >
                      Solve <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="flex-1" disabled>
                    No link available
                  </Button>
                )}
                <ArticleButton article={problem.article} title={problem.title} size="icon" compact />
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/problems/${problem.id}`}>Details</Link>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          <Button variant="outline" size="sm" onClick={showAll}>
            Showing {visible.length} of {problems.length} — show all
          </Button>
        </div>
      )}
    </>
  );
}

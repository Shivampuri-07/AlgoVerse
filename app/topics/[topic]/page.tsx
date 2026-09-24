"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Compass } from "lucide-react";
import { getTopicById } from "@/data/topics";
import { getProblemsByTopic, getSections, getTopicProgress, countCompleted } from "@/lib/progress";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import { useProblemFilters } from "@/lib/use-problem-filters";
import { ProblemFilters } from "@/components/problems/problem-filters";
import { ProblemTable } from "@/components/problems/problem-table";
import { EmptyState } from "@/components/problems/empty-state";
import { RandomProblemButton } from "@/components/problems/random-problem-button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function TopicPage() {
  const params = useParams<{ topic: string }>();
  // Keyed by topic so filter state resets when switching topics from the sidebar.
  return <TopicView key={params.topic} topicId={params.topic} />;
}

function TopicView({ topicId }: { topicId: string }) {
  const topic = getTopicById(topicId);
  const hydrated = useAppStore((s) => s.hydrated);
  const completed = useAppStore((s) => s.completed);

  const problems = getProblemsByTopic(topicId);
  const { state, setState, filtered, activeFilterCount, reset } = useProblemFilters(problems, {
    topic: topicId,
  });

  if (!topic) {
    return (
      <EmptyState
        icon={Compass}
        title="Topic not found"
        description="This topic doesn't exist in the roadmap yet."
        action={
          <Button asChild size="sm">
            <Link href="/problems">Browse all problems</Link>
          </Button>
        }
      />
    );
  }

  const progress = getTopicProgress(completed).find((t) => t.topicId === topicId);
  const sectionStats = getSections(topicId).map((name) => {
    const inSection = problems.filter((p) => p.section === name);
    return { name, total: inSection.length, done: countCompleted(completed, inSection) };
  });

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{topic.name}</h1>
          {progress && (
            <div className="max-w-xs space-y-1.5">
              <Progress value={progress.percent} />
              <p className="text-sm text-muted-foreground">
                {progress.completed} / {progress.total} completed &middot; {progress.percent}%
              </p>
            </div>
          )}
        </div>
        <RandomProblemButton />
      </div>

      {sectionStats.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Sections">
          {sectionStats.map((sec) => {
            const active = state.section === sec.name;
            return (
              <button
                key={sec.name}
                type="button"
                onClick={() => setState((s) => ({ ...s, section: active ? "all" : sec.name }))}
                aria-pressed={active}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-left text-xs transition-colors",
                  active
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-accent"
                )}
              >
                <span className="font-medium">{sec.name}</span>
                <span className="ml-2 tabular-nums text-muted-foreground">
                  {sec.done}/{sec.total}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <ProblemFilters
        state={state}
        setState={setState}
        activeFilterCount={activeFilterCount}
        onReset={reset}
        resultCount={filtered.length}
        showTopicFilter={false}
      />

      {!hydrated ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <ProblemTable problems={filtered} />
      )}
    </div>
  );
}

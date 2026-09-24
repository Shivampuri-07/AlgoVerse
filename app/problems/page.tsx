"use client";

import { PROBLEMS } from "@/data/problems";
import { useAppStore } from "@/lib/store";
import { useProblemFilters } from "@/lib/use-problem-filters";
import { ProblemFilters } from "@/components/problems/problem-filters";
import { ProblemTable } from "@/components/problems/problem-table";
import { RandomProblemButton } from "@/components/problems/random-problem-button";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProblemsPage() {
  const hydrated = useAppStore((s) => s.hydrated);
  const { state, setState, filtered, activeFilterCount, reset } = useProblemFilters(PROBLEMS);

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">All Problems</h1>
          <p className="text-sm text-muted-foreground">
            {PROBLEMS.length} problems across every topic in the roadmap.
          </p>
        </div>
        <RandomProblemButton />
      </div>

      <ProblemFilters
        state={state}
        setState={setState}
        activeFilterCount={activeFilterCount}
        onReset={reset}
        resultCount={filtered.length}
      />

      {!hydrated ? (
        <div className="space-y-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <ProblemTable problems={filtered} showTopic />
      )}
    </div>
  );
}

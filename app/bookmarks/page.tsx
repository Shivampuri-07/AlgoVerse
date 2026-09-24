"use client";

import { Star } from "lucide-react";
import { Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { PROBLEMS } from "@/data/problems";
import { useAppStore } from "@/lib/store";
import { useProblemFilters } from "@/lib/use-problem-filters";
import { ProblemFilters } from "@/components/problems/problem-filters";
import { ProblemTable } from "@/components/problems/problem-table";
import { EmptyState } from "@/components/problems/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function BookmarksPage() {
  const hydrated = useAppStore((s) => s.hydrated);
  const bookmarked = useAppStore((s) => s.bookmarked);
  const bookmarkedProblems = PROBLEMS.filter((p) => bookmarked.includes(p.id));
  const { state, setState, filtered, activeFilterCount, reset } = useProblemFilters(bookmarkedProblems);

  return (
    <div className="space-y-5 pb-6">
      <div className="flex items-center gap-2">
        <Star className="h-5 w-5 fill-warning text-warning" />
        <h1 className="text-2xl font-bold tracking-tight">Bookmarks</h1>
      </div>

      {!hydrated ? (
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : bookmarkedProblems.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No bookmarks yet"
          description="Star any problem to save it here for quick access later."
          action={
            <Button asChild size="sm">
              <Link href="/problems">
                <LinkIcon className="h-3.5 w-3.5" />
                Browse problems
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <ProblemFilters
            state={state}
            setState={setState}
            activeFilterCount={activeFilterCount}
            onReset={reset}
            resultCount={filtered.length}
          />
          <ProblemTable problems={filtered} showTopic />
        </>
      )}
    </div>
  );
}

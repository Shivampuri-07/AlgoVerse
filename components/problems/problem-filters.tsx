"use client";

import type { Dispatch, SetStateAction } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TOPICS } from "@/data/topics";
import { getSections } from "@/lib/progress";
import type {
  DifficultyFilter,
  PlatformFilter,
  ProblemFiltersState,
  StatusFilter,
} from "@/lib/use-problem-filters";

export function ProblemFilters({
  state,
  setState,
  activeFilterCount,
  onReset,
  showTopicFilter = true,
  resultCount,
}: {
  state: ProblemFiltersState;
  setState: Dispatch<SetStateAction<ProblemFiltersState>>;
  activeFilterCount: number;
  onReset: () => void;
  showTopicFilter?: boolean;
  resultCount: number;
}) {
  const sections = state.topic !== "all" ? getSections(state.topic) : [];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={state.query}
          onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
          placeholder="Search problems, topics, tags, difficulty, platform..."
          aria-label="Search problems"
          className="pl-9"
        />
        {state.query && (
          <button
            type="button"
            onClick={() => setState((s) => ({ ...s, query: "" }))}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showTopicFilter && (
          <Select
            value={state.topic}
            onValueChange={(v) => setState((s) => ({ ...s, topic: v, section: "all" }))}
          >
            <SelectTrigger className="w-[168px]" aria-label="Filter by topic">
              <SelectValue placeholder="Topic" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All topics</SelectItem>
              {TOPICS.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={state.section}
          onValueChange={(v) => setState((s) => ({ ...s, section: v }))}
          disabled={sections.length === 0}
        >
          <SelectTrigger className="w-[190px]" aria-label="Filter by section">
            <SelectValue placeholder="Section" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{sections.length ? "All sections" : "Section (pick a topic)"}</SelectItem>
            {sections.map((sec) => (
              <SelectItem key={sec} value={sec}>
                {sec}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={state.difficulty}
          onValueChange={(v) => setState((s) => ({ ...s, difficulty: v as DifficultyFilter }))}
        >
          <SelectTrigger className="w-[140px]" aria-label="Filter by difficulty">
            <SelectValue placeholder="Difficulty" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All difficulties</SelectItem>
            <SelectItem value="Easy">Easy</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Hard">Hard</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={state.platform}
          onValueChange={(v) => setState((s) => ({ ...s, platform: v as PlatformFilter }))}
        >
          <SelectTrigger className="w-[150px]" aria-label="Filter by platform">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="leetcode">LeetCode</SelectItem>
            <SelectItem value="gfg">GeeksforGeeks</SelectItem>
            <SelectItem value="code360">Code360</SelectItem>
            <SelectItem value="other">TakeUForward / other</SelectItem>
          </SelectContent>
        </Select>

        <Select value={state.status} onValueChange={(v) => setState((s) => ({ ...s, status: v as StatusFilter }))}>
          <SelectTrigger className="w-[140px]" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="incomplete">Incomplete</SelectItem>
            <SelectItem value="bookmarked">Bookmarked</SelectItem>
          </SelectContent>
        </Select>

        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        )}

        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {resultCount} {resultCount === 1 ? "problem" : "problems"}
        </span>
      </div>
    </div>
  );
}

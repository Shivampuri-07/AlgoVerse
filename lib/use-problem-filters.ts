"use client";

import { useMemo, useState } from "react";
import { getTopicById } from "@/data/topics";
import { useAppStore } from "@/lib/store";
import { platformLabel } from "@/lib/constants";
import type { Problem } from "@/lib/types";

export type StatusFilter = "all" | "completed" | "incomplete" | "bookmarked";
export type PlatformFilter = "all" | "leetcode" | "gfg" | "code360" | "other";
export type DifficultyFilter = "all" | "Easy" | "Medium" | "Hard";

export interface ProblemFiltersState {
  query: string;
  topic: string; // topic id or "all"
  section: string; // section name or "all"
  difficulty: DifficultyFilter;
  platform: PlatformFilter;
  status: StatusFilter;
}

const DEFAULT_STATE: ProblemFiltersState = {
  query: "",
  topic: "all",
  section: "all",
  difficulty: "all",
  platform: "all",
  status: "all",
};

/** "https://leetcode.com/problems/two-sum/" -> "two sum" (so "two sum" finds "2Sum Problem"). */
function slugWords(url: string | undefined): string {
  if (!url) return "";
  const m = url.match(/\/problems\/([^/?#]+)/) ?? url.match(/\/dsa\/([^/?#]+)/);
  return m ? m[1].replace(/[-_]+/g, " ").replace(/\d{6,}/g, "") : "";
}

/** Lower-cased text a problem can be found by. Computed once per problem. */
const searchIndex = new WeakMap<Problem, string>();
export function problemSearchText(p: Problem): string {
  let text = searchIndex.get(p);
  if (text === undefined) {
    const platforms = (Object.keys(p.platforms) as (keyof Problem["platforms"])[])
      .filter((k) => p.platforms[k])
      .map((k) => `${k} ${platformLabel(p, k)} ${platformLabel(p, k, true)}`);
    text = [
      p.title,
      getTopicById(p.topic)?.name ?? "",
      p.section ?? "",
      p.subsection ?? "",
      p.difficulty,
      p.kind === "theory" ? "theory lesson" : "",
      p.premium ? "premium" : "",
      `#${p.order}`,
      ...p.tags,
      ...platforms,
      slugWords(p.platforms.leetcode),
      slugWords(p.platforms.gfg),
      slugWords(p.platforms.other),
      ...(p.related ?? []).map((r) => r.title),
    ]
      .join(" ")
      .toLowerCase();
    searchIndex.set(p, text);
  }
  return text;
}

/** Every whitespace-separated term must appear (so "binary search tree" narrows, not widens). */
export function matchesQuery(p: Problem, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = problemSearchText(p);
  return terms.every((t) => text.includes(t));
}

/**
 * Client-side search + filter over a problem list. Combines a free-text query (title,
 * topic, section, difficulty, tags, platform) with topic, section, difficulty, platform
 * and status (completed / incomplete / bookmarked) filters — all combinable.
 */
export function useProblemFilters(problems: Problem[], initial?: Partial<ProblemFiltersState>) {
  const [state, setState] = useState<ProblemFiltersState>({ ...DEFAULT_STATE, ...initial });
  const completed = useAppStore((s) => s.completed);
  const bookmarked = useAppStore((s) => s.bookmarked);

  const filtered = useMemo(() => {
    const bookmarkedSet = new Set(bookmarked);
    return problems
      .filter((p) => {
        if (state.topic !== "all" && p.topic !== state.topic) return false;
        if (state.section !== "all" && p.section !== state.section) return false;
        if (state.difficulty !== "all" && p.difficulty !== state.difficulty) return false;
        if (state.platform !== "all" && !p.platforms[state.platform]) return false;

        const isDone = Boolean(completed[p.id]);
        if (state.status === "completed" && !isDone) return false;
        if (state.status === "incomplete" && isDone) return false;
        if (state.status === "bookmarked" && !bookmarkedSet.has(p.id)) return false;

        return matchesQuery(p, state.query);
      })
      .sort((a, b) => a.order - b.order);
  }, [problems, state, completed, bookmarked]);

  const activeFilterCount =
    (state.topic !== "all" && state.topic !== initial?.topic ? 1 : 0) +
    (state.section !== "all" ? 1 : 0) +
    (state.difficulty !== "all" ? 1 : 0) +
    (state.platform !== "all" ? 1 : 0) +
    (state.status !== "all" ? 1 : 0);

  function reset() {
    setState({ ...DEFAULT_STATE, topic: initial?.topic ?? "all" });
  }

  return { state, setState, filtered, activeFilterCount, reset };
}

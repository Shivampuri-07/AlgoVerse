import type { PlatformKey, Problem } from "@/lib/types";

export const APP_NAME = "AlgoVerse";
export const APP_SHORT_DESCRIPTION =
  "A structured DSA learning and problem-solving companion with progress tracking and AI assistance.";
export const APP_DESCRIPTION =
  "AlgoVerse helps students learn Data Structures and Algorithms through a structured roadmap, coding problems, progress tracking, bookmarks, notes, articles, and an AI-powered DSA helper.";

export const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;

export const PLATFORM_LABELS: Record<string, string> = {
  leetcode: "LeetCode",
  gfg: "GeeksforGeeks",
  code360: "Code360",
  other: "Other",
};

export const PLATFORM_SHORT_LABELS: Record<string, string> = {
  leetcode: "LeetCode",
  gfg: "GFG",
  code360: "Code360",
  other: "Other",
};

/** Display label for a platform of a given problem (uses otherLabel for "other"). */
export function platformLabel(problem: Pick<Problem, "otherLabel">, key: PlatformKey | string, short = false): string {
  if (key === "other" && problem.otherLabel) return problem.otherLabel;
  return (short ? PLATFORM_SHORT_LABELS : PLATFORM_LABELS)[key] ?? key;
}

/** Preferred order when choosing the primary "Solve" link. */
export const PLATFORM_PRIORITY: PlatformKey[] = ["leetcode", "gfg", "code360", "other"];

export function primaryPlatform(problem: Problem): { key: PlatformKey; url: string } | null {
  for (const key of PLATFORM_PRIORITY) {
    const url = problem.platforms[key];
    if (url) return { key, url };
  }
  return null;
}

export const NAV_LINKS = [
  { href: "/", label: "Dashboard", shortcut: "g d" },
  { href: "/problems", label: "Problems", shortcut: "g p" },
  { href: "/bookmarks", label: "Bookmarks", shortcut: "g b" },
  { href: "/settings", label: "Settings", shortcut: "g s" },
] as const;

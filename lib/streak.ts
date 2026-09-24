import { todayKey, shiftDateKey, daysBetween } from "@/lib/utils";
import type { StreakState } from "@/lib/types";

/**
 * Recompute current & longest streak from the full set of "active" dates
 * (any local date on which at least one problem was marked completed).
 *
 * A streak is "current" if the most recent active date is today or
 * yesterday (so the streak doesn't visually reset the instant midnight
 * passes before the user has had a chance to solve today's problem).
 */
export function computeStreak(activeDates: string[]): Pick<StreakState, "current" | "longest"> {
  if (activeDates.length === 0) return { current: 0, longest: 0 };

  const unique = Array.from(new Set(activeDates)).sort();

  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    run = daysBetween(unique[i - 1], unique[i]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const today = todayKey();
  const yesterday = shiftDateKey(today, -1);
  const activeSet = new Set(unique);

  let cursor: string | null = null;
  if (activeSet.has(today)) cursor = today;
  else if (activeSet.has(yesterday)) cursor = yesterday;

  let current = 0;
  while (cursor && activeSet.has(cursor)) {
    current++;
    cursor = shiftDateKey(cursor, -1);
  }

  return { current, longest };
}

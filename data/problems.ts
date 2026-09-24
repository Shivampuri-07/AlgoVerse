import type { Problem } from "@/lib/types";
import { a2zProblems } from "@/data/a2zProblems";

/**
 * The dataset the whole app reads. Everything (totals, progress bars, filters, search,
 * random picks) is derived from this array at runtime — nothing is hard-coded.
 *
 * To swap in a different dataset, point this at another `Problem[]` (keep ids stable, or
 * add a migration like data/legacyIdMap.ts so existing progress carries over).
 */
export const PROBLEMS: Problem[] = [...a2zProblems].sort((a, b) => a.order - b.order);

const BY_ID = new Map(PROBLEMS.map((p) => [p.id, p]));

export function getProblemById(id: number): Problem | undefined {
  return BY_ID.get(id);
}

import { PROBLEMS } from "@/data/problems";
import { TOPICS } from "@/data/topics";
import { percent } from "@/lib/utils";
import type { CompletedMap, Problem } from "@/lib/types";

export interface TopicProgress {
  topicId: string;
  topicName: string;
  total: number;
  completed: number;
  percent: number;
}

const PROBLEM_IDS = new Set(PROBLEMS.map((p) => p.id));

/** Completed ids that exist in the current dataset (ignores stale/legacy ids). */
export function countCompleted(completed: CompletedMap, problems: Problem[] = PROBLEMS): number {
  let n = 0;
  for (const p of problems) if (completed[p.id]) n++;
  return n;
}

/** Overall totals derived live from the problem set + completed map. */
export function getOverallProgress(completed: CompletedMap) {
  const total = PROBLEMS.length;
  const done = countCompleted(completed);
  return {
    total,
    completed: done,
    remaining: total - done,
    percent: percent(done, total),
    /** One decimal place, e.g. 24.2 — for the headline figure. */
    percentPrecise: total ? Math.round((done / total) * 1000) / 10 : 0,
  };
}

/** Per-topic totals, in roadmap order. */
export function getTopicProgress(completed: CompletedMap): TopicProgress[] {
  return TOPICS.map((topic) => {
    const problems = getProblemsByTopic(topic.id);
    const done = countCompleted(completed, problems);
    return {
      topicId: topic.id,
      topicName: topic.name,
      total: problems.length,
      completed: done,
      percent: percent(done, problems.length),
    };
  });
}

const BY_TOPIC = new Map<string, Problem[]>();
for (const p of PROBLEMS) {
  const list = BY_TOPIC.get(p.topic) ?? [];
  list.push(p);
  BY_TOPIC.set(p.topic, list);
}

/** Problems of one topic, in roadmap order. */
export function getProblemsByTopic(topicId: string): Problem[] {
  return BY_TOPIC.get(topicId) ?? [];
}

/** Distinct sections of a topic (or of all topics), in roadmap order. */
export function getSections(topicId?: string): string[] {
  const source = topicId && topicId !== "all" ? getProblemsByTopic(topicId) : PROBLEMS;
  const seen: string[] = [];
  for (const p of source) if (p.section && !seen.includes(p.section)) seen.push(p.section);
  return seen;
}

/** Topics that aren't 100% complete yet, in roadmap order. */
export function getNextIncompleteTopics(completed: CompletedMap, limit = 3): TopicProgress[] {
  return getTopicProgress(completed)
    .filter((t) => t.total > 0 && t.completed < t.total)
    .slice(0, limit);
}

/** The first not-yet-completed problem in roadmap order. */
export function getNextUpProblem(completed: CompletedMap): Problem | undefined {
  return PROBLEMS.find((p) => !completed[p.id]);
}

/** Most recently completed problems, newest first. */
export function getRecentlySolved(completed: CompletedMap, limit = 5): (Problem & { completedAt: string })[] {
  return Object.entries(completed)
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .map(([id, completedAt]) => {
      if (!PROBLEM_IDS.has(Number(id))) return null;
      const problem = PROBLEMS.find((p) => p.id === Number(id));
      return problem ? { ...problem, completedAt } : null;
    })
    .filter((p): p is Problem & { completedAt: string } => p !== null)
    .slice(0, limit);
}

/** A random incomplete practice problem, optionally constrained by topic/difficulty. */
export function pickRandomProblem(
  completed: CompletedMap,
  filters: { topic?: string; difficulty?: string } = {}
): Problem | null {
  const pool = PROBLEMS.filter((p) => {
    if (completed[p.id]) return false;
    if (p.kind === "theory") return false;
    if (filters.topic && filters.topic !== "all" && p.topic !== filters.topic) return false;
    if (filters.difficulty && filters.difficulty !== "all" && p.difficulty !== filters.difficulty) return false;
    return true;
  });
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

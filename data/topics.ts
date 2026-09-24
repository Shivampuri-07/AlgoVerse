import type { Topic, TopicCategory } from "@/lib/types";

/**
 * The learning roadmap: categories, in the order they appear in the sidebar, each
 * containing an ordered list of topics.
 *
 * Topic ids are part of stored URLs (/topics/<id>) and every problem's `topic` field, so
 * keep them stable. To add a topic: add it to TOPICS and list its id in a category.
 */
export const TOPICS: Topic[] = [
  { id: "basics", name: "Learn the Basics", category: "basics" },
  { id: "sorting", name: "Sorting Techniques", category: "basics" },
  { id: "arrays", name: "Arrays", category: "basics" },
  { id: "binary-search", name: "Binary Search", category: "basics" },
  { id: "strings", name: "Strings", category: "basics" },

  { id: "linked-list", name: "Linked List", category: "data-structures" },
  { id: "recursion", name: "Recursion", category: "data-structures" },
  { id: "bit-manipulation", name: "Bit Manipulation", category: "data-structures" },
  { id: "stack-queue", name: "Stack & Queue", category: "data-structures" },
  { id: "sliding-window", name: "Sliding Window / Two Pointer", category: "data-structures" },
  { id: "heap", name: "Heap", category: "data-structures" },
  { id: "greedy", name: "Greedy", category: "data-structures" },

  { id: "trees", name: "Binary Trees", category: "advanced" },
  { id: "bst", name: "Binary Search Trees", category: "advanced" },
  { id: "graphs", name: "Graphs", category: "advanced" },
  { id: "dp", name: "Dynamic Programming", category: "advanced" },
  { id: "tries", name: "Tries", category: "advanced" },
];

export const TOPIC_CATEGORIES: TopicCategory[] = [
  {
    id: "basics",
    name: "Basics",
    topicIds: ["basics", "sorting", "arrays", "binary-search", "strings"],
  },
  {
    id: "data-structures",
    name: "Data Structures",
    topicIds: ["linked-list", "recursion", "bit-manipulation", "stack-queue", "sliding-window", "heap", "greedy"],
  },
  {
    id: "advanced",
    name: "Trees, Graphs & DP",
    topicIds: ["trees", "bst", "graphs", "dp", "tries"],
  },
];

export const TOPIC_ORDER: string[] = TOPIC_CATEGORIES.flatMap((c) => c.topicIds);

export function getTopicById(id: string): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}

export function getCategoryForTopic(topicId: string): TopicCategory | undefined {
  return TOPIC_CATEGORIES.find((c) => c.topicIds.includes(topicId));
}

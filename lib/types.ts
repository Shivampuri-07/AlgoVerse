export type Difficulty = "Easy" | "Medium" | "Hard";

export type PlatformKey = "leetcode" | "gfg" | "code360" | "other";

export interface ProblemPlatforms {
  leetcode?: string;
  gfg?: string;
  code360?: string;
  other?: string;
}

/** An explanation to read (not a place to submit code). */
export interface ProblemArticle {
  url: string;
  /** e.g. "TakeUForward" */
  source: string;
}

/** A practice problem that the sheet suggests but that is NOT the identical problem. */
export interface RelatedLink {
  platform: PlatformKey;
  title: string;
  url: string;
  note?: string;
}

export interface Problem {
  /** Stable unique id — progress is stored against it. */
  id: number;
  /** Position in the roadmap (1..N, no gaps). Lists are sorted by this. */
  order: number;
  /** A2Z step number (1..18). */
  step?: number;
  /** Topic id — must match a Topic["id"] in data/topics.ts */
  topic: string;
  /** Lecture / section inside the topic, e.g. "Easy", "BS on Answers". */
  section?: string;
  subsection?: string;
  title: string;
  difficulty: Difficulty;
  /** "theory" = a lesson / concept item rather than a coding problem. Defaults to practice. */
  kind?: "practice" | "theory";
  platforms: ProblemPlatforms;
  /** Display name for platforms.other, e.g. "TakeUForward", "InterviewBit". */
  otherLabel?: string;
  /** Verified educational article for this exact problem; absent when none is verified. */
  article?: ProblemArticle;
  /** LeetCode Premium problem. */
  premium?: boolean;
  related?: RelatedLink[];
  /** Optional short original description (never a copied problem statement). */
  description?: string;
  tags: string[];
}

export interface Topic {
  id: string;
  name: string;
  /** TopicCategory id this topic belongs to */
  category: string;
  description?: string;
}

export interface TopicCategory {
  id: string;
  name: string;
  topicIds: string[];
}

/** Per-problem completion timestamp, keyed by problem id. */
export type CompletedMap = Record<number, string>; // problem id -> ISO completed date

export interface StreakState {
  current: number;
  longest: number;
  lastActiveDate: string | null; // YYYY-MM-DD
  /** Every local date (YYYY-MM-DD) on which at least one problem was completed. */
  activeDates: string[];
}

/**
 * Progress for problems of an older dataset that have no identical problem in the
 * current one. Kept verbatim (keyed by the OLD id) so nothing is ever lost.
 */
export interface LegacyProgress {
  completed: CompletedMap;
  bookmarked: number[];
  notes: Record<number, string>;
  mistakes: Record<number, string>;
  code: Record<number, string>;
}

export interface ProgressExport {
  version: 1 | 2;
  /** Which problem-id space the ids refer to. 1 = original 152-problem set, 2 = A2Z. */
  dataset?: "starter-v1" | "a2z-v2";
  exportedAt: string;
  completed: CompletedMap;
  bookmarked: number[];
  notes: Record<number, string>;
  mistakes: Record<number, string>;
  code: Record<number, string>;
  streak: StreakState;
  legacy?: LegacyProgress;
}

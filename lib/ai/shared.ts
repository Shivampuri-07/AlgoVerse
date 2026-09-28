/**
 * Types and constants shared by the AI helper UI and the /api/ai route.
 * This file is safe to import in the browser: it contains no secrets and no server code.
 */

export type AiRole = "user" | "assistant";

export interface AiChatMessage {
  role: AiRole;
  content: string;
  /** Code the student attached to this message (Debug My Code). Sent to the server, never stored. */
  code?: string;
}

/** The only problem information sent to the AI: metadata, never a copied statement. */
export interface AiProblemContext {
  title: string;
  topic: string;
  section?: string;
  difficulty: string;
  tags: string[];
  description?: string;
}

export type AiActionId = "hint" | "approach" | "optimal" | "brute" | "complexity" | "debug" | "chat";

export interface AiRequestBody {
  problem: AiProblemContext;
  /** Conversation so far, ending with the new user message. */
  messages: AiChatMessage[];
  /** Which button produced the last message ("chat" for a typed question). */
  action?: AiActionId;
}

/** Newline-delimited JSON events streamed from /api/ai. */
export type AiStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; model?: string; usage?: AiUsageView }
  | { type: "error"; code: AiErrorCode; message: string };

export type AiErrorCode =
  | "not_configured"
  | "bad_request"
  | "unauthorized"
  | "rate_limited"
  | "model_unavailable"
  | "region_unsupported"
  | "blocked"
  | "timeout"
  | "provider_unavailable"
  | "empty_response"
  | "malformed_response"
  | "network"
  // Access (Phase 5): the helper needs a signed-in account with a verified email, within its daily limit.
  | "sign_in_required"
  | "verify_email"
  | "forbidden"
  | "slow_down"
  | "daily_limit"
  | "busy"
  | "account_unavailable";

/** The signed-in user's AI allowance for today (from the server; display only). */
export interface AiUsageView {
  plan: "free" | "pro";
  limit: number;
  used: number;
  remaining: number;
  /** When today's allowance resets (ISO; midnight India time). */
  resetAt: string;
}

/**
 * Fallback copy the browser uses only when the server's own message isn't available
 * (e.g. the network dropped). The server sends the precise, user-facing message for every
 * error it reports (see lib/ai/server.ts); none of these strings mention server settings.
 */
export const AI_CLIENT_MESSAGES = {
  network: "Couldn't reach the AI helper. Check your connection and try again.",
  rate_limited: "The AI helper is busy right now.\n\nPlease wait a little and try again.",
  unavailable: "The AI helper is unavailable right now. Please try again in a moment.",
  empty_response: "The AI returned an empty answer. Please try again.",
  not_configured: "The AI helper isn't set up yet.",
} as const;

/** Limits enforced by the server (and mirrored in the UI). */
export const AI_LIMITS = {
  maxMessages: 12,
  maxMessageChars: 8000,
  maxCodeChars: 12000,
  maxTotalChars: 40000,
} as const;

export interface AiQuickAction {
  id: Exclude<AiActionId, "chat">;
  label: string;
  emoji: string;
  prompt: string;
  /** Needs the user's code attached. */
  needsCode?: boolean;
}

export const AI_QUICK_ACTIONS: AiQuickAction[] = [
  {
    id: "hint",
    label: "Hint",
    emoji: "💡",
    prompt: "Give me one small hint for this DSA problem.\nDo not reveal the complete solution.",
  },
  {
    id: "approach",
    label: "Approach",
    emoji: "🧠",
    prompt: "Explain the approach step by step.\nDo not provide complete code yet.",
  },
  {
    id: "optimal",
    label: "Optimal",
    emoji: "⚡",
    prompt: "Explain the optimal approach and why it is optimal.\nInclude time and space complexity.",
  },
  {
    id: "brute",
    label: "Brute Force",
    emoji: "🐢",
    prompt: "Explain the brute-force approach first and its complexity.\nThen explain how it can be improved.",
  },
  {
    id: "complexity",
    label: "Complexity",
    emoji: "⏱",
    prompt: "Explain the time and space complexity of the expected solution and why.",
  },
  {
    id: "debug",
    label: "Debug My Code",
    emoji: "🐛",
    prompt:
      "Analyze the student's code.\nFind the bug and explain why it happens.\nSuggest the smallest useful correction.\nDo not rewrite the entire solution unless necessary.",
    needsCode: true,
  },
];

export const AI_ACTION_IDS: readonly AiActionId[] = [...AI_QUICK_ACTIONS.map((a) => a.id), "chat"];

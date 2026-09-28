/**
 * Plans and the features they unlock — the single place to change what's Free vs Pro, the price
 * and the comparison shown to users. Shared by the server (enforcement, lib/entitlements.ts) and
 * the UI (display only; never trusted for access).
 *
 * STATUS: feature list APPROVED by the owner on 2026-09-28 ("all DSA questions free; articles and
 * videos Pro"). Price ₹30/month, monthly only. Payments are Phase 4 and are not enabled.
 */
export type PlanId = "free" | "pro";

export interface PlanFeatures {
  /** Cross-device sync of progress, bookmarks, notes, streak and theme (docs §5). */
  cloudSync: boolean;
  /** Articles and Striver video explanations (links served by GET /api/resources/[id]). */
  learningResources: boolean;
}

export const PLANS: Record<PlanId, { name: string; features: PlanFeatures }> = {
  free: { name: "Free", features: { cloudSync: false, learningResources: false } },
  pro: { name: "Pro", features: { cloudSync: true, learningResources: true } },
};

/**
 * AI helper questions per day (resets at midnight India time), per signed-in account. Enforced
 * by the server (lib/ai/usage.ts) from the server-side plan; shown in the UI for information only.
 * PROPOSED defaults (Phase 5, 2026-09-29) — owner to confirm.
 */
export const AI_DAILY_LIMITS: Record<PlanId, number> = { free: 10, pro: 50 };

/** One-line summary used across pricing, the upgrade dialog and billing. */
export const PLAN_SUMMARY = "All 455 DSA problems are free. Pro unlocks articles, videos, and cloud sync.";

export type Feature = keyof PlanFeatures;

/** What the browser is told (GET /api/me/entitlements). */
export interface EntitlementsView {
  plan: PlanId;
  features: PlanFeatures;
  /** Why a feature is on without Pro, e.g. "preview" (Preview-deployment testing switch). */
  grantedBy: "plan" | "preview";
  /** Pro expiry (ISO), when known. */
  expiresAt: string | null;
}

/** Pricing shown to users. Owner decision: monthly only, ₹30/month. */
export const PRICING = {
  currency: "INR",
  proMonthly: 30,
  /** The owner approved the plan list below (2026-09-28). */
  approved: true,
  /** False until Phase 4 (Razorpay) is live — no checkout is offered before that. */
  paymentsEnabled: false,
} as const;

export function formatPrice(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/** "available" = built and working today; "planned" = on the roadmap, not built yet. */
export type Availability = "available" | "planned";

export interface FeatureRow {
  id: string;
  label: string;
  description: string;
  /** true/false, or a short qualifier such as "Limited daily questions". */
  free: boolean | string;
  pro: boolean | string;
  availability: Availability;
  /** Roadmap phase for planned items. */
  phase?: number;
}

/** APPROVED Free vs Pro comparison. Planned items are labelled as such until they're built. */
export const FEATURE_MATRIX: FeatureRow[] = [
  {
    id: "problems",
    label: "All 455 DSA questions and problems",
    description: "Every problem in the roadmap, with its practice links. No daily limit.",
    free: "Unlimited access",
    pro: "Unlimited access",
    availability: "available",
  },
  {
    id: "navigation",
    label: "Topics, problem search and filters",
    description: "Browse by topic and section, search, filter and pick a random problem.",
    free: true,
    pro: true,
    availability: "available",
  },
  {
    id: "local-progress",
    label: "Progress, bookmarks, notes and streaks",
    description: "Track what you've solved, save problems and write notes.",
    free: true,
    pro: true,
    availability: "available",
  },
  {
    id: "local-data",
    label: "Local data and progress export",
    description: "Saved on your device, works offline, with file export and import.",
    free: true,
    pro: true,
    availability: "available",
  },
  {
    id: "account",
    label: "Email/password and Google account",
    description: "Sign in with email or Google.",
    free: true,
    pro: true,
    availability: "available",
  },
  {
    id: "articles",
    label: "Articles and written learning content",
    description: "Links to verified explanation articles, where one exists for a problem.",
    free: false,
    pro: true,
    availability: "available",
  },
  {
    id: "videos",
    label: "Striver videos and video explanations",
    description: "Striver's video explanation, where one exists — watch in AlgoVerse or on YouTube.",
    free: false,
    pro: true,
    availability: "available",
  },
  {
    id: "cloud-sync",
    label: "Cloud sync across devices",
    description: "Progress, bookmarks, notes, streak and theme stay the same on every device you sign in on.",
    free: false,
    pro: true,
    availability: "available",
  },
  {
    id: "ai-helper",
    label: "AI DSA helper",
    description: "Hints, approaches, complexity and debugging help for each problem. Needs a signed-in account with a verified email.",
    free: "10 questions a day",
    pro: "50 questions a day",
    availability: "available",
  },
  {
    id: "analytics",
    label: "Advanced analytics",
    description: "Topic strengths and gaps, pace and time-to-finish estimates.",
    free: false,
    pro: "Planned Pro feature",
    availability: "planned",
  },
  {
    id: "interview-prep",
    label: "Interview preparation mode",
    description: "Revision lists built from your mistakes and timed practice sets.",
    free: false,
    pro: "Planned Pro feature",
    availability: "planned",
  },
  {
    id: "personal-roadmap",
    label: "Personalized roadmap",
    description: "A study plan adapted to your progress and goals.",
    free: false,
    pro: "Planned Pro feature",
    availability: "planned",
  },
];

/** Pro benefits for upgrade prompts: what you get now vs later (never overstated). */
export function proBenefits(): { available: FeatureRow[]; planned: FeatureRow[] } {
  const proOnly = FEATURE_MATRIX.filter((r) => r.pro && r.free !== true && r.free !== r.pro);
  return {
    available: proOnly.filter((r) => r.availability === "available"),
    planned: proOnly.filter((r) => r.availability === "planned"),
  };
}

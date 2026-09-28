/**
 * Plans and the features they unlock — the single place to change what's Free vs Pro, the price
 * and the comparison shown to users. Shared by the server (enforcement, lib/entitlements.ts) and
 * the UI (display only; never trusted for access).
 *
 * STATUS: the feature list and price below are a PROPOSAL awaiting the owner's approval
 * (docs/SAAS_ARCHITECTURE.md §7 + decision record). Payments are Phase 4 and are not enabled.
 */
export type PlanId = "free" | "pro";

export interface PlanFeatures {
  /** Cross-device sync of progress, bookmarks, notes, streak and theme (docs §5). */
  cloudSync: boolean;
}

export const PLANS: Record<PlanId, { name: string; features: PlanFeatures }> = {
  free: { name: "Free", features: { cloudSync: false } },
  pro: { name: "Pro", features: { cloudSync: true } },
};

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
  /** False until the owner approves the plan list and price below. */
  approved: false,
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

/** PROPOSED Free vs Pro comparison (awaiting approval). Honest: planned items are labelled as such. */
export const FEATURE_MATRIX: FeatureRow[] = [
  {
    id: "roadmap",
    label: "All 455 DSA problems",
    description: "The full step-by-step roadmap with topics, sections, search, filters and random problems.",
    free: true,
    pro: true,
    availability: "available",
  },
  {
    id: "videos",
    label: "Striver video explanations",
    description: "Video explanations where a verified one exists.",
    free: true,
    pro: true,
    availability: "available",
  },
  {
    id: "local-progress",
    label: "Progress, bookmarks, notes and streaks",
    description: "Saved on your device, working offline, with file export and import.",
    free: true,
    pro: true,
    availability: "available",
  },
  {
    id: "account",
    label: "AlgoVerse account",
    description: "Sign in with email or Google.",
    free: true,
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
    description: "Hints, approaches, complexity and debugging help for each problem.",
    free: "Limited daily questions",
    pro: "Higher daily limit (fair use)",
    availability: "planned",
    phase: 5,
  },
  {
    id: "analytics",
    label: "Advanced progress analytics",
    description: "Topic strengths and gaps, pace and time-to-finish estimates.",
    free: false,
    pro: true,
    availability: "planned",
  },
  {
    id: "interview-prep",
    label: "Interview preparation mode",
    description: "Revision lists built from your mistakes and timed practice sets.",
    free: false,
    pro: true,
    availability: "planned",
  },
  {
    id: "personal-roadmap",
    label: "Personalised roadmap",
    description: "A study plan adapted to your progress and goals.",
    free: false,
    pro: true,
    availability: "planned",
  },
];

/** Pro benefits for upgrade prompts: what you get now vs later (never overstated). */
export function proBenefits(): { available: FeatureRow[]; planned: FeatureRow[] } {
  const proOnly = FEATURE_MATRIX.filter((r) => r.pro && r.free !== true);
  return {
    available: proOnly.filter((r) => r.availability === "available"),
    planned: proOnly.filter((r) => r.availability === "planned"),
  };
}

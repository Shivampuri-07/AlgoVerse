/**
 * Plans and the features they unlock — the single place to change what's Free vs Pro.
 * Shared by server (enforcement, lib/entitlements.ts) and UI (display only; never trusted).
 * Phase 3 extends this with prices, quotas and the pricing page.
 */
export type PlanId = "free" | "pro";

export interface PlanFeatures {
  /** Cross-device sync of progress, bookmarks, notes and streaks (docs/SAAS_ARCHITECTURE.md §5). */
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

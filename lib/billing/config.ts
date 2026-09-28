/**
 * SERVER-ONLY. Is checkout allowed on this deployment? (Phase 4 readiness — nothing calls
 * Razorpay yet.) Payments stay OFF unless every condition holds:
 *   - PRICING.paymentsEnabled is true in code (owner approval, reviewed commit);
 *   - RAZORPAY_MODE=test and the key id is a test key (rzp_test_…);
 *   - not a Production deployment.
 * Live mode is deliberately impossible from configuration alone: it needs a code change
 * (ALLOW_LIVE_PAYMENTS) that the owner must approve. See docs/BILLING.md.
 */
import { PRICING } from "@/lib/plans";

/** Flip only with the owner's written approval for live payments. */
export const ALLOW_LIVE_PAYMENTS = false;

export type BillingStatus =
  | { enabled: true; mode: "test" }
  | { enabled: false; reason: "not_approved" | "not_configured" | "live_not_allowed" | "production" };

type Env = Record<string, string | undefined>;

export function billingStatus(env: Env = process.env, paymentsEnabled: boolean = PRICING.paymentsEnabled): BillingStatus {
  if (!paymentsEnabled) return { enabled: false, reason: "not_approved" };
  const mode = env["RAZORPAY_MODE"];
  const keyId = env["RAZORPAY_KEY_ID"] ?? "";
  const configured = Boolean(keyId && env["RAZORPAY_KEY_SECRET"] && env["RAZORPAY_WEBHOOK_SECRET"] && env["RAZORPAY_PLAN_ID"]);
  if (mode === "live" || keyId.startsWith("rzp_live_")) {
    if (!ALLOW_LIVE_PAYMENTS) return { enabled: false, reason: "live_not_allowed" };
  }
  if (env["VERCEL_ENV"] === "production") return { enabled: false, reason: "production" };
  if (mode !== "test" || !keyId.startsWith("rzp_test_") || !configured) return { enabled: false, reason: "not_configured" };
  return { enabled: true, mode: "test" };
}

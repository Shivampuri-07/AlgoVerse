/**
 * SERVER-ONLY. Is Razorpay checkout allowed on this deployment? Payments stay OFF unless every
 * condition holds:
 *   - TEST mode only: RAZORPAY_MODE=test and a test key id (rzp_test_…), with the key secret,
 *     webhook secret and plan id all set;
 *   - never on a Production deployment (VERCEL_ENV=production).
 * Live mode is impossible from configuration alone: live keys / RAZORPAY_MODE=live are refused
 * unless the owner-approved code switches (PRICING.paymentsEnabled AND ALLOW_LIVE_PAYMENTS) are
 * both flipped in a reviewed commit — and even then Production stays off until that code path is
 * written. See docs/BILLING.md.
 */
import { PRICING } from "@/lib/plans";

/** Flip only with the owner's written approval for live payments. */
export const ALLOW_LIVE_PAYMENTS = false;

export type BillingStatus =
  | { enabled: true; mode: "test" }
  | { enabled: false; reason: "not_configured" | "live_not_allowed" | "production" };

type Env = Record<string, string | undefined>;

export function billingStatus(env: Env = process.env, liveApproved: boolean = PRICING.paymentsEnabled): BillingStatus {
  const mode = env["RAZORPAY_MODE"];
  const keyId = env["RAZORPAY_KEY_ID"] ?? "";
  const configured = Boolean(keyId && env["RAZORPAY_KEY_SECRET"] && env["RAZORPAY_WEBHOOK_SECRET"] && env["RAZORPAY_PLAN_ID"]);
  // Live payments are not implemented/approved: any live signal disables billing entirely.
  if (mode === "live" || keyId.startsWith("rzp_live_")) return { enabled: false, reason: "live_not_allowed" };
  void liveApproved; // reserved for the future, owner-approved live path (with ALLOW_LIVE_PAYMENTS)
  if (env["VERCEL_ENV"] === "production") return { enabled: false, reason: "production" };
  if (mode !== "test" || !keyId.startsWith("rzp_test_") || !configured) return { enabled: false, reason: "not_configured" };
  return { enabled: true, mode: "test" };
}

/** Server-side Razorpay settings for an ENABLED (test) deployment. */
export function razorpaySettings(env: Env = process.env) {
  return {
    keyId: env["RAZORPAY_KEY_ID"] ?? "",
    keySecret: env["RAZORPAY_KEY_SECRET"] ?? "",
    webhookSecret: env["RAZORPAY_WEBHOOK_SECRET"] ?? "",
    planId: env["RAZORPAY_PLAN_ID"] ?? "",
    apiBase: apiBase(env),
  };
}

/**
 * Razorpay's API. RAZORPAY_API_BASE may point to a LOCAL mock (http://127.0.0.1 / localhost) for
 * automated tests only — never on Production, never another host.
 */
function apiBase(env: Env): string {
  const override = env["RAZORPAY_API_BASE"]?.trim();
  if (override && env["VERCEL_ENV"] !== "production") {
    try {
      const u = new URL(override);
      if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return override.replace(/\/+$/, "");
    } catch {
      /* ignore */
    }
  }
  return "https://api.razorpay.com";
}

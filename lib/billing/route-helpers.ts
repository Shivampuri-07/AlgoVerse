/**
 * SERVER-ONLY. Shared pieces of the /api/billing/* routes: the test-mode gate, the Razorpay
 * client and Firestore handles. Billing routes answer 404 whenever billing is disabled (always on
 * Production — lib/billing/config.ts), so nothing about payments is reachable there.
 */
import { jsonResponse } from "@/lib/http";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { billingStatus, razorpaySettings } from "@/lib/billing/config";
import { razorpayClient, RazorpayError } from "@/lib/billing/razorpay";
import { BillingError } from "@/lib/billing/service";
import type { AuthUser } from "@/lib/auth/server";

export function billingDisabled(): Response | null {
  const status = billingStatus();
  return status.enabled ? null : jsonResponse({ error: { code: "billing_disabled", message: "Payments aren't available." } }, 404);
}

export function billingDeps() {
  const settings = razorpaySettings();
  const db = getAdminDb();
  return { settings, db, client: razorpayClient(settings) };
}

/** Verified email from Firebase (the session claim can lag behind a fresh verification). */
export async function hasVerifiedEmail(user: AuthUser): Promise<boolean> {
  if (user.emailVerified) return true;
  const auth = getAdminAuth();
  return auth ? (await auth.getUser(user.uid)).emailVerified : false;
}

/** Safe error answers — codes only, never Razorpay bodies or secrets. */
export function billingErrorResponse(err: unknown, where: string): Response {
  if (err instanceof BillingError) {
    const status = err.code === "already_subscribed" ? 409 : err.code === "no_subscription" ? 409 : 503;
    const message =
      err.code === "already_subscribed"
        ? "You already have an active Pro subscription."
        : err.code === "no_subscription"
          ? "There's no active subscription to cancel."
          : "Payments are unavailable right now. Please try again later.";
    return jsonResponse({ error: { code: err.code, message } }, status);
  }
  const code = err instanceof RazorpayError ? `razorpay_${err.status}_${err.code}` : ((err as { code?: unknown })?.code ?? "unknown");
  console.error(`[billing] ${where} failed (${String(code)})`);
  return jsonResponse({ error: { code: "unavailable", message: "Payments are unavailable right now. Please try again later." } }, 503);
}

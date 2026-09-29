import { authError, jsonResponse, requireUser } from "@/lib/auth/server";
import { startCheckout } from "@/lib/billing/service";
import { billingDeps, billingDisabled, billingErrorResponse, hasVerifiedEmail } from "@/lib/billing/route-helpers";

/**
 * POST /api/billing/checkout — signed-in, same-origin, verified email. Creates the Razorpay
 * subscription and records it as this user's BEFORE the browser opens Razorpay Checkout. Returns
 * only the public key id and subscription id. Paying does not grant Pro here: only the verified
 * webhook does.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const disabled = billingDisabled();
  if (disabled) return disabled;
  const auth = await requireUser(req, { mutation: true });
  if (!auth.ok) return auth.response;
  const { db, client, settings } = billingDeps();
  if (!db) return authError("not_configured");
  try {
    if (!(await hasVerifiedEmail(auth.user))) {
      return jsonResponse({ error: { code: "verify_email", message: "Verify your email address before subscribing." } }, 403);
    }
    const { subscriptionId } = await startCheckout(db, client, auth.user.uid, settings.planId);
    return jsonResponse({ keyId: settings.keyId, subscriptionId, email: auth.user.email });
  } catch (err) {
    return billingErrorResponse(err, "checkout");
  }
}

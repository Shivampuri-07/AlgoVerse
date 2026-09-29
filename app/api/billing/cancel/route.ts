import { authError, jsonResponse, requireUser } from "@/lib/auth/server";
import { cancelSubscription } from "@/lib/billing/service";
import { billingDeps, billingDisabled, billingErrorResponse } from "@/lib/billing/route-helpers";

/**
 * POST /api/billing/cancel — signed-in, same-origin. Cancels the user's own subscription at the
 * end of the paid period (Pro continues until then; Razorpay's webhook then ends it).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const disabled = billingDisabled();
  if (disabled) return disabled;
  const auth = await requireUser(req, { mutation: true });
  if (!auth.ok) return auth.response;
  const { db, client } = billingDeps();
  if (!db) return authError("not_configured");
  try {
    await cancelSubscription(db, client, auth.user.uid);
    return jsonResponse({ ok: true, cancelAtPeriodEnd: true });
  } catch (err) {
    return billingErrorResponse(err, "cancel");
  }
}

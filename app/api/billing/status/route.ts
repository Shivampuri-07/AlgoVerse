import { authError, jsonResponse, requireUser } from "@/lib/auth/server";
import { billingOverview } from "@/lib/billing/service";
import { billingDeps, billingDisabled, billingErrorResponse } from "@/lib/billing/route-helpers";
import { billingStatus } from "@/lib/billing/config";

/**
 * GET /api/billing/status — whether checkout is available here (test mode, never Production) and,
 * for the signed-in user, their subscription and payment history. Display only: Pro itself is
 * decided by entitlements/{uid} on the server.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const status = billingStatus();
  if (!status.enabled) return jsonResponse({ enabled: false });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const disabled = billingDisabled();
  if (disabled) return disabled;
  const { db, settings } = billingDeps();
  if (!db) return authError("not_configured");
  try {
    return jsonResponse({ enabled: true, mode: status.mode, keyId: settings.keyId, ...(await billingOverview(db, auth.user.uid)) });
  } catch (err) {
    return billingErrorResponse(err, "status");
  }
}

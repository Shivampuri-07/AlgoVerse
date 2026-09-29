import { jsonResponse } from "@/lib/http";
import { getAdminDb } from "@/lib/firebase/admin";
import { handleWebhook } from "@/lib/billing/service";
import { billingDeps, billingDisabled } from "@/lib/billing/route-helpers";

/**
 * POST /api/billing/webhook — Razorpay → AlgoVerse. No session: authenticated ONLY by the
 * X-Razorpay-Signature HMAC over the exact raw body. Idempotent by X-Razorpay-Event-Id. Verified
 * events answer 200 (including ignored/duplicate ones) so Razorpay stops retrying; a bad signature
 * answers 400 and changes nothing. Logs carry outcome codes only — never payloads.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const disabled = billingDisabled();
  if (disabled) return disabled;
  const db = getAdminDb();
  if (!db) return jsonResponse({ error: { code: "not_configured" } }, 503);
  const { settings } = billingDeps();
  const rawBody = await req.text();
  try {
    const result = await handleWebhook(db, {
      rawBody,
      signature: req.headers.get("x-razorpay-signature"),
      eventId: req.headers.get("x-razorpay-event-id"),
      secret: settings.webhookSecret,
    });
    if (result.status !== 200) console.error(`[billing] webhook rejected (${result.outcome})`);
    return jsonResponse({ ok: result.status === 200, outcome: result.outcome }, result.status);
  } catch (err) {
    console.error(`[billing] webhook failed (${String((err as { code?: unknown })?.code ?? "unknown")})`);
    return jsonResponse({ error: { code: "unavailable" } }, 503); // Razorpay retries later
  }
}

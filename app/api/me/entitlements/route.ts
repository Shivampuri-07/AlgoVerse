import { authError, jsonResponse, requireUser } from "@/lib/auth/server";
import { getEntitlements } from "@/lib/entitlements";

/** GET → the signed-in user's plan and features (display only; every premium API re-checks). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  try {
    return jsonResponse(await getEntitlements(auth.user.uid));
  } catch (err) {
    console.error(`[entitlements] lookup failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return authError("unavailable");
  }
}

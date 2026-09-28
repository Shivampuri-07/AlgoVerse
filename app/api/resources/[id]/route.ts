import { authError, jsonResponse, requireUser } from "@/lib/auth/server";
import { getEntitlements } from "@/lib/entitlements";
import { getLearningResources } from "@/lib/resources";

/**
 * GET /api/resources/{problemId} → the problem's article and Striver video links (Pro only).
 * The user comes from the verified session; the plan from the server-side entitlement — never
 * from the request. Free or signed-out users get 403/401 and no links. Never cached.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!/^\d{1,6}$/.test(id)) return authError("bad_request");
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  let allowed = false;
  try {
    allowed = (await getEntitlements(auth.user.uid)).features.learningResources;
  } catch (err) {
    console.error(`[resources] entitlement lookup failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return authError("unavailable");
  }
  if (!allowed) {
    return jsonResponse({ error: { code: "not_entitled", message: "Articles and videos are part of AlgoVerse Pro." } }, 403);
  }
  const resources = getLearningResources(Number(id));
  if (!resources) return jsonResponse({ error: { code: "not_found", message: "No such problem." } }, 404);
  return jsonResponse(resources);
}

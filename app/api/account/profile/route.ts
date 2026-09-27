import { authError, jsonResponse, requireUser } from "@/lib/auth/server";
import { normalizeDisplayName } from "@/lib/auth/shared";
import { ensureProfile, getProfile, updateDisplayName } from "@/lib/account/profile";

/**
 * The signed-in user's own profile. The uid always comes from the verified session — any
 * uid/email/plan fields in the request body are ignored.
 *   GET   → { profile: AccountProfile }
 *   PATCH { displayName: string | null } → { profile }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  try {
    const profile = await getProfile(auth.user.uid);
    return profile ? jsonResponse({ profile }) : authError("not_configured");
  } catch (err) {
    console.error(`[account] profile read failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return authError("unavailable");
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const auth = await requireUser(req, { mutation: true });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return authError("bad_request");
  }
  if (!body || typeof body !== "object" || !("displayName" in body)) return authError("bad_request");
  const displayName = normalizeDisplayName((body as { displayName: unknown }).displayName);
  if (displayName === undefined) return authError("bad_request");

  try {
    await ensureProfile(auth.user.uid);
    await updateDisplayName(auth.user.uid, displayName);
    return jsonResponse({ profile: await getProfile(auth.user.uid) });
  } catch (err) {
    console.error(`[account] profile update failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return authError("unavailable");
  }
}

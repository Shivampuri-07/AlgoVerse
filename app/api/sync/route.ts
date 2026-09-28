import { authError, jsonResponse, requireUser } from "@/lib/auth/server";
import { getEntitlements } from "@/lib/entitlements";
import { getAdminDb } from "@/lib/firebase/admin";
import { parseOps, pullChanges, pushOps } from "@/lib/sync/server";

/**
 * Cloud sync (Pro). The uid always comes from the verified session; the entitlement from the
 * server (lib/entitlements.ts) — never from the request.
 *   GET  ?since=<ms>  → changes since the cursor (since=0: everything)   PullResponse
 *   POST { ops }      → applies local changes with the conflict rules      PushResponse
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Authorised = { ok: true; uid: string; db: NonNullable<ReturnType<typeof getAdminDb>> } | { ok: false; response: Response };

async function authorise(req: Request, mutation: boolean): Promise<Authorised> {
  const auth = await requireUser(req, { mutation });
  if (!auth.ok) return { ok: false, response: auth.response };
  const db = getAdminDb();
  if (!db) return { ok: false, response: authError("not_configured") };
  let allowed = false;
  try {
    allowed = (await getEntitlements(auth.user.uid)).features.cloudSync;
  } catch (err) {
    console.error(`[sync] entitlement lookup failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return { ok: false, response: authError("unavailable") };
  }
  if (!allowed) {
    return {
      ok: false,
      response: jsonResponse({ error: { code: "not_entitled", message: "Cloud sync is part of AlgoVerse Pro." } }, 403),
    };
  }
  return { ok: true, uid: auth.user.uid, db };
}

export async function GET(req: Request): Promise<Response> {
  const a = await authorise(req, false);
  if (!a.ok) return a.response;
  const sinceRaw = new URL(req.url).searchParams.get("since") ?? "0";
  const since = /^\d{1,15}$/.test(sinceRaw) ? Number(sinceRaw) : NaN;
  if (!Number.isFinite(since)) return authError("bad_request");
  try {
    return jsonResponse(await pullChanges(a.db, a.uid, since));
  } catch (err) {
    console.error(`[sync] pull failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return authError("unavailable");
  }
}

export async function POST(req: Request): Promise<Response> {
  const a = await authorise(req, true);
  if (!a.ok) return a.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return authError("bad_request");
  }
  const ops = parseOps((body as { ops?: unknown } | null)?.ops);
  if (!ops) return authError("bad_request");
  try {
    return jsonResponse(await pushOps(a.db, a.uid, ops));
  } catch (err) {
    console.error(`[sync] push failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return authError("unavailable");
  }
}

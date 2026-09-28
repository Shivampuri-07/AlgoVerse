import { getEntitlements } from "@/lib/entitlements";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { getRequestUser, isSameOrigin } from "@/lib/auth/server";
import { handleAiGet, handleAiPost, type AiDeps } from "@/lib/ai/handler";
import { firestoreUsageStore } from "@/lib/ai/usage";

/**
 * POST /api/ai — AI helper (Gemini), signed-in users with a verified email, within their daily
 * limit. GET /api/ai — configured? + the caller's allowance. Logic and access rules:
 * lib/ai/handler.ts; limits: lib/ai/usage.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const deps: AiDeps = {
  async authenticate(req) {
    if (!getAdminAuth()) return "unavailable";
    return getRequestUser(req);
  },
  sameOrigin: isSameOrigin,
  async emailVerified(user) {
    if (user.emailVerified) return true;
    // The session's claim can lag behind a just-completed verification: ask Firebase.
    const auth = getAdminAuth();
    return auth ? (await auth.getUser(user.uid)).emailVerified : false;
  },
  async plan(uid) {
    return (await getEntitlements(uid)).plan;
  },
  usage() {
    const db = getAdminDb();
    return db ? firestoreUsageStore(db) : null;
  },
  now: () => Date.now(),
};

export function POST(req: Request): Promise<Response> {
  return handleAiPost(req, deps);
}

export function GET(req: Request): Promise<Response> {
  return handleAiGet(req, deps);
}

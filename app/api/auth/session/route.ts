import { getAdminAuth } from "@/lib/firebase/admin";
import {
  authError,
  clearSessionCookieHeader,
  getRequestUser,
  isRecentSignIn,
  isSameOrigin,
  jsonResponse,
  readCookie,
  sessionCookieHeader,
  verifySessionValue,
} from "@/lib/auth/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, type SessionUser } from "@/lib/auth/shared";
import { ensureProfile } from "@/lib/account/profile";

/**
 * Browser session management.
 *   GET    → { user: SessionUser | null } for the current session cookie
 *   POST   { idToken } → verifies a Firebase ID token from a recent sign-in and sets the
 *          HTTP-only session cookie (the browser never sees the cookie value)
 *   DELETE [?everywhere=1] → clears the cookie; `everywhere` also revokes every session and
 *          refresh token of the user (signs out all devices)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sessionUser(u: { uid: string; email: string | null; emailVerified: boolean }, displayName: string | null = null): SessionUser {
  return { uid: u.uid, email: u.email, emailVerified: u.emailVerified, displayName };
}

export async function GET(req: Request): Promise<Response> {
  if (!getAdminAuth()) return jsonResponse({ user: null, configured: false });
  const user = await verifySessionValue(readCookie(req, SESSION_COOKIE));
  return jsonResponse({ user: user ? sessionUser(user) : null, configured: true });
}

export async function POST(req: Request): Promise<Response> {
  const auth = getAdminAuth();
  if (!auth) return authError("not_configured");
  if (!isSameOrigin(req)) return authError("forbidden");

  let idToken: unknown;
  try {
    idToken = ((await req.json()) as { idToken?: unknown })?.idToken;
  } catch {
    return authError("bad_request");
  }
  if (typeof idToken !== "string" || idToken.length < 20 || idToken.length > 8192) return authError("bad_request");

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken, true);
  } catch {
    return authError("unauthenticated");
  }
  // Only a fresh sign-in may mint a long-lived session cookie (Firebase's recommendation), so
  // a leaked old ID token can't be turned into a two-week session.
  if (!isRecentSignIn(decoded.auth_time)) return authError("stale_sign_in");

  let cookie: string;
  try {
    cookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_SECONDS * 1000 });
    await ensureProfile(decoded.uid);
  } catch (err) {
    console.error(`[auth] session creation failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return authError("unavailable");
  }

  const user = sessionUser({
    uid: decoded.uid,
    email: typeof decoded.email === "string" ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
  });
  return jsonResponse({ user }, 200, { "Set-Cookie": sessionCookieHeader(cookie) });
}

export async function DELETE(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return authError("forbidden");
  const clear = { "Set-Cookie": clearSessionCookieHeader() };
  const everywhere = new URL(req.url).searchParams.get("everywhere") === "1";
  if (everywhere) {
    const auth = getAdminAuth();
    const user = auth ? await getRequestUser(req) : null;
    if (!auth || !user) return authError("unauthenticated", clear);
    try {
      await auth.revokeRefreshTokens(user.uid);
    } catch {
      return authError("unavailable", clear);
    }
  }
  return jsonResponse({ ok: true }, 200, clear);
}

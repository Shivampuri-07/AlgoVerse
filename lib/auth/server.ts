/**
 * SERVER-ONLY request authentication. Every protected route handler and server component
 * gets the user from here — never from a user id, email or plan sent by the client.
 *
 * Two ways in:
 *   - Browser: the HTTP-only `algoverse_session` cookie (a Firebase session cookie), checked
 *     with `verifySessionCookie(..., checkRevoked = true)`. State-changing requests
 *     authenticated by cookie must also pass the same-origin check (CSRF protection).
 *   - Future Android / API clients: `Authorization: Bearer <Firebase ID token>`, checked with
 *     `verifyIdToken(..., checkRevoked = true)`. No ambient credentials, so no CSRF check.
 */
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminState } from "@/lib/firebase/admin";
import { jsonResponse } from "@/lib/http";
import {
  AUTH_ERROR_MESSAGES,
  RECENT_SIGN_IN_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type AuthErrorCode,
} from "@/lib/auth/shared";

export interface AuthUser {
  uid: string;
  email: string | null;
  /** From the token/cookie claims; may lag behind a just-completed verification. */
  emailVerified: boolean;
  via: "cookie" | "bearer";
}

const MAX_TOKEN_LENGTH = 8192;

function toUser(decoded: DecodedIdToken, via: AuthUser["via"]): AuthUser {
  return {
    uid: decoded.uid,
    email: typeof decoded.email === "string" ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
    via,
  };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

/** Validates a session cookie value. Returns null for anything missing, invalid, expired or revoked. */
export async function verifySessionValue(value: string | null | undefined): Promise<AuthUser | null> {
  if (!value || value.length > MAX_TOKEN_LENGTH) return null;
  const auth = getAdminAuth();
  if (!auth) return null;
  try {
    return toUser(await auth.verifySessionCookie(value, true), "cookie");
  } catch {
    return null;
  }
}

async function verifyBearer(token: string): Promise<AuthUser | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const auth = getAdminAuth();
  if (!auth) return null;
  try {
    return toUser(await auth.verifyIdToken(token, true), "bearer");
  } catch {
    return null;
  }
}

/** The authenticated user for a request, or null. */
export async function getRequestUser(req: Request): Promise<AuthUser | null> {
  const authz = req.headers.get("authorization");
  if (authz) {
    const match = /^Bearer\s+(\S+)$/i.exec(authz);
    return match ? verifyBearer(match[1]) : null;
  }
  return verifySessionValue(readCookie(req, SESSION_COOKIE));
}

/**
 * CSRF check for cookie-authenticated, state-changing requests: the browser-sent Origin must
 * match the host the request was made to. Falls back to Sec-Fetch-Site when Origin is absent.
 */
export function isSameOrigin(req: Request): boolean {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
}

export function isRecentSignIn(authTimeSeconds: number, nowMs = Date.now()): boolean {
  return Number.isFinite(authTimeSeconds) && nowMs / 1000 - authTimeSeconds <= RECENT_SIGN_IN_SECONDS;
}

export { jsonResponse };

const STATUS: Record<AuthErrorCode, number> = {
  not_configured: 503,
  server_credentials_invalid: 503,
  project_mismatch: 503,
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  stale_sign_in: 401,
  unavailable: 503,
};

export function authError(code: AuthErrorCode, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error: { code, message: AUTH_ERROR_MESSAGES[code] } }, STATUS[code], headers);
}

/** The error to answer with when the Admin SDK isn't usable: missing vs invalid credentials. */
export function adminUnavailableError(): Response {
  const state = getAdminState();
  if (state === "invalid") return authError("server_credentials_invalid");
  if (state === "project_mismatch") return authError("project_mismatch");
  return authError("not_configured");
}

/** Admin SDK errors that mean the server's own credentials are wrong (revoked/deleted key…). */
export function isCredentialError(err: unknown): boolean {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  return (
    code === "app/invalid-credential" ||
    code === "auth/invalid-credential" ||
    code === "auth/insufficient-permission" ||
    /invalid_grant|invalid JWT Signature|Failed to determine service account|credential implementation/i.test(message)
  );
}

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; response: Response };

/**
 * Gate for protected route handlers.
 *   const auth = await requireUser(req, { mutation: true });
 *   if (!auth.ok) return auth.response;
 */
export async function requireUser(req: Request, opts: { mutation?: boolean } = {}): Promise<AuthResult> {
  if (!getAdminAuth()) return { ok: false, response: adminUnavailableError() };
  const user = await getRequestUser(req);
  if (!user) return { ok: false, response: authError("unauthenticated") };
  if (opts.mutation && user.via === "cookie" && !isSameOrigin(req)) {
    return { ok: false, response: authError("forbidden") };
  }
  return { ok: true, user };
}

export function sessionCookieHeader(value: string, maxAgeSeconds = SESSION_MAX_AGE_SECONDS): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearSessionCookieHeader(): string {
  return sessionCookieHeader("", 0);
}

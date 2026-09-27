/**
 * Browser-side Firebase Auth. The SDK is loaded lazily (dynamic import) so pages that never
 * touch accounts don't pay for it on first paint. Passwords go straight from the browser to
 * Firebase Auth over HTTPS — AlgoVerse's server never sees or stores them.
 */
import type { Auth, User } from "firebase/auth";
import { getAuthEmulatorHost, getFirebasePublicConfig } from "@/lib/firebase/config";
import { AUTH_ERROR_MESSAGES, type AuthErrorCode, type SessionUser } from "@/lib/auth/shared";

let authPromise: Promise<Auth> | null = null;

export function loadAuth(): Promise<Auth> {
  if (authPromise) return authPromise;
  const config = getFirebasePublicConfig();
  if (!config) return Promise.reject(new Error("not_configured"));
  authPromise = (async () => {
    const [{ initializeApp, getApps }, authMod] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const app = getApps()[0] ?? initializeApp(config);
    const auth = authMod.getAuth(app);
    const emulator = getAuthEmulatorHost();
    if (emulator) authMod.connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
    return auth;
  })();
  authPromise.catch(() => {
    authPromise = null;
  });
  return authPromise;
}

export class AccountError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** Friendly copy for Firebase Auth error codes. Unknown codes get a generic message. */
export function firebaseErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (err instanceof AccountError) return err.message;
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-login-credentials":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Choose a stronger password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Couldn't reach the sign-in service. Check your connection and try again.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support if you think this is a mistake.";
    case "auth/requires-recent-login":
      return "For your security, please sign in again first.";
    case "auth/operation-not-allowed":
      return "Email sign-in isn't enabled for this app yet.";
    default:
      return "Something went wrong. Please try again.";
  }
}

async function readError(res: Response): Promise<AccountError> {
  let code: AuthErrorCode = res.status === 401 ? "unauthenticated" : "unavailable";
  let message: string = AUTH_ERROR_MESSAGES[code];
  try {
    const data = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof data?.error?.code === "string") code = data.error.code as AuthErrorCode;
    if (typeof data?.error?.message === "string") message = data.error.message;
  } catch {
    /* non-JSON */
  }
  return new AccountError(message, code);
}

export async function fetchSession(): Promise<SessionUser | null> {
  const res = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { user?: SessionUser | null };
  return data.user ?? null;
}

const inflight = new Map<string, Promise<SessionUser>>();

/** Exchanges the Firebase user's fresh ID token for the HTTP-only session cookie. Deduplicated per uid. */
export function createServerSession(user: User): Promise<SessionUser> {
  const existing = inflight.get(user.uid);
  if (existing) return existing;
  const p = (async () => {
    const idToken = await user.getIdToken();
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) throw await readError(res);
    const data = (await res.json()) as { user: SessionUser };
    return { ...data.user, displayName: user.displayName ?? data.user.displayName };
  })();
  inflight.set(user.uid, p);
  p.finally(() => inflight.delete(user.uid)).catch(() => {});
  return p;
}

export async function deleteServerSession(everywhere = false): Promise<void> {
  const res = await fetch(`/api/auth/session${everywhere ? "?everywhere=1" : ""}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok && res.status !== 401) throw await readError(res);
}

export async function patchProfile(displayName: string | null) {
  const res = await fetch("/api/account/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { profile: import("@/lib/auth/shared").AccountProfile };
}

/** Where Firebase's emails (verification / reset) send the user back to. */
export function continueUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

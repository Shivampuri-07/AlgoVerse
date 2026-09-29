/**
 * Browser-side Firebase Auth. The SDK is loaded lazily (dynamic import) so pages that never
 * touch accounts don't pay for it on first paint. Passwords go straight from the browser to
 * Firebase Auth over HTTPS — AlgoVerse's server never sees or stores them.
 */
import type { Auth, User } from "firebase/auth";
import type { FirebasePublicConfig } from "@/lib/firebase/config";
import { AUTH_ERROR_MESSAGES, type AuthErrorCode, type SessionUser } from "@/lib/auth/shared";

let authPromise: Promise<Auth> | null = null;
let loadedFor: string | null = null;

/**
 * Loads Firebase Auth for the given public config (from useFirebaseSetup(), which merges the
 * build-time and request-time values). Loaded once per page.
 */
export function loadAuth(config: FirebasePublicConfig | null, emulatorHost: string | null = null): Promise<Auth> {
  if (!config) return Promise.reject(new AccountError("Accounts aren't set up on this site yet.", "not_configured"));
  const key = `${config.projectId}|${config.apiKey}|${emulatorHost ?? ""}`;
  if (authPromise && loadedFor === key) return authPromise;
  loadedFor = key;
  authPromise = (async () => {
    const [{ initializeApp, getApps }, authMod] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const app = getApps()[0] ?? initializeApp(config);
    const auth = authMod.getAuth(app);
    if (emulatorHost) authMod.connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
    return auth;
  })();
  authPromise.catch(() => {
    authPromise = null;
    loadedFor = null;
  });
  return authPromise;
}

export class AccountError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const CREDENTIAL_CODES = new Set(["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"]);

/** Firebase's generic "email or password didn't match" (it never says which, by design). */
export function isCredentialError(err: unknown): boolean {
  return CREDENTIAL_CODES.has(String((err as { code?: unknown } | null)?.code ?? ""));
}

/**
 * Preview deployments use their own Firebase project, i.e. a separate user database: an account
 * made on the live site doesn't exist there with its password. Shown only on Preview, after a
 * credential error — never on Production, and it doesn't reveal whether an account exists.
 */
export function previewAccountsNote(): string {
  return "This Preview uses its own accounts, separate from the live site. If your password was set on the live site, it won't work here. Continue with Google, or sign in with Google and use Account → Set a password.";
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
    case "auth/provider-already-linked":
      return "This account already has a password. Use Change password instead.";
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

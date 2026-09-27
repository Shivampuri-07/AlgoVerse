"use client";

import * as React from "react";
import type { Auth, User } from "firebase/auth";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import {
  AccountError,
  continueUrl,
  createServerSession,
  deleteServerSession,
  fetchSession,
  loadAuth,
} from "@/lib/auth/client";
import type { SessionUser } from "@/lib/auth/shared";

/**
 * Account state for the whole app.
 *
 * Two pieces must agree: the Firebase Auth client (keeps the user signed in inside the
 * browser, sends verification/reset emails) and the server's HTTP-only session cookie (what
 * protected pages and APIs trust). On every auth change they are reconciled:
 *   client user + no/other server session → create a session (needs a recent sign-in; if the
 *                                            sign-in is old, sign the client out instead)
 *   no client user + server session       → clear the server session
 * Nothing here touches the local progress store: signing in or out never changes or deletes
 * the progress saved on this device.
 */
export type AuthStatus = "loading" | "signed-out" | "signed-in" | "unavailable";

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  signUp: (email: string, password: string) => Promise<SessionUser>;
  signOut: (opts?: { everywhere?: boolean }) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Re-reads the Firebase user (e.g. after clicking the verification link). */
  refresh: () => Promise<void>;
  setDisplayName: (name: string | null) => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

/** Session errors that retrying with the same Firebase sign-in can't fix. */
const FINAL_SESSION_ERRORS = new Set([
  "stale_sign_in",
  "unauthenticated",
  "not_configured",
  "server_credentials_invalid",
  "project_mismatch",
]);

/** Exchanges the sign-in for a server session; on failure signs the browser out and rethrows. */
async function sessionOrSignOut(auth: Auth, fbUser: User, prefix = ""): Promise<SessionUser> {
  try {
    return await createServerSession(fbUser);
  } catch (err) {
    const { signOut } = await import("firebase/auth");
    await signOut(auth).catch(() => {});
    if (prefix && err instanceof AccountError) throw new AccountError(`${prefix} ${err.message}`, err.code);
    throw err;
  }
}

async function sendVerification(user: User) {
  const { sendEmailVerification } = await import("firebase/auth");
  try {
    await sendEmailVerification(user, { url: continueUrl("/account?verified=1") });
  } catch (err) {
    // The continue URL must be an authorised domain in the Firebase console; if it isn't,
    // still send the email (Firebase's own confirmation page is used instead).
    const code = (err as { code?: string }).code ?? "";
    if (/continue-uri|unauthorized-domain/.test(code)) await sendEmailVerification(user);
    else throw err;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Public config is built into the bundle; without it there is nothing to load.
  const configured = isFirebaseConfigured();
  const [status, setStatus] = React.useState<AuthStatus>(configured ? "loading" : "unavailable");
  const [user, setUser] = React.useState<SessionUser | null>(null);

  const applySignedIn = React.useCallback((u: SessionUser) => {
    setUser(u);
    setStatus("signed-in");
  }, []);
  const applySignedOut = React.useCallback(() => {
    setUser(null);
    setStatus("signed-out");
  }, []);

  React.useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      try {
        const auth = await loadAuth();
        const { onAuthStateChanged, signOut } = await import("firebase/auth");
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
          try {
            const server = await fetchSession().catch(() => null);
            if (cancelled) return;
            if (fbUser) {
              if (server && server.uid === fbUser.uid) {
                applySignedIn({ ...server, emailVerified: fbUser.emailVerified, displayName: fbUser.displayName });
                return;
              }
              try {
                applySignedIn(await createServerSession(fbUser));
              } catch (err) {
                // Old sign-in (session expired after two weeks), revoked, or the server can't
                // create sessions (setup problem): sign the browser out too, so both sides agree.
                if (err instanceof AccountError && FINAL_SESSION_ERRORS.has(err.code)) {
                  await signOut(auth);
                  applySignedOut();
                } else if (server === null) {
                  applySignedOut();
                }
              }
            } else {
              if (server) await deleteServerSession().catch(() => {});
              applySignedOut();
            }
          } catch {
            if (!cancelled) applySignedOut();
          }
        });
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [configured, applySignedIn, applySignedOut]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      async signIn(email, password) {
        const auth = await loadAuth();
        const { signInWithEmailAndPassword } = await import("firebase/auth");
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        const session = await sessionOrSignOut(auth, cred.user);
        applySignedIn(session);
        return session;
      },
      async signUp(email, password) {
        const auth = await loadAuth();
        const { createUserWithEmailAndPassword } = await import("firebase/auth");
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        // A failed verification email must not block the account; it can be resent from /account.
        await sendVerification(cred.user).catch(() => {});
        const session = await sessionOrSignOut(
          auth,
          cred.user,
          "Your account was created, but you couldn't be signed in yet:"
        );
        applySignedIn(session);
        return session;
      },
      async signOut(opts) {
        // Server first: with `everywhere` the revocation needs the still-valid session.
        await deleteServerSession(Boolean(opts?.everywhere));
        const auth = await loadAuth();
        const { signOut } = await import("firebase/auth");
        await signOut(auth);
        applySignedOut();
      },
      async sendPasswordReset(email) {
        const auth = await loadAuth();
        const { sendPasswordResetEmail } = await import("firebase/auth");
        try {
          await sendPasswordResetEmail(auth, email.trim(), { url: continueUrl("/login") });
        } catch (err) {
          const code = (err as { code?: string }).code ?? "";
          // Don't reveal whether an account exists for this email.
          if (code === "auth/user-not-found") return;
          if (/continue-uri|unauthorized-domain/.test(code)) {
            await sendPasswordResetEmail(auth, email.trim());
            return;
          }
          throw err;
        }
      },
      async resendVerification() {
        const auth = await loadAuth();
        if (!auth.currentUser) throw new AccountError("For your security, please sign in again first.", "stale_sign_in");
        await sendVerification(auth.currentUser);
      },
      async refresh() {
        const auth = await loadAuth();
        const current = auth.currentUser;
        if (!current) return;
        await current.reload();
        setUser((u) =>
          u && u.uid === current.uid ? { ...u, emailVerified: current.emailVerified, displayName: current.displayName ?? u.displayName } : u
        );
      },
      setDisplayName(name) {
        setUser((u) => (u ? { ...u, displayName: name } : u));
      },
    }),
    [status, user, applySignedIn, applySignedOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

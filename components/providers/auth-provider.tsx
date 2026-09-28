"use client";

import * as React from "react";
import type { Auth, User } from "firebase/auth";
import { useFirebaseSetup } from "@/components/providers/firebase-config-provider";
import {
  AccountError,
  continueUrl,
  createServerSession,
  deleteServerSession,
  fetchSession,
  loadAuth,
} from "@/lib/auth/client";
import type { AccountProfile, SessionUser } from "@/lib/auth/shared";
import {
  cooldownRemaining,
  firebaseErrorInfo,
  requestVerificationEmail,
  type VerificationOutcome,
} from "@/lib/auth/verification";

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
  /** Result of the latest verification-email request for the signed-in user (this browser). */
  verification: VerificationOutcome | null;
  /** Asks Firebase to send the verification email again. Honours the cooldown; never throws. */
  resendVerification: () => Promise<VerificationOutcome>;
  /**
   * Re-reads the Firebase user and asks the SERVER (fresh Firebase Admin lookup) whether the
   * email is verified. Only a `true` from Firebase marks the account verified.
   */
  checkVerification: () => Promise<boolean>;
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

const LAST_SENT_KEY = "algoverse-verification-sent-at";

/** When this browser last got a verification email accepted for `uid` (for the cooldown). */
function readLastSent(uid: string): number | null {
  try {
    const raw = window.localStorage.getItem(`${LAST_SENT_KEY}:${uid}`);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

function writeLastSent(uid: string, at: number) {
  try {
    window.localStorage.setItem(`${LAST_SENT_KEY}:${uid}`, String(at));
  } catch {
    /* storage unavailable — the in-memory outcome still enforces the cooldown */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Public web config (build-time or request-time); without it there is nothing to load.
  const { config, authEmulatorHost } = useFirebaseSetup();
  const configured = config !== null;
  const load = React.useCallback(() => loadAuth(config, authEmulatorHost), [config, authEmulatorHost]);
  const [status, setStatus] = React.useState<AuthStatus>(configured ? "loading" : "unavailable");
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [verification, setVerification] = React.useState<VerificationOutcome | null>(null);
  const { details: diagnostics } = useFirebaseSetup();
  const sendingRef = React.useRef<Promise<VerificationOutcome> | null>(null);

  /**
   * One verification-email request with safe diagnostics (non-production only): outcome,
   * Firebase error code/reason, whether a user is present and already verified. Never the
   * email address, tokens or the user object.
   */
  const sendVerificationEmail = React.useCallback(
    async (fbUser: User): Promise<VerificationOutcome> => {
      // One request at a time (double clicks, sign-up + resend racing).
      if (sendingRef.current) return sendingRef.current;
      const run = (async () => {
        const outcome = await requestVerificationEmail(fbUser, continueUrl("/account?verified=1"));
        if (outcome.ok) writeLastSent(fbUser.uid, outcome.at);
        setVerification(outcome);
        if (diagnostics) {
          console.info("[auth] verification email request", {
            result: outcome.ok ? "accepted by Firebase (sendOobCode 200)" : "rejected by Firebase",
            code: outcome.ok ? outcome.fallbackCode ?? null : outcome.code,
            reason: outcome.ok ? null : outcome.detail || null,
            continueUrlUsed: outcome.ok ? outcome.continueUrlUsed : null,
            userPresent: true,
            emailVerified: fbUser.emailVerified,
          });
        }
        return outcome;
      })();
      sendingRef.current = run;
      try {
        return await run;
      } finally {
        sendingRef.current = null;
      }
    },
    [diagnostics]
  );

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
        const auth = await load();
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
  }, [configured, load, applySignedIn, applySignedOut]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      async signIn(email, password) {
        const auth = await load();
        const { signInWithEmailAndPassword } = await import("firebase/auth");
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        const session = await sessionOrSignOut(auth, cred.user);
        applySignedIn(session);
        return session;
      },
      async signUp(email, password) {
        const auth = await load();
        const { createUserWithEmailAndPassword } = await import("firebase/auth");
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        // A failed verification email doesn't block the account, but the outcome is kept and
        // shown on /account (no silent failure); it can be resent from there.
        await sendVerificationEmail(cred.user);
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
        const auth = await load();
        const { signOut } = await import("firebase/auth");
        await signOut(auth);
        setVerification(null);
        applySignedOut();
      },
      async sendPasswordReset(email) {
        const auth = await load();
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
      verification,
      async resendVerification() {
        let auth: Auth;
        try {
          auth = await load();
        } catch (err) {
          return { ok: false, at: Date.now(), ...firebaseErrorInfo(err) };
        }
        const current = auth.currentUser;
        if (!current) {
          return { ok: false, at: Date.now(), code: "app/no-current-user", detail: "" };
        }
        if (current.emailVerified) {
          return { ok: false, at: Date.now(), code: "app/already-verified", detail: "" };
        }
        const last = Math.max(readLastSent(current.uid) ?? 0, verification?.ok ? verification.at : 0);
        const wait = cooldownRemaining(last);
        if (wait > 0) return { ok: false, at: Date.now(), code: "app/cooldown", detail: String(Math.ceil(wait / 1000)) };
        return sendVerificationEmail(current);
      },
      async checkVerification() {
        try {
          const auth = await load();
          const current = auth.currentUser;
          if (current) {
            await current.reload();
            // Refresh the ID token so its email_verified claim is current too.
            if (current.emailVerified) await current.getIdToken(true);
          }
        } catch {
          /* fall through to the server check */
        }
        const res = await fetch("/api/account/profile", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok) return false;
        const { profile } = (await res.json()) as { profile: AccountProfile };
        setUser((u) => (u && u.uid === profile.uid ? { ...u, emailVerified: profile.emailVerified } : u));
        return profile.emailVerified === true;
      },
      async refresh() {
        const auth = await load();
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
    [status, user, verification, load, sendVerificationEmail, applySignedIn, applySignedOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

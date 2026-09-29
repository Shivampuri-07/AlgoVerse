"use client";

import * as React from "react";
import type { Auth, User } from "firebase/auth";
import { useFirebaseSetup } from "@/components/providers/firebase-config-provider";
import { markNewAccount } from "@/lib/workspace";
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
  INITIAL_VERIFICATION_STATE,
  applyOutcome,
  firebaseErrorInfo,
  newerState,
  parseStoredState,
  requestGate,
  requestVerificationEmail,
  type VerificationOutcome,
  type VerificationState,
} from "@/lib/auth/verification";
import {
  createGoogleProvider,
  googleErrorMessage,
  isGoogleCancel,
  type GoogleOutcome,
  type PendingGoogleLink,
} from "@/lib/auth/google";

/**
 * Account state for the whole app.
 *
 * Two pieces must agree: the Firebase Auth client (keeps the user signed in inside the
 * browser, sends verification/reset emails) and the server's HTTP-only session cookie (what
 * protected pages and APIs trust). On every auth change they are reconciled:
 *   client user + no/other server session → create a session (needs a recent sign-in; if the
 *                                            sign-in is old, sign the client out instead)
 *   no client user + server session       → clear the server session
 * Nothing here touches the local progress store. Whose progress is shown is decided from
 * `firebaseUid`/`status` by lib/workspace.ts (via the sync provider): each account and the
 * signed-out guest have their own local data, and nothing is ever deleted.
 */
export type AuthStatus = "loading" | "signed-out" | "signed-in" | "unavailable";

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /**
   * The Firebase client user on this device (undefined while loading). Unlike `user` it doesn't
   * need the server session, so it still identifies the person offline. Decides whose local
   * progress is shown (lib/workspace.ts) — never used to authorise anything.
   */
  firebaseUid: string | null | undefined;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  signUp: (email: string, password: string) => Promise<SessionUser>;
  signOut: (opts?: { everywhere?: boolean }) => Promise<void>;
  /**
   * Adds a password to the signed-in account that has none (e.g. created with Google), with
   * Firebase's updatePassword on the CURRENT user: same account and UID, email unchanged, Google
   * stays linked, nothing is created. Accounts that already have a password use sendPasswordReset.
   */
  setPassword: (password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  /**
   * Verification-email state for the signed-in user, persisted per account: the fixed pause
   * expiry, the last REAL Firebase answer, and how many rate-limit answers came in a row.
   */
  verificationState: VerificationState;
  /**
   * Asks Firebase to send the verification email once. During a pause it makes ZERO requests
   * and returns an "app/cooldown" outcome without changing the pause. Never throws.
   */
  resendVerification: () => Promise<VerificationOutcome>;
  /** Sign in (or up) with Google in a popup; falls back to nothing automatically. Never throws. */
  signInWithGoogle: () => Promise<GoogleOutcome>;
  /** Same as signInWithGoogle but by full-page redirect (when pop-ups are blocked). */
  signInWithGoogleRedirect: () => Promise<GoogleOutcome>;
  /** Links a Google identity to the signed-in account (popup). Never throws. */
  linkGoogle: () => Promise<GoogleOutcome>;
  /** Set when Google sign-in needs the existing account's password first (email only). */
  pendingGoogleLink: { email: string | null } | null;
  /** After a password sign-in: links the pending Google credential to this account. */
  completePendingGoogleLink: () => Promise<GoogleOutcome>;
  cancelPendingGoogleLink: () => void;
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

const STATE_KEY = "algoverse-verification-state";
const CONTINUE_REJECTED_KEY = "algoverse-verification-continue-rejected";
/** Format written by e8d6237 — read once and migrated. */
const OLD_BLOCK_KEY = "algoverse-verification-block";

/** Persisted verification state for `uid` (no email address or token is ever stored). */
function readState(uid: string): VerificationState | null {
  try {
    return (
      parseStoredState(window.localStorage.getItem(`${STATE_KEY}:${uid}`)) ??
      parseStoredState(window.localStorage.getItem(`${OLD_BLOCK_KEY}:${uid}`))
    );
  } catch {
    return null;
  }
}

function writeState(uid: string, state: VerificationState) {
  try {
    window.localStorage.setItem(`${STATE_KEY}:${uid}`, JSON.stringify(state));
    window.localStorage.removeItem(`${OLD_BLOCK_KEY}:${uid}`);
  } catch {
    /* storage unavailable — the in-memory state still enforces the pause */
  }
}

/** This site's continue URL was rejected by Firebase (domain not authorised): don't try it again. */
function continueUrlRejected(): boolean {
  try {
    return window.localStorage.getItem(`${CONTINUE_REJECTED_KEY}:${window.location.origin}`) === "1";
  } catch {
    return false;
  }
}

function rememberContinueUrlRejected() {
  try {
    window.localStorage.setItem(`${CONTINUE_REJECTED_KEY}:${window.location.origin}`, "1");
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Public web config (build-time or request-time); without it there is nothing to load.
  const { config, authEmulatorHost } = useFirebaseSetup();
  const configured = config !== null;
  const load = React.useCallback(() => loadAuth(config, authEmulatorHost), [config, authEmulatorHost]);
  const [status, setStatus] = React.useState<AuthStatus>(configured ? "loading" : "unavailable");
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [firebaseUid, setFirebaseUid] = React.useState<string | null | undefined>(undefined);
  const [verificationState, setVerificationState] = React.useState<VerificationState>(INITIAL_VERIFICATION_STATE);
  const stateRef = React.useRef<{ uid: string | null; state: VerificationState }>({ uid: null, state: INITIAL_VERIFICATION_STATE });
  const { details: diagnostics, deployment } = useFirebaseSetup();
  const sendingRef = React.useRef<Promise<VerificationOutcome> | null>(null);
  const pendingLinkRef = React.useRef<PendingGoogleLink | null>(null);
  const [pendingGoogleLink, setPendingGoogleLink] = React.useState<{ email: string | null } | null>(null);

  /** Single place that changes the verification state: memory + storage + render. */
  const commitState = React.useCallback((uid: string, state: VerificationState) => {
    stateRef.current = { uid, state };
    writeState(uid, state);
    setVerificationState(state);
  }, []);

  /** Current state for `uid`: the newer of memory and storage (another tab may have acted). */
  const currentState = React.useCallback((uid: string): VerificationState => {
    const mem = stateRef.current.uid === uid ? stateRef.current.state : null;
    return newerState(mem, readState(uid));
  }, []);

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
        const outcome = await requestVerificationEmail(
          fbUser,
          continueUrlRejected() ? null : continueUrl("/account?verified=1")
        );
        if (outcome.ok && outcome.fallbackCode) rememberContinueUrlRejected();
        const next = applyOutcome(currentState(fbUser.uid), outcome);
        commitState(fbUser.uid, next);
        const until = next.until;
        if (diagnostics) {
          console.info("[auth] verification email request", {
            result: outcome.ok ? "accepted by Firebase (sendOobCode 200)" : "rejected by Firebase",
            code: outcome.ok ? outcome.fallbackCode ?? null : outcome.code,
            reason: outcome.ok ? null : outcome.detail || null,
            continueUrlUsed: outcome.ok ? outcome.continueUrlUsed : null,
            nextRequestAllowedInSeconds: Math.max(0, Math.round((until - Date.now()) / 1000)),
            consecutiveRateLimits: next.rateLimitStreak,
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
    [diagnostics, currentState, commitState]
  );

  const applySignedIn = React.useCallback((u: SessionUser) => {
    setUser(u);
    setStatus("signed-in");
    // Restore this account's verification state (fixed pause expiry, last Firebase answer).
    const state = newerState(stateRef.current.uid === u.uid ? stateRef.current.state : null, readState(u.uid));
    stateRef.current = { uid: u.uid, state };
    setVerificationState(state);
  }, []);
  const applySignedOut = React.useCallback(() => {
    setUser(null);
    setStatus("signed-out");
    stateRef.current = { uid: null, state: INITIAL_VERIFICATION_STATE };
    setVerificationState(INITIAL_VERIFICATION_STATE);
  }, []);

  // Another tab changed this account's verification state: follow it (never extends it by itself).
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const uid = stateRef.current.uid;
      if (!uid || e.key !== `${STATE_KEY}:${uid}`) return;
      const state = newerState(stateRef.current.state, parseStoredState(e.newValue));
      stateRef.current = { uid, state };
      setVerificationState(state);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /** Firebase error from a Google flow → outcome. Remembers a pending link credential when needed. */
  const googleFailure = React.useCallback(async (err: unknown): Promise<GoogleOutcome> => {
    if (err instanceof AccountError) return { status: "error", code: err.code, message: err.message };
    const { code } = firebaseErrorInfo(err);
    if (isGoogleCancel(code)) return { status: "cancelled" };
    if (code === "auth/account-exists-with-different-credential") {
      const { GoogleAuthProvider } = await import("firebase/auth");
      const credential = GoogleAuthProvider.credentialFromError(err as never);
      const email = ((err as { customData?: { email?: unknown } }).customData?.email as string | undefined) ?? null;
      if (credential) {
        pendingLinkRef.current = { credential, email };
        setPendingGoogleLink({ email });
      }
      return { status: "link-required", email };
    }
    return {
      status: "error",
      code,
      message: googleErrorMessage(code, {
        host: typeof window !== "undefined" ? window.location.hostname : undefined,
        projectId: config?.projectId ?? null,
        stableHost: deployment?.stableHost ?? null,
        details: diagnostics,
      }),
    };
  }, [config?.projectId, deployment?.stableHost, diagnostics]);

  /** After any Google sign-in: fresh Firebase state, then the server session. */
  const finishGoogleSignIn = React.useCallback(
    async (auth: Auth, fbUser: User, isNewUser: boolean): Promise<GoogleOutcome> => {
      await fbUser.reload().catch(() => {});
      const session = await sessionOrSignOut(auth, fbUser);
      // emailVerified comes from Firebase (the reloaded user), never from Google's profile or the UI.
      applySignedIn({ ...session, emailVerified: fbUser.emailVerified, displayName: fbUser.displayName ?? session.displayName });
      return {
        status: "signed-in",
        isNewUser,
        emailVerified: fbUser.emailVerified,
        passwordRemoved: session.notice === "password_removed",
      };
    },
    [applySignedIn]
  );

  React.useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      try {
        const auth = await load();
        const { onAuthStateChanged, signOut, getRedirectResult } = await import("firebase/auth");
        if (cancelled) return;
        // Returning from a Google redirect sign-in: surface conflicts (link required) and errors.
        try {
          const redirect = await getRedirectResult(auth);
          if (redirect) {
            const { getAdditionalUserInfo } = await import("firebase/auth");
            if (getAdditionalUserInfo(redirect)?.isNewUser) markNewAccount(redirect.user.uid);
          }
        } catch (err) {
          const outcome = await googleFailure(err);
          if (outcome.status === "error") console.warn(`[auth] Google redirect sign-in failed (${outcome.code})`);
        }
        // Auth changes can overlap (sign-out then sign-in in quick succession): only the newest
        // callback may apply its result, so a slow check for the previous user can never
        // re-apply that user after someone else signed in.
        let latest = 0;
        unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
          const seq = ++latest;
          setFirebaseUid(fbUser?.uid ?? null);
          const stale = () => cancelled || seq !== latest;
          try {
            const server = await fetchSession().catch(() => null);
            if (stale()) return;
            if (fbUser) {
              if (server && server.uid === fbUser.uid) {
                applySignedIn({ ...server, emailVerified: fbUser.emailVerified, displayName: fbUser.displayName });
                return;
              }
              try {
                const created = await createServerSession(fbUser);
                if (stale()) return;
                applySignedIn(created);
              } catch (err) {
                if (stale()) return;
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
              if (stale()) return;
              applySignedOut();
            }
          } catch {
            if (!stale()) applySignedOut();
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
  }, [configured, load, applySignedIn, applySignedOut, googleFailure]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      firebaseUid,
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
        markNewAccount(cred.user.uid); // created here: this device's signed-out progress is theirs
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
        pendingLinkRef.current = null;
        setPendingGoogleLink(null);
        applySignedOut();
      },
      async setPassword(password) {
        const auth = await load();
        const current = auth.currentUser;
        if (!current || !current.email) throw new AccountError("Please log in again first.", "app/no-current-user");
        if (current.providerData.some((p) => p.providerId === "password")) {
          throw new AccountError("This account already has a password. Use Change password instead.", "auth/provider-already-linked");
        }
        const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import("firebase/auth");
        await updatePassword(current, password);
        // A password change revokes the account's earlier sessions (the server checks revocation
        // against each token's sign-in time). Sign in again on this SAME account with the new
        // password — a fresh sign-in time, and proof the password works — then issue the session.
        // If that fails, sign out fully rather than looking signed in with a dead session.
        await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
        await current.reload().catch(() => {});
        const session = await sessionOrSignOut(auth, current, "Your password was set, but you need to log in again:");
        applySignedIn({ ...session, emailVerified: current.emailVerified, displayName: current.displayName ?? session.displayName });
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
      verificationState,
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
        // App-side pause: ZERO requests, and the pause is NOT extended or restarted.
        const gate = requestGate(currentState(current.uid));
        if (!gate.allowed) {
          return { ok: false, at: Date.now(), code: "app/cooldown", detail: String(Math.ceil(gate.remainingMs / 1000)) };
        }
        return sendVerificationEmail(current);
      },
      async signInWithGoogle() {
        try {
          const auth = await load();
          const { signInWithPopup, getAdditionalUserInfo } = await import("firebase/auth");
          const cred = await signInWithPopup(auth, await createGoogleProvider());
          const isNewUser = getAdditionalUserInfo(cred)?.isNewUser ?? false;
          if (isNewUser) markNewAccount(cred.user.uid);
          return await finishGoogleSignIn(auth, cred.user, isNewUser);
        } catch (err) {
          return googleFailure(err);
        }
      },
      async signInWithGoogleRedirect() {
        try {
          const auth = await load();
          const { signInWithRedirect } = await import("firebase/auth");
          await signInWithRedirect(auth, await createGoogleProvider());
          return { status: "redirecting" };
        } catch (err) {
          return googleFailure(err);
        }
      },
      async linkGoogle() {
        try {
          const auth = await load();
          const current = auth.currentUser;
          if (!current) return { status: "error", code: "app/no-current-user", message: "Please log in again first." };
          const { linkWithPopup } = await import("firebase/auth");
          const cred = await linkWithPopup(current, await createGoogleProvider());
          await cred.user.reload().catch(() => {});
          setUser((u) => (u && u.uid === cred.user.uid ? { ...u, emailVerified: cred.user.emailVerified } : u));
          return { status: "linked", emailVerified: cred.user.emailVerified };
        } catch (err) {
          return googleFailure(err);
        }
      },
      pendingGoogleLink,
      async completePendingGoogleLink() {
        const pending = pendingLinkRef.current;
        if (!pending) return { status: "cancelled" };
        try {
          const auth = await load();
          const current = auth.currentUser;
          if (!current) return { status: "error", code: "app/no-current-user", message: "Please log in first." };
          if (pending.email && current.email && pending.email.toLowerCase() !== current.email.toLowerCase()) {
            // Never attach a Google identity to an account with a different email.
            return {
              status: "error",
              code: "app/email-mismatch",
              message: "You logged in to a different account than the one Google matched, so Google wasn't linked.",
            };
          }
          const { linkWithCredential } = await import("firebase/auth");
          const cred = await linkWithCredential(current, pending.credential);
          await cred.user.reload().catch(() => {});
          setUser((u) => (u && u.uid === cred.user.uid ? { ...u, emailVerified: cred.user.emailVerified } : u));
          return { status: "linked", emailVerified: cred.user.emailVerified };
        } catch (err) {
          return googleFailure(err);
        } finally {
          pendingLinkRef.current = null;
          setPendingGoogleLink(null);
        }
      },
      cancelPendingGoogleLink() {
        pendingLinkRef.current = null;
        setPendingGoogleLink(null);
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
    [
      status,
      user,
      firebaseUid,
      verificationState,
      pendingGoogleLink,
      load,
      currentState,
      sendVerificationEmail,
      finishGoogleSignIn,
      googleFailure,
      applySignedIn,
      applySignedOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

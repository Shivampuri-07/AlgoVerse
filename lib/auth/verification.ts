/**
 * Email-verification requests (browser side, Firebase Client Auth — the Admin SDK is never
 * involved: it can't send emails).
 *
 * `sendEmailVerification()` resolving means Firebase ACCEPTED the request (Identity Toolkit
 * `accounts:sendOobCode` returned 200). It does not prove the email reached the inbox: delivery
 * happens afterwards on Firebase's mail servers, and a message can still be delayed or filtered
 * as spam. Every outcome is returned to the caller — nothing is swallowed.
 */
import type { User } from "firebase/auth";

/** Minimum gap between two verification emails for the same account (Firebase also rate-limits). */
export const VERIFICATION_COOLDOWN_MS = 60_000;
/** Pause after Firebase reports the daily email quota is exhausted. */
export const QUOTA_BACKOFF_MS = 60 * 60_000;

export type VerificationOutcome =
  | {
      ok: true;
      at: number;
      /** false when the continue URL was rejected (domain not authorised) and the email was sent without it. */
      continueUrlUsed: boolean;
      /** Firebase error code that caused the fallback, if any. */
      fallbackCode?: string;
    }
  | { ok: false; at: number; code: string; detail: string };

/** Error code + Firebase's own short reason, e.g. "Domain not allowlisted by project". No user data. */
export function firebaseErrorInfo(err: unknown): { code: string; detail: string } {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "unknown";
  const raw = typeof e.message === "string" ? e.message : "";
  // SDK messages look like "Firebase: <server reason> (auth/code)." or "Firebase: Error (auth/code)."
  const detail = raw
    .replace(/^Firebase:\s*/, "")
    .replace(/\s*\(auth\/[a-z-]+\)\.?\s*$/, "")
    .replace(/^Error$/, "")
    .slice(0, 200);
  return { code, detail };
}

const CONTINUE_URL_ERRORS = new Set([
  "auth/unauthorized-continue-uri",
  "auth/invalid-continue-uri",
  "auth/missing-continue-uri",
  "auth/unauthorized-domain",
]);

/**
 * Asks Firebase to send the verification email to `user` (the signed-in Firebase user).
 * Tries with a continue URL back to /account first; if the deployment's domain isn't an
 * authorised domain, sends it again without one (Firebase's own confirmation page is used).
 */
export async function requestVerificationEmail(
  user: User,
  continueUrl: string | null,
  send?: (user: User, settings?: { url: string }) => Promise<void>
): Promise<VerificationOutcome> {
  const sendEmail = send ?? (await import("firebase/auth")).sendEmailVerification;
  // Continue URL already known to be rejected for this site: one request, not two.
  if (continueUrl === null) {
    try {
      await sendEmail(user);
      return { ok: true, at: Date.now(), continueUrlUsed: false };
    } catch (err) {
      return { ok: false, at: Date.now(), ...firebaseErrorInfo(err) };
    }
  }
  try {
    await sendEmail(user, { url: continueUrl });
    return { ok: true, at: Date.now(), continueUrlUsed: true };
  } catch (err) {
    const first = firebaseErrorInfo(err);
    if (!CONTINUE_URL_ERRORS.has(first.code)) return { ok: false, at: Date.now(), ...first };
    try {
      await sendEmail(user);
      return { ok: true, at: Date.now(), continueUrlUsed: false, fallbackCode: first.code };
    } catch (err2) {
      return { ok: false, at: Date.now(), ...firebaseErrorInfo(err2) };
    }
  }
}

/**
 * Pauses after consecutive auth/too-many-requests answers from Firebase. Each deliberate attempt
 * that Firebase still refuses waits longer than the last, capped at a day — so a block that
 * persists can never turn into an endless loop of identical 15-minute timers.
 */
export const RATE_LIMIT_BACKOFFS_MS = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 24 * 60 * 60_000] as const;

/**
 * Persisted per account. `until` is a FIXED expiry: only a real Firebase answer can set it;
 * clicks during the pause (app-side refusals) never extend or restart it.
 */
export interface VerificationState {
  until: number;
  /** Last real Firebase answer (never an app-side refusal). */
  last: VerificationOutcome | null;
  /** Consecutive auth/too-many-requests answers; reset by an accepted request. */
  rateLimitStreak: number;
}

export const INITIAL_VERIFICATION_STATE: VerificationState = { until: 0, last: null, rateLimitStreak: 0 };

/** App-side refusals ("app/…") are not Firebase answers and never change the state. */
export function isAppSideOutcome(outcome: VerificationOutcome): boolean {
  return !outcome.ok && outcome.code.startsWith("app/");
}

/** Next state after a real Firebase answer. */
export function applyOutcome(state: VerificationState, outcome: VerificationOutcome): VerificationState {
  if (isAppSideOutcome(outcome)) return state;
  if (outcome.ok) return { until: outcome.at + VERIFICATION_COOLDOWN_MS, last: outcome, rateLimitStreak: 0 };
  switch (outcome.code) {
    case "auth/too-many-requests": {
      const streak = state.rateLimitStreak + 1;
      const wait = RATE_LIMIT_BACKOFFS_MS[Math.min(streak, RATE_LIMIT_BACKOFFS_MS.length) - 1];
      return { until: outcome.at + wait, last: outcome, rateLimitStreak: streak };
    }
    case "auth/quota-exceeded":
      return { until: outcome.at + QUOTA_BACKOFF_MS, last: outcome, rateLimitStreak: state.rateLimitStreak };
    case "auth/network-request-failed":
      // Never reached Firebase: keep whatever pause already applies, allow a retry.
      return { ...state, last: outcome };
    default:
      return { until: outcome.at + VERIFICATION_COOLDOWN_MS, last: outcome, rateLimitStreak: state.rateLimitStreak };
  }
}

/** May a real request be made now? Pure; never changes the state. */
export function requestGate(state: VerificationState, now = Date.now()): { allowed: true } | { allowed: false; remainingMs: number } {
  const remainingMs = state.until - now;
  return remainingMs > 0 ? { allowed: false, remainingMs } : { allowed: true };
}

/** The pause that would follow if Firebase refuses the next attempt too (shown to the user). */
export function nextRateLimitBackoff(state: VerificationState): number {
  return RATE_LIMIT_BACKOFFS_MS[Math.min(state.rateLimitStreak + 1, RATE_LIMIT_BACKOFFS_MS.length) - 1];
}

function isOutcome(v: unknown): v is VerificationOutcome {
  const o = v as { ok?: unknown; at?: unknown } | null;
  return !!o && typeof o.ok === "boolean" && typeof o.at === "number";
}

/** Reads a stored state, including the previous format ({ until, outcome }). Invalid → null. */
export function parseStoredState(raw: string | null): VerificationState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.until !== "number") return null;
    if ("rateLimitStreak" in v) {
      const last = isOutcome(v.last) ? v.last : null;
      const streak = typeof v.rateLimitStreak === "number" && v.rateLimitStreak >= 0 ? Math.floor(v.rateLimitStreak) : 0;
      return { until: v.until, last, rateLimitStreak: streak };
    }
    // Previous format from e8d6237.
    const last = isOutcome(v.outcome) ? v.outcome : null;
    const limited = !!last && !last.ok && last.code === "auth/too-many-requests";
    return { until: v.until, last, rateLimitStreak: limited ? 1 : 0 };
  } catch {
    return null;
  }
}

/** Of two states for the same account (memory vs storage / another tab), the more recent one. */
export function newerState(a: VerificationState | null, b: VerificationState | null): VerificationState {
  if (!a) return b ?? INITIAL_VERIFICATION_STATE;
  if (!b) return a;
  const at = (s: VerificationState) => s.last?.at ?? 0;
  if (at(a) !== at(b)) return at(a) > at(b) ? a : b;
  return a.until >= b.until ? a : b;
}

/** Milliseconds left before another email may be requested (0 = allowed now). */
export function cooldownRemaining(lastAt: number | null | undefined, now = Date.now()): number {
  if (!lastAt) return 0;
  return Math.max(0, VERIFICATION_COOLDOWN_MS - (now - lastAt));
}

/** User-facing explanation of a failed request, including the Firebase error code. */
export function verificationFailureMessage(code: string, detail = ""): string {
  switch (code) {
    case "auth/too-many-requests":
      return "Firebase is temporarily refusing to send more emails for this account or network (too many requests). This is Firebase's abuse protection; it lifts on its own after a while.";
    case "auth/quota-exceeded":
      return "This project's daily email quota has been reached. Try again tomorrow.";
    case "auth/network-request-failed":
      return "Couldn't reach Firebase. Check your connection and try again.";
    case "auth/user-token-expired":
    case "auth/invalid-user-token":
    case "auth/requires-recent-login":
    case "auth/user-disabled":
      return "Your sign-in on this device has expired. Log out, log in again, then resend the email.";
    case "auth/unauthorized-continue-uri":
    case "auth/invalid-continue-uri":
    case "auth/unauthorized-domain":
      return "This site's domain isn't in Firebase's authorised domains, so the email couldn't be sent.";
    case "auth/operation-not-allowed":
      return "Email/Password sign-in isn't enabled in this Firebase project.";
    case "auth/internal-error":
      return `Firebase reported an internal error${detail ? ` (${detail})` : ""}. Try again in a minute.`;
    default:
      return `Firebase rejected the request${detail ? `: ${detail}` : ""}.`;
  }
}

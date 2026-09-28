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
/**
 * After Firebase says auth/too-many-requests, don't ask again for this long: every request made
 * while throttled is another failed attempt and can keep the block in place.
 */
export const RATE_LIMITED_BACKOFF_MS = 15 * 60_000;
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
 * Earliest time another request may be made after `outcome` — for successes AND failures, so a
 * rejected request can't be retried in a tight loop. Transient/local problems don't block.
 */
export function nextAllowedAt(outcome: VerificationOutcome): number {
  if (outcome.ok) return outcome.at + VERIFICATION_COOLDOWN_MS;
  switch (outcome.code) {
    case "auth/too-many-requests":
      return outcome.at + RATE_LIMITED_BACKOFF_MS;
    case "auth/quota-exceeded":
      return outcome.at + QUOTA_BACKOFF_MS;
    case "auth/network-request-failed":
    case "app/cooldown":
    case "app/no-current-user":
    case "app/already-verified":
      return 0;
    default:
      return outcome.at + VERIFICATION_COOLDOWN_MS;
  }
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
      return "Firebase is temporarily refusing to send more emails for this account or network (too many requests). Resend is paused for 15 minutes here — please try once after that, not repeatedly.";
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

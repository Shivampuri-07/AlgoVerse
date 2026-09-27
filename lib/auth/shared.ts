/**
 * Account types, limits and pure validators shared by the browser and the server.
 * Safe to import anywhere: no secrets, no SDKs.
 */

/** HTTP-only cookie holding the Firebase session cookie (set by POST /api/auth/session). */
export const SESSION_COOKIE = "algoverse_session";
/** Firebase allows 5 minutes to 2 weeks. Two weeks keeps installed-PWA users signed in. */
export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
/** A session cookie is only minted from an ID token of a sign-in made this recently. */
export const RECENT_SIGN_IN_SECONDS = 5 * 60;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 254;

/** What the browser is told about the signed-in user. Never includes tokens. */
export interface SessionUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

export interface AccountProfile extends SessionUser {
  createdAt: string | null;
}

export type AuthErrorCode =
  | "not_configured"
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "stale_sign_in"
  | "unavailable";

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  not_configured: "Accounts aren't available yet.",
  bad_request: "That request couldn't be processed.",
  unauthenticated: "Please sign in to continue.",
  forbidden: "This request isn't allowed.",
  stale_sign_in: "For your security, please sign in again.",
  unavailable: "Account service is unavailable right now. Please try again in a moment.",
};

export function isValidEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= EMAIL_MAX_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (value.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return "Use at least one letter and one number.";
  return null;
}

/**
 * Normalises a display name: collapses whitespace, strips control characters. Returns
 * null for "no name", undefined when the input is invalid.
 */
export function normalizeDisplayName(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length > DISPLAY_NAME_MAX_LENGTH) return undefined;
  return clean;
}

/**
 * Only same-site relative paths are allowed as a post-login destination (no open redirects
 * such as "//evil.com" or "https://evil.com").
 */
export function safeNextPath(value: string | null | undefined, fallback = "/account"): string {
  if (!value || typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

/**
 * Google Sign-In through Firebase Authentication's official Google provider (browser SDK).
 *
 * Account safety rules (enforced in components/providers/auth-provider.tsx):
 *   - Firebase keeps ONE account per email address (the project default). Signing in with Google
 *     for an email that already has an AlgoVerse account signs in to THAT account (same UID) or,
 *     when Firebase asks for confirmation, returns auth/account-exists-with-different-credential.
 *     In that case nothing is created or changed: the user signs in with their password first and
 *     Google is then LINKED to the existing account (linkWithCredential).
 *   - A Google account that already belongs to a different AlgoVerse user is never merged.
 *   - Whether the email is verified comes only from Firebase (user.emailVerified after reload,
 *     and the server's fresh Admin lookup) — never from this module or the UI.
 */
import type { AuthProvider as FirebaseAuthProvider, OAuthCredential } from "firebase/auth";

export const GOOGLE_PROVIDER_ID = "google.com";
export const PASSWORD_PROVIDER_ID = "password";

export async function createGoogleProvider(): Promise<FirebaseAuthProvider> {
  const { GoogleAuthProvider } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  // Always show the account chooser, so a shared device doesn't silently reuse someone's Google session.
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

export type GoogleOutcome =
  | {
      status: "signed-in";
      isNewUser: boolean;
      emailVerified: boolean;
      /** Firebase removed the account's (unverified) password when Google proved the email. */
      passwordRemoved: boolean;
    }
  | { status: "linked"; emailVerified: boolean }
  | { status: "cancelled" }
  /** An account already exists for this email with another sign-in method: sign in with it to link Google. */
  | { status: "link-required"; email: string | null }
  | { status: "redirecting" }
  | { status: "error"; code: string; message: string };

/** The user closed or replaced the popup — not an error worth shouting about. */
const CANCEL_CODES = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

export function isGoogleCancel(code: string): boolean {
  return CANCEL_CODES.has(code);
}

export function googleErrorMessage(code: string): string {
  switch (code) {
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow pop-ups for this site, or continue in this tab instead.";
    case "auth/operation-not-allowed":
      return "Google sign-in isn't enabled for this app yet.";
    case "auth/unauthorized-domain":
      return "This site's domain isn't authorised for Google sign-in in Firebase yet.";
    case "auth/credential-already-in-use":
      return "That Google account is already used by a different AlgoVerse account. Accounts are never merged automatically — sign in with Google to use that account instead.";
    case "auth/provider-already-linked":
      return "A Google account is already linked to this AlgoVerse account.";
    case "auth/email-already-in-use":
      return "That Google account's email already belongs to a different AlgoVerse account, so it can't be linked here.";
    case "auth/requires-recent-login":
      return "For your security, log out and log in again, then link Google.";
    case "auth/network-request-failed":
      return "Couldn't reach Google. Check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/web-storage-unsupported":
    case "auth/operation-not-supported-in-this-environment":
      return "This browser mode doesn't support Google sign-in (private mode or blocked storage). Try a normal window.";
    default:
      return "Google sign-in didn't complete. Please try again.";
  }
}

/** Credential Google returned when Firebase needs the existing account to confirm the link. Kept in memory only. */
export interface PendingGoogleLink {
  credential: OAuthCredential;
  email: string | null;
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { useFirebaseSetup } from "@/components/providers/firebase-config-provider";
import { FormMessage } from "@/components/account/auth-card";
import { Button } from "@/components/ui/button";

/** Google's multi-colour "G" mark (inline so it works offline and in both themes). */
export function GoogleMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function OrDivider() {
  return (
    <div className="relative my-1 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * "Continue with Google" for the login and sign-up pages. Works for new and existing users:
 * Firebase signs an existing Google user in, creates a new user otherwise, and asks for the
 * existing password first when the email already has an AlgoVerse account (then Google is linked).
 */
export function GoogleSignIn({ next, disabled, onLinkRequired, showExistingAccountNote = false }: {
  next: string;
  disabled?: boolean;
  /** Login page: explain the safe way for existing password accounts to add Google. */
  showExistingAccountNote?: boolean;
  /** Firebase needs the existing account's password before Google can be linked. */
  onLinkRequired: (email: string | null) => void;
}) {
  const { signInWithGoogle, signInWithGoogleRedirect } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = React.useState(false);
  const [domainBlocked, setDomainBlocked] = React.useState(false);
  const { deployment } = useFirebaseSetup();
  // On a per-deployment Vercel address, the same page on this Preview's stable (authorised) address.
  const stableUrl = React.useMemo(() => {
    const host = deployment?.stableHost;
    if (!host || typeof window === "undefined" || window.location.hostname === host) return null;
    return `https://${host}${window.location.pathname}${window.location.search}`;
  }, [deployment?.stableHost]);

  async function run(redirect: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const outcome = redirect ? await signInWithGoogleRedirect() : await signInWithGoogle();
    switch (outcome.status) {
      case "signed-in":
        if (outcome.passwordRemoved) {
          toast.warning(
            "Signed in with Google. Your account and data are unchanged, but Firebase removed its old password sign-in — see your Account page."
          );
          router.replace("/account");
        } else {
          router.replace(next);
        }
        return; // keep the spinner while navigating
      case "redirecting":
        return;
      case "cancelled":
        break; // the user closed the Google window: nothing to report
      case "link-required":
        onLinkRequired(outcome.email);
        break;
      case "error":
        setPopupBlocked(outcome.code === "auth/popup-blocked");
        setDomainBlocked(outcome.code === "auth/unauthorized-domain");
        setError(outcome.message);
        break;
      default:
        break;
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Button type="button" variant="outline" className="w-full" onClick={() => run(false)} disabled={busy || disabled}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleMark />}
        Continue with Google
      </Button>
      {showExistingAccountNote && (
        <p className="text-xs text-muted-foreground">
          Already have an AlgoVerse password account? Log in with your password below, then choose{" "}
          <span className="font-medium text-foreground">Link Google account</span> on your Account page — that keeps
          your password. (If an unverified password account signs in with Google directly, Firebase keeps the
          account and its data but removes the old password, for security.)
        </p>
      )}
      {domainBlocked && stableUrl && (
        <Button asChild variant="secondary" className="w-full" data-testid="open-stable-address">
          <a href={stableUrl}>Open this Preview&apos;s stable address</a>
        </Button>
      )}
      {popupBlocked && (
        <Button type="button" variant="ghost" className="w-full" onClick={() => run(true)} disabled={busy || disabled}>
          Continue with Google in this tab
        </Button>
      )}
    </div>
  );
}

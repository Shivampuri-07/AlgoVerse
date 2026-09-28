"use client";

import * as React from "react";
import { Loader2, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { GoogleMark } from "@/components/account/google-sign-in";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GOOGLE_PROVIDER_ID } from "@/lib/auth/google";
import type { AccountProfile } from "@/lib/auth/shared";
import {
  nextRateLimitBackoff,
  requestGate,
  verificationFailureMessage,
  type VerificationOutcome,
  type VerificationState,
} from "@/lib/auth/verification";

/** Re-renders every `intervalMs` (for countdowns). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  // A re-render caused by something else (e.g. a new pause) must not use a clock up to a second old.
  return Math.max(now, Date.now());
}

/** "45s", "14:05" or "3:59:59". */
export function formatWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}`;
  return `${s}s`;
}

/** "15 minutes", "1 hour", "4 hours", "24 hours". */
function humanDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function outcomeText(outcome: Extract<VerificationOutcome, { ok: false }>): string {
  switch (outcome.code) {
    case "app/cooldown":
      return `AlgoVerse is pausing verification emails for ${formatWait(Number(outcome.detail) * 1000)} more. No request was sent.`;
    case "app/no-current-user":
      return "Your sign-in on this device has expired. Log out, log in again, then try again.";
    default:
      return `${verificationFailureMessage(outcome.code, outcome.detail)} (${outcome.code})`;
  }
}

/**
 * What Firebase last answered (a REAL response) — kept separate from AlgoVerse's own pause,
 * which is shown underneath with its fixed end time.
 */
export function VerificationStatus({
  state,
  now,
  projectId,
}: {
  state: VerificationState;
  now: number;
  projectId: string | null;
}) {
  const last = state.last;
  const gate = requestGate(state, now);
  const pausedUntil = gate.allowed ? null : state.until;

  let firebase: React.ReactNode = null;
  let tone: "neutral" | "error" = "neutral";
  if (last?.ok) {
    firebase = (
      <>
        <p>
          <span className="font-medium">Firebase accepted the request at {clock(last.at)}.</span>{" "}
          <span className="text-muted-foreground">That means the email was queued — not that it has been delivered.</span>
        </p>
        <p className="text-muted-foreground">
          Look for a message from{" "}
          <span className="font-medium text-foreground">noreply@{projectId ?? "your-project"}.firebaseapp.com</span>, including
          Spam and Promotions.
        </p>
      </>
    );
  } else if (last && last.code === "auth/too-many-requests") {
    tone = "error";
    firebase = (
      <>
        <p>
          <span className="font-medium">Firebase refused the last request at {clock(last.at)}</span> with{" "}
          <code className="rounded bg-destructive/10 px-1">auth/too-many-requests</code>
          {state.rateLimitStreak > 1 ? ` (${state.rateLimitStreak} times in a row)` : ""}.
        </p>
        <p>
          This is Firebase&apos;s own abuse protection. It lifts on its own, but Firebase doesn&apos;t say when — AlgoVerse
          can&apos;t see or shorten it.
        </p>
      </>
    );
  } else if (last && !last.ok) {
    tone = "error";
    firebase = (
      <p>
        {last.code === "auth/network-request-failed" ? "Nothing was sent: " : `Firebase refused the request at ${clock(last.at)}: `}
        {outcomeText(last)}
      </p>
    );
  }

  let pause: React.ReactNode = null;
  if (pausedUntil) {
    pause = (
      <p className="text-muted-foreground" data-testid="verification-pause">
        AlgoVerse won&apos;t send another request from this device until{" "}
        <span className="font-medium text-foreground">{clock(pausedUntil)}</span> ({formatWait(pausedUntil - now)} left). This is
        AlgoVerse&apos;s own fixed pause; clicking doesn&apos;t restart it.
      </p>
    );
  } else if (last && !last.ok && last.code === "auth/too-many-requests") {
    pause = (
      <p className="text-muted-foreground" data-testid="verification-pause">
        AlgoVerse&apos;s pause has ended — that does <span className="font-medium text-foreground">not</span> mean Firebase has
        lifted its block. You can try once. If Firebase refuses again, AlgoVerse will pause for{" "}
        {humanDuration(nextRateLimitBackoff(state))} before allowing another try.
      </p>
    );
  }

  if (!firebase && !pause) return null;
  return (
    <div
      id="verification-status"
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
          : "space-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
      }
    >
      {firebase}
      {pause}
    </div>
  );
}

/**
 * Verification card for an account whose email Firebase doesn't (yet) report as verified.
 * Two ways out: the Firebase email link, or linking the Google account with that email —
 * Firebase then reports the email verified itself. Only the server's fresh answer is trusted.
 */
export function EmailVerificationCard({
  profile,
  projectId,
  reloadProfile,
}: {
  profile: AccountProfile;
  projectId: string | null;
  /** Re-reads the profile from the server (Firebase Admin); returns it. */
  reloadProfile: () => Promise<AccountProfile | null>;
}) {
  const { verificationState, resendVerification, checkVerification, linkGoogle } = useAuth();
  const now = useNow(1000);
  const [sending, setSending] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [linking, setLinking] = React.useState(false);

  const gate = requestGate(verificationState, now);
  const hasGoogle = profile.providers.includes(GOOGLE_PROVIDER_ID);
  const rateLimited = verificationState.last?.ok === false && verificationState.last.code === "auth/too-many-requests";

  async function onResend() {
    if (sending) return;
    setSending(true);
    try {
      const outcome = await resendVerification();
      if (outcome.ok) toast.success("Firebase accepted the request. Delivery usually takes a few minutes.");
      else if (outcome.code === "app/already-verified") {
        await checkVerification();
        await reloadProfile();
      } else toast.error(outcomeText(outcome));
    } finally {
      setSending(false);
    }
  }

  async function onCheck() {
    setChecking(true);
    try {
      await checkVerification();
      const fresh = await reloadProfile();
      if (fresh?.emailVerified) toast.success("Firebase confirms your email is verified.");
      else toast.message("Firebase doesn't show this email as verified yet.");
    } finally {
      setChecking(false);
    }
  }

  async function onLinkGoogle() {
    setLinking(true);
    try {
      const outcome = await linkGoogle();
      if (outcome.status === "linked") {
        await checkVerification();
        const fresh = await reloadProfile();
        if (fresh?.emailVerified) toast.success("Google linked — Firebase confirms your email is verified.");
        else
          toast.message(
            "Google is linked, but Firebase doesn't report this email as verified (the Google account may use a different email)."
          );
      } else if (outcome.status === "error") {
        toast.error(outcome.message);
      }
    } finally {
      setLinking(false);
    }
  }

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MailWarning className="h-4 w-4 text-warning" /> Confirm your email
        </CardTitle>
        <CardDescription>
          Firebase doesn&apos;t report <span className="font-medium text-foreground">{profile.email}</span> as verified yet.
          Verifying lets you recover your account, and it will be needed for AI features.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <VerificationStatus state={verificationState} now={now} projectId={projectId} />

        <div className="space-y-2">
          <p className="text-sm font-medium">Option 1 — verification email</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onResend} disabled={sending || !gate.allowed} aria-describedby="verification-status">
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              {gate.allowed ? (rateLimited ? "Try once more" : "Send verification email") : `Available in ${formatWait(gate.remainingMs)}`}
            </Button>
            <Button variant="ghost" onClick={onCheck} disabled={checking}>
              {checking && <Loader2 className="h-4 w-4 animate-spin" />}
              I&apos;ve clicked the link
            </Button>
          </div>
        </div>

        {!hasGoogle && (
          <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
            <p className="text-sm font-medium">Option 2 — verify with Google (no email needed)</p>
            <p className="text-sm text-muted-foreground">
              If {profile.email} is a Google account, link it. Firebase then confirms the address itself, and you keep this
              same account, password and data.
              {rateLimited ? " This works even while Firebase is blocking verification emails." : ""}
            </p>
            <Button variant="outline" onClick={onLinkGoogle} disabled={linking}>
              {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleMark />}
              Link Google account
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2, LogOut, MailWarning, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { useFirebaseSetup } from "@/components/providers/firebase-config-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { firebaseErrorMessage, patchProfile } from "@/lib/auth/client";
import { DISPLAY_NAME_MAX_LENGTH, normalizeDisplayName, type AccountProfile } from "@/lib/auth/shared";
import { verificationFailureMessage, type VerificationOutcome } from "@/lib/auth/verification";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function AccountView({
  initialProfile,
  profileLoadFailed,
}: {
  initialProfile: AccountProfile;
  profileLoadFailed: boolean;
}) {
  const {
    user,
    status,
    signOut,
    verification,
    verificationBlockedUntil,
    resendVerification,
    checkVerification,
    sendPasswordReset,
    setDisplayName,
  } = useAuth();
  const { config } = useFirebaseSetup();
  const router = useRouter();
  const params = useSearchParams();
  const [profile, setProfile] = React.useState(initialProfile);
  const [name, setName] = React.useState(initialProfile.displayName ?? "");
  const [savingName, setSavingName] = React.useState(false);
  const [sendingVerification, setSendingVerification] = React.useState(false);
  const [checkingVerification, setCheckingVerification] = React.useState(false);
  const now = useNow(1000);
  const [signOutAllOpen, setSignOutAllOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  const emailVerified = profile.emailVerified || Boolean(user?.emailVerified);

  /** Only Firebase's answer (fresh server lookup) marks the email verified. */
  const recheck = React.useCallback(
    async (announce: boolean) => {
      setCheckingVerification(true);
      try {
        const verified = await checkVerification();
        if (verified) {
          setProfile((p) => ({ ...p, emailVerified: true }));
          if (announce) toast.success("Email confirmed.");
        } else if (announce) {
          toast.message("Firebase doesn't show this email as confirmed yet. Open the link in the email, then try again.");
        }
        return verified;
      } finally {
        setCheckingVerification(false);
      }
    },
    [checkVerification]
  );

  // Arriving from the verification link (continue URL /account?verified=1): ask Firebase, don't assume.
  React.useEffect(() => {
    if (params.get("welcome") === "1") toast.success("Account created.");
    if (params.get("verified") === "1") void recheck(true);
  }, [params, recheck]);

  // Coming back to this tab after clicking the link in another tab/app: re-check quietly.
  React.useEffect(() => {
    if (emailVerified) return;
    let last = 0;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 10_000) return;
      last = Date.now();
      void recheck(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [emailVerified, recheck]);

  // Once this browser is signed out (the menu's Log out, or another tab), leave the protected
  // page for the dashboard.
  React.useEffect(() => {
    if (status === "signed-out") router.replace("/");
  }, [status, router]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const clean = normalizeDisplayName(name);
    if (clean === undefined) {
      toast.error(`Keep your name under ${DISPLAY_NAME_MAX_LENGTH} characters.`);
      return;
    }
    setSavingName(true);
    try {
      const { profile: updated } = await patchProfile(clean);
      setProfile(updated);
      setName(updated.displayName ?? "");
      setDisplayName(updated.displayName);
      toast.success("Name saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your name.");
    } finally {
      setSavingName(false);
    }
  }

  async function onResendVerification() {
    if (sendingVerification) return;
    setSendingVerification(true);
    try {
      const outcome = await resendVerification();
      if (outcome.ok) {
        toast.success("Firebase accepted the request. The email usually arrives within a few minutes.");
      } else if (outcome.code === "app/already-verified") {
        await recheck(true);
      } else {
        toast.error(outcomeText(outcome));
      }
    } finally {
      setSendingVerification(false);
    }
  }

  async function onChangePassword() {
    if (!profile.email) return;
    try {
      await sendPasswordReset(profile.email);
      toast.success(`We sent a password-change link to ${profile.email}.`);
    } catch (err) {
      toast.error(firebaseErrorMessage(err));
    }
  }

  async function onSignOut(everywhere: boolean) {
    setSigningOut(true);
    try {
      await signOut({ everywhere });
      toast.success(everywhere ? "Signed out on all devices." : "Signed out. Your progress on this device is unchanged.");
      router.replace("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sign out. Try again.");
      setSigningOut(false);
    }
  }

  const memberSince = formatDate(profile.createdAt);
  // Applies after failures too (e.g. 15 min after auth/too-many-requests), and survives reloads.
  const cooldown = Math.max(0, verificationBlockedUntil - now);

  return (
    <div className="max-w-2xl space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, sign-in and plan.</p>
      </div>

      {profileLoadFailed && (
        <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Some account details couldn&apos;t be loaded right now. Refresh the page to try again.
        </p>
      )}

      {!emailVerified && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MailWarning className="h-4 w-4 text-warning" /> Confirm your email
            </CardTitle>
            <CardDescription>
              Confirm <span className="font-medium text-foreground">{profile.email}</span> using the link Firebase
              emails you. Confirming it lets you recover your account, and it will be needed for AI features.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <VerificationStatus outcome={verification} now={now} projectId={config?.projectId ?? null} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={onResendVerification}
                disabled={sendingVerification || cooldown > 0}
                aria-describedby="verification-status"
              >
                {sendingVerification && <Loader2 className="h-4 w-4 animate-spin" />}
                {cooldown > 0 ? `Resend email (${formatWait(cooldown)})` : "Resend email"}
              </Button>
              <Button variant="ghost" onClick={() => void recheck(true)} disabled={checkingVerification}>
                {checkingVerification && <Loader2 className="h-4 w-4 animate-spin" />}
                I&apos;ve confirmed it
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>{memberSince ? `Member since ${memberSince}.` : "Your AlgoVerse account."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1">
            <p className="text-sm font-medium">Email</p>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="break-all">{profile.email}</span>
              {emailVerified ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Verified
                </Badge>
              ) : (
                <Badge variant="warning">Not verified</Badge>
              )}
            </p>
          </div>
          <form onSubmit={saveName} className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <div className="flex gap-2">
              <Input
                id="display-name"
                autoComplete="name"
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={savingName}
                placeholder="Optional"
              />
              <Button type="submit" variant="outline" disabled={savingName || name === (profile.displayName ?? "")}>
                {savingName && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> Plan
          </CardTitle>
          <CardDescription>You&apos;re on the Free plan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Your progress, bookmarks and notes are saved on this device, exactly as before. Signing in or out
            doesn&apos;t change them.
          </p>
          <p>AlgoVerse Pro (cross-device sync and more AI help) is coming soon.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Sign-in &amp; security
          </CardTitle>
          <CardDescription>AlgoVerse never sees your password. Sign-in is handled by Firebase Authentication.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onChangePassword}>
            <KeyRound className="h-4 w-4" />
            Change password
          </Button>
          <Button variant="outline" onClick={() => onSignOut(false)} disabled={signingOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
          <Button variant="ghost" onClick={() => setSignOutAllOpen(true)} disabled={signingOut}>
            Sign out of all devices
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your data</CardTitle>
          <CardDescription>
            You can already export your progress as a file from{" "}
            <Link href="/settings" className="font-medium text-primary hover:underline">
              Settings
            </Link>
            . Account data export and account deletion will be added here soon.
          </CardDescription>
        </CardHeader>
      </Card>

      <Dialog open={signOutAllOpen} onOpenChange={setSignOutAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out of all devices?</DialogTitle>
            <DialogDescription>
              Every browser and installed app signed in to this account will need to sign in again. Progress saved
              on each device stays there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => onSignOut(true)} disabled={signingOut}>
              {signingOut && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign out everywhere
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Re-renders every `intervalMs` (for the resend countdown). */
function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function outcomeText(outcome: Extract<VerificationOutcome, { ok: false }>): string {
  switch (outcome.code) {
    case "app/cooldown":
      return `Please wait ${formatWait(Number(outcome.detail) * 1000)} before requesting another email.`;
    case "app/no-current-user":
      return "Your sign-in on this device has expired. Log out, log in again, then resend the email.";
    default:
      return `${verificationFailureMessage(outcome.code, outcome.detail)} (${outcome.code})`;
  }
}

/**
 * What actually happened to the last request. "Accepted" means Firebase's server took the
 * request (HTTP 200) — delivery to the inbox happens afterwards and can't be observed from here.
 */
function VerificationStatus({
  outcome,
  now,
  projectId,
}: {
  outcome: VerificationOutcome | null;
  now: number;
  projectId: string | null;
}) {
  if (!outcome) return null;
  const time = new Date(outcome.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const minutes = Math.floor((now - outcome.at) / 60_000);
  if (outcome.ok) {
    return (
      <div id="verification-status" role="status" className="space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
        <p>
          <span className="font-medium">Firebase accepted the request at {time}.</span>{" "}
          <span className="text-muted-foreground">That means the email was queued, not that it has arrived.</span>
        </p>
        <p className="text-muted-foreground">
          Look for a message from{" "}
          <span className="font-medium text-foreground">noreply@{projectId ?? "your-project"}.firebaseapp.com</span>, including
          Spam and Promotions.{minutes >= 10 ? " If it still hasn't arrived after 10 minutes, check the Firebase console (see the setup guide)." : ""}
        </p>
      </div>
    );
  }
  if (outcome.code === "app/cooldown" || outcome.code === "app/already-verified") return null;
  return (
    <p id="verification-status" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      The email was not sent: {outcomeText(outcome)}
    </p>
  );
}

/** "45s" or "14:05" for the resend countdown. */
function formatWait(ms: number): string {
  const total = Math.ceil(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

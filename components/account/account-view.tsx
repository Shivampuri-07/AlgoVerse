"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2, LogOut, MailWarning, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
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
  const { user, status, signOut, resendVerification, refresh, sendPasswordReset, setDisplayName } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [profile, setProfile] = React.useState(initialProfile);
  const [name, setName] = React.useState(initialProfile.displayName ?? "");
  const [savingName, setSavingName] = React.useState(false);
  const [sendingVerification, setSendingVerification] = React.useState(false);
  const [signOutAllOpen, setSignOutAllOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  const emailVerified = profile.emailVerified || Boolean(user?.emailVerified);

  // Welcome / verified banners from the sign-up and email-link redirects.
  React.useEffect(() => {
    if (params.get("welcome") === "1") {
      toast.success("Account created. Check your inbox to confirm your email.");
    }
    if (params.get("verified") === "1") {
      void refresh().then(() => setProfile((p) => ({ ...p, emailVerified: true })));
    }
  }, [params, refresh]);

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
    setSendingVerification(true);
    try {
      await resendVerification();
      toast.success(`Verification email sent to ${profile.email}.`);
    } catch (err) {
      toast.error(firebaseErrorMessage(err));
    } finally {
      setSendingVerification(false);
    }
  }

  async function onCheckVerification() {
    await refresh();
    const res = await fetch("/api/account/profile", { cache: "no-store" });
    if (res.ok) {
      const { profile: fresh } = (await res.json()) as { profile: AccountProfile };
      setProfile(fresh);
      if (fresh.emailVerified) toast.success("Email confirmed.");
      else toast.message("Not confirmed yet. Open the link in the email we sent you.");
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
              We sent a confirmation link to <span className="font-medium text-foreground">{profile.email}</span>.
              Confirming it lets you recover your account, and it will be needed for AI features.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onResendVerification} disabled={sendingVerification}>
              {sendingVerification && <Loader2 className="h-4 w-4 animate-spin" />}
              Resend email
            </Button>
            <Button variant="ghost" onClick={onCheckVerification}>
              I&apos;ve confirmed it
            </Button>
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

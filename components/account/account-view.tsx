"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2, LogOut, ShieldCheck, Sparkles } from "lucide-react";
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
import { GOOGLE_PROVIDER_ID, PASSWORD_PROVIDER_ID } from "@/lib/auth/google";
import { EmailVerificationCard } from "@/components/account/email-verification";
import { GoogleMark } from "@/components/account/google-sign-in";
import { SyncCard } from "@/components/sync/sync-status";
import { useSyncSetup } from "@/components/sync/sync-provider";
import { UpgradeButton } from "@/components/billing/upgrade-dialog";
import { PLANS } from "@/lib/plans";

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
  const { status, signOut, checkVerification, sendPasswordReset, setDisplayName, linkGoogle } = useAuth();
  const { config } = useFirebaseSetup();
  const { entitlements } = useSyncSetup();
  const router = useRouter();
  const params = useSearchParams();
  const [profile, setProfile] = React.useState(initialProfile);
  const [name, setName] = React.useState(initialProfile.displayName ?? "");
  const [savingName, setSavingName] = React.useState(false);
  const [linkingGoogle, setLinkingGoogle] = React.useState(false);
  const [signOutAllOpen, setSignOutAllOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  // Trusted state only: the server's fresh Firebase Admin lookup (never a URL parameter or the UI).
  const emailVerified = profile.emailVerified;
  const hasGoogle = profile.providers.includes(GOOGLE_PROVIDER_ID);
  const hasPassword = profile.providers.includes(PASSWORD_PROVIDER_ID);

  const reloadProfile = React.useCallback(async (): Promise<AccountProfile | null> => {
    try {
      const res = await fetch("/api/account/profile", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return null;
      const { profile: fresh } = (await res.json()) as { profile: AccountProfile };
      setProfile(fresh);
      return fresh;
    } catch {
      return null;
    }
  }, []);

  /** Asks Firebase (client reload + server lookup); only its answer marks the email verified. */
  const recheck = React.useCallback(
    async (announce: boolean) => {
      await checkVerification();
      const fresh = await reloadProfile();
      if (announce) {
        if (fresh?.emailVerified) toast.success("Firebase confirms your email is verified.");
        else toast.message("Firebase doesn't show this email as verified yet. Open the link in the email, then try again.");
      }
      return fresh?.emailVerified === true;
    },
    [checkVerification, reloadProfile]
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

  async function onLinkGoogle() {
    setLinkingGoogle(true);
    try {
      const outcome = await linkGoogle();
      if (outcome.status === "linked") {
        await checkVerification();
        const fresh = await reloadProfile();
        toast.success(fresh?.verifiedByGoogle ? "Google linked. Email verified through Google." : "Google is linked to your account.");
      } else if (outcome.status === "error") {
        toast.error(outcome.message);
      }
    } finally {
      setLinkingGoogle(false);
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

      {profile.passwordRemovedAt && (
        <Card className="border-warning/40" data-testid="password-removed-notice">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-warning" /> Your password sign-in was removed by Firebase
            </CardTitle>
            <CardDescription>
              When this account was signed in with Google, Firebase removed its password because the email hadn&apos;t been
              verified with it (a Firebase security rule against account takeover). This is still the same account — your
              data is unchanged — and you can keep signing in with Google. To use a password again, set one below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={onChangePassword}>
              <KeyRound className="h-4 w-4" />
              Set a password
            </Button>
          </CardContent>
        </Card>
      )}

      {!emailVerified && (
        <EmailVerificationCard profile={profile} projectId={config?.projectId ?? null} reloadProfile={reloadProfile} />
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
            {emailVerified && (
              <p className="text-xs text-muted-foreground" data-testid="verified-via">
                {profile.verifiedByGoogle ? "Email verified through Google." : "Email verified (confirmed by Firebase)."}
              </p>
            )}
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
          <CardDescription data-testid="account-plan">
            You&apos;re on the {PLANS[entitlements?.plan ?? "free"].name} plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Your progress, bookmarks and notes are saved on this device, exactly as before. Signing in or out
            doesn&apos;t change them.
          </p>
          <div className="flex flex-wrap gap-2">
            {entitlements?.plan !== "pro" && <UpgradeButton size="sm" />}
            <Button asChild variant="outline" size="sm">
              <Link href="/account/billing">Plan &amp; billing</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/pricing">Compare plans</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <SyncCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Sign-in &amp; security
          </CardTitle>
          <CardDescription>AlgoVerse never sees your password. Sign-in is handled by Firebase Authentication.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Sign-in methods</p>
            <div className="flex flex-wrap gap-2" data-testid="sign-in-methods">
              {hasPassword && <Badge variant="outline">Email &amp; password</Badge>}
              {hasGoogle && (
                <Badge variant="outline" className="gap-1.5">
                  <GoogleMark className="h-3 w-3" /> Google
                </Badge>
              )}
              {!hasPassword && !hasGoogle && <span className="text-sm text-muted-foreground">—</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!hasGoogle && (
              <Button variant="outline" onClick={onLinkGoogle} disabled={linkingGoogle}>
                {linkingGoogle ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleMark />}
                Link Google account
              </Button>
            )}
            <Button variant="outline" onClick={onChangePassword}>
              <KeyRound className="h-4 w-4" />
              {hasPassword || profile.providers.length === 0 ? "Change password" : "Set a password"}
            </Button>
            <Button variant="outline" onClick={() => onSignOut(false)} disabled={signingOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
            <Button variant="ghost" onClick={() => setSignOutAllOpen(true)} disabled={signingOut}>
              Sign out of all devices
            </Button>
          </div>
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

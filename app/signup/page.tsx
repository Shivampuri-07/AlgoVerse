"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { AccountsUnavailable, AuthCard, FormMessage } from "@/components/account/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firebaseErrorMessage, patchProfile } from "@/lib/auth/client";
import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isValidEmail,
  normalizeDisplayName,
  passwordProblem,
  safeNextPath,
} from "@/lib/auth/shared";

function SignupForm() {
  const { status, signUp, setDisplayName } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (status === "signed-in" && !busy) router.replace(next);
  }, [status, busy, next, router]);

  if (status === "unavailable") return <AccountsUnavailable />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const displayName = normalizeDisplayName(name);
    if (displayName === undefined) return setError(`Keep your name under ${DISPLAY_NAME_MAX_LENGTH} characters.`);
    if (!isValidEmail(email.trim())) return setError("Enter a valid email address.");
    const weak = passwordProblem(password);
    if (weak) return setError(weak);
    setBusy(true);
    try {
      await signUp(email, password);
      if (displayName) {
        // Non-fatal: the name can be set later on the account page.
        await patchProfile(displayName)
          .then(() => setDisplayName(displayName))
          .catch(() => {});
      }
      router.replace(next === "/account" ? "/account?welcome=1" : next);
    } catch (err) {
      setError(firebaseErrorMessage(err));
      setBusy(false);
    }
  }

  const loginHref = `/login${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <AuthCard
      title="Create your account"
      description="Free to join. The roadmap, videos and progress tracking keep working with or without an account."
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <div className="space-y-2">
          <Label htmlFor="name">
            Name <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="name"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            aria-describedby="password-help"
            required
          />
          <p id="password-help" className="text-xs text-muted-foreground">
            At least {PASSWORD_MIN_LENGTH} characters, with a letter and a number.
          </p>
        </div>
        <Button type="submit" className="w-full" disabled={busy || status === "loading"}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-xs text-muted-foreground">
          We&apos;ll send you an email to confirm your address. We only use your email for your account.
        </p>
      </form>
    </AuthCard>
  );
}

export default function SignupPage() {
  return (
    <React.Suspense fallback={null}>
      <SignupForm />
    </React.Suspense>
  );
}

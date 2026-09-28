"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { AuthCard, FormMessage } from "@/components/account/auth-card";
import { FieldError, PasswordInput } from "@/components/account/password-input";
import { SetupNotice, useAccountSetup } from "@/components/account/setup-notice";
import { GoogleSignIn, OrDivider } from "@/components/account/google-sign-in";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firebaseErrorMessage } from "@/lib/auth/client";
import { isValidEmail, safeNextPath } from "@/lib/auth/shared";

interface Errors {
  email?: string;
  password?: string;
}

function validate(email: string, password: string): Errors {
  const errors: Errors = {};
  if (!email.trim()) errors.email = "Enter your email address.";
  else if (!isValidEmail(email.trim())) errors.email = "Enter a valid email address.";
  if (!password) errors.password = "Enter your password.";
  return errors;
}

function LoginForm() {
  const { status, signIn, pendingGoogleLink, completePendingGoogleLink, cancelPendingGoogleLink } = useAuth();
  const setup = useAccountSetup();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    // While a Google link is pending, stay here: the user must log in to the existing account.
    if (status === "signed-in" && !busy && !pendingGoogleLink) router.replace(next);
  }, [status, busy, next, router, pendingGoogleLink]);

  // Coming from sign-up (or a redirect) with a pending Google link: prefill its email.
  React.useEffect(() => {
    if (pendingGoogleLink?.email) setEmail((e) => e || pendingGoogleLink.email || "");
  }, [pendingGoogleLink]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found = validate(email, password);
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await signIn(email, password);
      if (pendingGoogleLink) {
        // Google asked to be linked to this existing account: do it now that the owner signed in.
        const linked = await completePendingGoogleLink();
        if (linked.status === "linked") {
          toast.success(
            linked.emailVerified
              ? "Google is now linked to your account, and Firebase confirms your email is verified."
              : "Google is now linked to your account."
          );
        } else if (linked.status === "error") {
          toast.error(linked.message);
        }
      }
      router.replace(next);
    } catch (err) {
      setFormError(firebaseErrorMessage(err));
      setBusy(false);
    }
  }

  const signupHref = `/signup${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`;
  const disabled = busy || !setup.ready || status === "loading";

  return (
    <AuthCard
      title="Log in"
      description="Welcome back. Your progress on this device stays as it is."
      footer={
        <>
          New to AlgoVerse?{" "}
          <Link href={signupHref} className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <div className="mb-4 space-y-4">
        <GoogleSignIn
          next={next}
          disabled={!setup.ready}
          showExistingAccountNote
          onLinkRequired={(linkEmail) => linkEmail && setEmail(linkEmail)}
        />
        <OrDivider />
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate aria-label="Log in">
        <SetupNotice problems={setup.problems} />
        {pendingGoogleLink && (
          <div role="status" className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
            <p>
              An AlgoVerse account already exists for{" "}
              <span className="font-medium">{pendingGoogleLink.email ?? "this Google email"}</span>. Log in with its
              password below and Google will be linked to that same account. Nothing is created or changed until you do.
            </p>
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={cancelPendingGoogleLink}>
              Don&apos;t link Google
            </button>
          </div>
        )}
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
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
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          <FieldError id="email-error" message={errors.email} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "password-error" : undefined}
          />
          <FieldError id="password-error" message={errors.password} />
        </div>
        <Button type="submit" className="w-full" disabled={disabled}>
          {(busy || setup.checking) && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Logging in…" : "Log in"}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

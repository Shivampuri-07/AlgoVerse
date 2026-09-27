"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { AuthCard, FormMessage } from "@/components/account/auth-card";
import { FieldError, PasswordInput } from "@/components/account/password-input";
import { SetupNotice, useAccountSetup } from "@/components/account/setup-notice";
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
  const { status, signIn } = useAuth();
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
    if (status === "signed-in" && !busy) router.replace(next);
  }, [status, busy, next, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found = validate(email, password);
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await signIn(email, password);
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
      <form onSubmit={onSubmit} className="space-y-4" noValidate aria-label="Log in">
        <SetupNotice problems={setup.problems} />
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

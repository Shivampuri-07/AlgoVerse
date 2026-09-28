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

interface Errors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

function validate(name: string, email: string, password: string, confirm: string): Errors {
  const errors: Errors = {};
  if (normalizeDisplayName(name) === undefined) errors.name = `Keep your name under ${DISPLAY_NAME_MAX_LENGTH} characters.`;
  if (!email.trim()) errors.email = "Enter your email address.";
  else if (!isValidEmail(email.trim())) errors.email = "Enter a valid email address.";
  const weak = passwordProblem(password);
  if (!password) errors.password = "Choose a password.";
  else if (weak) errors.password = weak;
  if (!confirm) errors.confirm = "Type your password again.";
  else if (confirm !== password) errors.confirm = "Passwords don't match.";
  return errors;
}

function SignupForm() {
  const { status, signUp, setDisplayName } = useAuth();
  const setup = useAccountSetup();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (status === "signed-in" && !busy) router.replace(next);
  }, [status, busy, next, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found = validate(name, email, password, confirm);
    setErrors(found);
    if (Object.keys(found).length) return;
    const displayName = normalizeDisplayName(name) ?? null;
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
      setFormError(firebaseErrorMessage(err));
      setBusy(false);
    }
  }

  const loginHref = `/login${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`;
  const disabled = busy || !setup.ready || status === "loading";
  const field = (key: keyof Errors) => ({
    "aria-invalid": Boolean(errors[key]),
    "aria-describedby": errors[key] ? `${key}-error` : undefined,
  });

  return (
    <AuthCard
      title="Create your account"
      description="Free to join. The roadmap, videos and progress tracking keep working with or without an account."
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <div className="mb-4 space-y-4">
        <GoogleSignIn
          next={next}
          disabled={!setup.ready}
          // The email already has an account: go to log in, where Google gets linked after the password.
          onLinkRequired={() => router.push(`/login${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`)}
        />
        <OrDivider />
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate aria-label="Sign up">
        <SetupNotice problems={setup.problems} />
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        <div className="space-y-2">
          <Label htmlFor="name">
            Name <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="name"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX_LENGTH + 10}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            {...field("name")}
          />
          <FieldError id="name-error" message={errors.name} />
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
            {...field("email")}
          />
          <FieldError id="email-error" message={errors.email} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            {...field("password")}
          />
          {errors.password ? (
            <FieldError id="password-error" message={errors.password} />
          ) : (
            <p className="text-xs text-muted-foreground">
              At least {PASSWORD_MIN_LENGTH} characters, with a letter and a number.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
            {...field("confirm")}
          />
          <FieldError id="confirm-error" message={errors.confirm} />
        </div>
        <Button type="submit" className="w-full" disabled={disabled}>
          {(busy || setup.checking) && <Loader2 className="h-4 w-4 animate-spin" />}
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

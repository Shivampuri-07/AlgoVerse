"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { AuthCard, FormMessage } from "@/components/account/auth-card";
import { FieldError } from "@/components/account/password-input";
import { SetupNotice, useAccountSetup } from "@/components/account/setup-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firebaseErrorMessage } from "@/lib/auth/client";
import { isValidEmail } from "@/lib/auth/shared";

export default function ForgotPasswordPage() {
  const { status, sendPasswordReset } = useAuth();
  const setup = useAccountSetup();
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const value = email.trim();
    const problem = !value ? "Enter your email address." : !isValidEmail(value) ? "Enter a valid email address." : null;
    setEmailError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await sendPasswordReset(value);
      setSent(true);
    } catch (err) {
      setFormError(firebaseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Password reset only needs the Firebase web config (the email is sent by Firebase).
  const disabled = busy || status === "unavailable" || status === "loading";

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we'll send you a link to choose a new password."
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <FormMessage tone="success">
          If an account exists for {email.trim()}, a reset link is on its way. Check your inbox and spam folder.
        </FormMessage>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate aria-label="Reset password">
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
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "email-error" : undefined}
            />
            <FieldError id="email-error" message={emailError} />
          </div>
          <Button type="submit" className="w-full" disabled={disabled}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

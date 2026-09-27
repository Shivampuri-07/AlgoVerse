"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { AccountsUnavailable, AuthCard, FormMessage } from "@/components/account/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firebaseErrorMessage } from "@/lib/auth/client";
import { isValidEmail } from "@/lib/auth/shared";

export default function ForgotPasswordPage() {
  const { status, sendPasswordReset } = useAuth();
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  if (status === "unavailable") return <AccountsUnavailable />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidEmail(email.trim())) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(firebaseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we'll send you a link to choose a new password."
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <FormMessage tone="success">
          If an account exists for {email.trim()}, a reset link is on its way. Check your inbox and spam folder.
        </FormMessage>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <FormMessage tone="error">{error}</FormMessage>}
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
          <Button type="submit" className="w-full" disabled={busy || status === "loading"}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

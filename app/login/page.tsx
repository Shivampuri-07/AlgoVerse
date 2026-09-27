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
import { firebaseErrorMessage } from "@/lib/auth/client";
import { isValidEmail, safeNextPath } from "@/lib/auth/shared";

function LoginForm() {
  const { status, signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
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
    if (!isValidEmail(email.trim())) return setError("Enter a valid email address.");
    if (!password) return setError("Enter your password.");
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace(next);
    } catch (err) {
      setError(firebaseErrorMessage(err));
      setBusy(false);
    }
  }

  const signupHref = `/signup${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <AuthCard
      title="Sign in"
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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy || status === "loading"}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Signing in…" : "Sign in"}
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

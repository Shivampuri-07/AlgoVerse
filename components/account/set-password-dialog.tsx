"use client";

import * as React from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { FieldError, PasswordInput } from "@/components/account/password-input";
import { FormMessage } from "@/components/account/auth-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { firebaseErrorMessage } from "@/lib/auth/client";
import { passwordProblem } from "@/lib/auth/shared";

/**
 * "Set a password" for an account that has none (created with Google). Sets the password on the
 * signed-in Firebase user (updatePassword) — same account, same UID, Google stays linked — rather
 * than a password-reset email. Same password rules as sign-up.
 */
export function SetPasswordDialog({
  open,
  onOpenChange,
  email,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string | null;
  onDone: () => void;
}) {
  const { setPassword } = useAuth();
  const [password, setPasswordValue] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setPasswordValue("");
      setConfirm("");
      setErrors({});
      setFormError(null);
      setBusy(false);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: typeof errors = {};
    const weak = passwordProblem(password);
    if (weak) found.password = weak;
    if (confirm !== password) found.confirm = "Passwords don't match.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFormError(null);
    try {
      await setPassword(password);
      toast.success("Password added. You can now log in with your email and password — Google stays linked.");
      onOpenChange(false);
      onDone();
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      setFormError(
        code === "auth/requires-recent-login"
          ? "For your security, log out and log in again (with Google), then set the password."
          : firebaseErrorMessage(err)
      );
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent data-testid="set-password-dialog">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Set a password</DialogTitle>
            <DialogDescription>
              Add a password to this account{email ? ` (${email})` : ""} so you can also log in with your email. Your
              Google sign-in stays linked, and your data is unchanged.
            </DialogDescription>
          </DialogHeader>
          {formError && <FormMessage tone="error">{formError}</FormMessage>}
          <div className="space-y-2">
            <Label htmlFor="new-password">Password</Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "new-password-error" : "new-password-hint"}
              disabled={busy}
            />
            {errors.password ? (
              <FieldError id="new-password-error" message={errors.password} />
            ) : (
              <p id="new-password-hint" className="text-xs text-muted-foreground">
                At least 8 characters, with a letter and a number.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password-confirm">Confirm password</Label>
            <PasswordInput
              id="new-password-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={Boolean(errors.confirm)}
              aria-describedby={errors.confirm ? "new-password-confirm-error" : undefined}
              disabled={busy}
            />
            <FieldError id="new-password-confirm-error" message={errors.confirm} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Set password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

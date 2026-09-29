"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Clock, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PLAN_SUMMARY, PRICING, formatPrice, proBenefits } from "@/lib/plans";
import { fetchBillingStatus, openCheckout, startCheckout, waitForPro } from "@/lib/billing/client";

/**
 * "Upgrade to Pro" — explains what Pro includes today and what's planned, with the price.
 * Checkout appears only when the SERVER says billing is enabled (Razorpay TEST mode, never on
 * Production); otherwise the button says payments aren't available instead of pretending.
 * After checkout the dialog waits for the server's entitlement — only the verified Razorpay
 * webhook grants Pro, never this dialog.
 */
export function UpgradeDialog({
  open,
  onOpenChange,
  reason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the dialog opened, e.g. "Cloud sync is part of AlgoVerse Pro." */
  reason?: string;
}) {
  const { status } = useAuth();
  const { available, planned } = proBenefits();
  const [billingEnabled, setBillingEnabled] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "starting" | "checkout" | "activating" | "pending">("idle");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open || status !== "signed-in") return;
    const controller = new AbortController();
    void fetchBillingStatus(controller.signal).then((s) => setBillingEnabled(s.enabled));
    return () => controller.abort();
  }, [open, status]);
  React.useEffect(() => {
    if (!open) {
      setPhase("idle");
      setError(null);
    }
  }, [open]);

  async function subscribe() {
    setError(null);
    setPhase("starting");
    try {
      const session = await startCheckout();
      setPhase("checkout");
      const outcome = await openCheckout(session);
      if (outcome === "dismissed") {
        setPhase("idle");
        return;
      }
      setPhase("activating");
      if (await waitForPro()) {
        toast.success("Welcome to AlgoVerse Pro!");
        onOpenChange(false);
        window.location.reload(); // every page picks up the new plan from the server
      } else {
        setPhase("pending");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payments are unavailable right now.");
      setPhase("idle");
    }
  }
  const busy = phase === "starting" || phase === "checkout" || phase === "activating";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> AlgoVerse Pro
          </DialogTitle>
          <DialogDescription>
            {reason ? `${reason} ` : ""}
            {formatPrice(PRICING.proMonthly)} per month, billed monthly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground" data-testid="upgrade-summary">
            {PLAN_SUMMARY}
          </p>
          <div className="space-y-1.5">
            <p className="font-medium">Available now</p>
            <ul className="space-y-1.5">
              {available.map((f) => (
                <li key={f.id} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>
                    <span className="font-medium">{f.label}</span>
                    <span className="text-muted-foreground"> — {f.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {planned.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-medium">Coming later</p>
              <ul className="space-y-1.5">
                {planned.map((f) => (
                  <li key={f.id} className="flex gap-2 text-muted-foreground">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{f.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {billingEnabled ? (
            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-warning" data-testid="payments-test-mode">
              Test mode: use Razorpay&apos;s test payment details. No real money is charged.
            </p>
          ) : (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground" data-testid="payments-unavailable">
              Payments aren&apos;t available yet, so Pro can&apos;t be bought today. Nothing will be charged.
            </p>
          )}
          {phase === "activating" && (
            <p role="status" className="flex items-center gap-2 text-muted-foreground" data-testid="payment-activating">
              <Loader2 className="h-4 w-4 animate-spin" /> Payment received — activating Pro…
            </p>
          )}
          {phase === "pending" && (
            <p role="status" className="text-muted-foreground" data-testid="payment-pending">
              Payment received. Pro switches on as soon as Razorpay confirms it — refresh this page in a minute.
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button asChild variant="ghost">
            <Link href="/pricing" onClick={() => onOpenChange(false)}>
              Compare plans
            </Link>
          </Button>
          {status === "signed-in" ? (
            billingEnabled ? (
              <Button onClick={() => void subscribe()} disabled={busy || phase === "pending"} data-testid="continue-to-payment">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Continue to payment
              </Button>
            ) : (
              <Button disabled>Payments coming soon</Button>
            )
          ) : (
            <Button asChild>
              <Link href="/signup?next=/pricing" onClick={() => onOpenChange(false)}>
                Create a free account
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens the upgrade dialog. */
export function UpgradeButton({ reason, children = "Upgrade to Pro", ...props }: ButtonProps & { reason?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button {...props} onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" />
        {children}
      </Button>
      <UpgradeDialog open={open} onOpenChange={setOpen} reason={reason} />
    </>
  );
}

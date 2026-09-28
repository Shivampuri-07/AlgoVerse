"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Clock, Sparkles } from "lucide-react";
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
import { PRICING, formatPrice, proBenefits } from "@/lib/plans";

/**
 * "Upgrade to Pro" — explains what Pro includes today and what's planned, with the price. There
 * is no checkout until payments launch (Phase 4): the button says so instead of pretending.
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
          {!PRICING.paymentsEnabled && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground" data-testid="payments-unavailable">
              Payments aren&apos;t available yet, so Pro can&apos;t be bought today. Nothing will be charged.
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
            <Button disabled={!PRICING.paymentsEnabled}>{PRICING.paymentsEnabled ? "Continue to payment" : "Payments coming soon"}</Button>
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

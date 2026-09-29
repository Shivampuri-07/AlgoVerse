"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CreditCard, Loader2, Receipt, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { UpgradeButton } from "@/components/billing/upgrade-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PLANS, PLAN_SUMMARY, PRICING, formatPrice, type EntitlementsView } from "@/lib/plans";
import { cancelSubscription, fetchBillingStatus, type BillingStatusView } from "@/lib/billing/client";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS_LABEL: Record<string, string> = {
  created: "Awaiting payment",
  authenticated: "Payment authorised",
  active: "Active",
  pending: "Renewal payment being retried",
  halted: "Stopped (renewal failed)",
  cancelled: "Cancelled",
  completed: "Completed",
  expired: "Expired",
  paused: "Paused",
};

/** Clearly-labelled SAMPLE rows (Preview/local only) showing how payment history will look. */
const SAMPLE_PAYMENTS = [
  { date: "2026-09-01", description: "AlgoVerse Pro — monthly", amount: PRICING.proMonthly, status: "Paid" },
  { date: "2026-08-01", description: "AlgoVerse Pro — monthly", amount: PRICING.proMonthly, status: "Paid" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function BillingView({ entitlements, showSample }: { entitlements: EntitlementsView | null; showSample: boolean }) {
  const plan = entitlements?.plan ?? "free";
  const isPro = plan === "pro";
  // Server says whether (test-mode) billing is on here, plus this user's subscription and payments.
  const [billing, setBilling] = React.useState<BillingStatusView>({ enabled: false });
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const load = React.useCallback((signal?: AbortSignal) => fetchBillingStatus(signal).then(setBilling), []);
  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const sub = billing.enabled ? billing.subscription ?? null : null;
  const payments = billing.enabled ? billing.payments ?? [] : [];
  const canCancel = !!sub && ["authenticated", "active", "pending"].includes(sub.status) && !sub.cancelRequested;

  async function onCancel() {
    setCancelling(true);
    try {
      await cancelSubscription();
      toast.success("Subscription cancelled. Pro stays active until the end of the paid period.");
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel right now.");
    } finally {
      setCancelling(false);
    }
  }
  return (
    <div className="max-w-2xl space-y-6 pb-10">
      <div className="space-y-1">
        <Link href="/account" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Account
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Plan &amp; billing</h1>
      </div>

      {!entitlements && (
        <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Your plan couldn&apos;t be loaded right now. Refresh the page to try again.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> Current plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2" data-testid="current-plan">
            <span className="text-lg font-semibold">{PLANS[plan].name}</span>
            <Badge variant={isPro ? "success" : "outline"}>{isPro ? "Active" : "Free"}</Badge>
            {entitlements?.grantedBy === "preview" && <Badge variant="warning">Cloud sync on for Preview testing</Badge>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
            <dt>Price</dt>
            <dd className="text-foreground">{isPro ? `${formatPrice(PRICING.proMonthly)} / month` : formatPrice(0)}</dd>
            <dt>{isPro ? "Access until" : "Renews"}</dt>
            <dd className="text-foreground" data-testid="plan-until">
              {isPro ? (entitlements?.expiresAt ? formatDate(entitlements.expiresAt) : "No end date") : "—"}
            </dd>
            <dt>DSA problems</dt>
            <dd className="text-foreground">All 455, free</dd>
            <dt>Articles &amp; videos</dt>
            <dd className="text-foreground" data-testid="plan-resources">
              {entitlements?.features.learningResources ? "Included" : "Not included"}
            </dd>
            <dt>Cloud sync</dt>
            <dd className="text-foreground">{entitlements?.features.cloudSync ? "On" : "Not included"}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">{PLAN_SUMMARY}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {!isPro && <UpgradeButton size="sm" />}
            <Button asChild variant="outline" size="sm">
              <Link href="/pricing">Compare plans</Link>
            </Button>
            {isPro && !billing.enabled && (
              <Button variant="outline" size="sm" disabled title="Available when payments launch">
                <CreditCard className="h-4 w-4" /> Manage subscription
              </Button>
            )}
            {canCancel && (
              <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)} data-testid="cancel-subscription">
                <CreditCard className="h-4 w-4" /> Cancel subscription
              </Button>
            )}
          </div>
          {sub && (
            <p className="text-xs text-muted-foreground" data-testid="subscription-status">
              Subscription: {STATUS_LABEL[sub.status] ?? sub.status}
              {sub.cancelRequested ? " — cancelled; Pro stays until the end of the paid period" : ""}
              {sub.currentEnd ? ` · current period ends ${formatDate(sub.currentEnd)}` : ""}
              {billing.mode === "test" ? " · test mode" : ""}
            </p>
          )}
          {!billing.enabled && (
            <p className="text-xs text-muted-foreground">
              Payments aren&apos;t available yet. {isPro ? "Your Pro access was granted without a payment." : "Nothing has been or will be charged."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" /> Payment history
          </CardTitle>
          <CardDescription>Invoices and receipts will appear here once payments launch.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {payments.length > 0 ? (
            <table className="w-full text-xs" data-testid="payment-history">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Date</th>
                  <th className="py-1 font-medium">Description</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                  <th className="py-1 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-border/60">
                    <td className="py-1">{formatDate(p.createdAt)}</td>
                    <td className="py-1">AlgoVerse Pro — monthly{billing.mode === "test" ? " (test)" : ""}</td>
                    <td className="py-1 text-right">{p.currency === "INR" ? formatPrice(p.amount / 100) : `${(p.amount / 100).toFixed(2)} ${p.currency}`}</td>
                    <td className="py-1 text-right capitalize">{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-muted-foreground" data-testid="payment-history-empty">
              No payments.
            </p>
          )}
          {showSample && !billing.enabled && (
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3" data-testid="sample-payments">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sample only (test data, Preview builds) — not real payments
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">Date</th>
                    <th className="py-1 font-medium">Description</th>
                    <th className="py-1 text-right font-medium">Amount</th>
                    <th className="py-1 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_PAYMENTS.map((p) => (
                    <tr key={p.date} className="border-t border-border/60">
                      <td className="py-1">{formatDate(p.date)}</td>
                      <td className="py-1">{p.description}</td>
                      <td className="py-1 text-right">{formatPrice(p.amount)}</td>
                      <td className="py-1 text-right">{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={(o) => !cancelling && setCancelOpen(o)}>
        <DialogContent data-testid="cancel-dialog">
          <DialogHeader>
            <DialogTitle>Cancel your Pro subscription?</DialogTitle>
            <DialogDescription>
              You won&apos;t be charged again. Pro stays active until the end of the period you&apos;ve paid for
              {sub?.currentEnd ? ` (${formatDate(sub.currentEnd)})` : ""}; your progress, notes and bookmarks are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="ghost" disabled={cancelling}>
                Keep Pro
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void onCancel()} disabled={cancelling} data-testid="confirm-cancel">
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

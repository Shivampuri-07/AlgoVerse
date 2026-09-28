"use client";

import Link from "next/link";
import { Check, Clock, Minus } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useSyncSetup } from "@/components/sync/sync-provider";
import { UpgradeButton } from "@/components/billing/upgrade-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FEATURE_MATRIX, PRICING, formatPrice, type FeatureRow } from "@/lib/plans";

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-success" aria-label="Included" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-muted-foreground" aria-label="Not included" />;
  return <span className="text-xs">{value}</span>;
}

function Availability({ row }: { row: FeatureRow }) {
  if (row.availability === "available") return null;
  return (
    <Badge variant="outline" className="ml-2 gap-1 align-middle text-[10px] font-normal">
      <Clock className="h-3 w-3" /> Planned
    </Badge>
  );
}

/** Public pricing: Free vs Pro, generated from lib/plans.ts. */
export function PricingView() {
  const { status } = useAuth();
  const { entitlements } = useSyncSetup();
  const isPro = entitlements?.plan === "pro";
  const freeIncludes = FEATURE_MATRIX.filter((r) => r.free === true);
  const proAdds = FEATURE_MATRIX.filter((r) => r.pro && r.free !== true);

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-10">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Plans</h1>
        <p className="text-muted-foreground">The whole DSA roadmap is free. Pro adds cloud sync and more as it ships.</p>
      </div>

      {(!PRICING.approved || !PRICING.paymentsEnabled) && (
        <p role="note" data-testid="pricing-status" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          {!PRICING.approved && "These plans are a proposal and may change. "}
          {!PRICING.paymentsEnabled && "Payments aren't available yet, so Pro can't be bought today."}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Free</CardTitle>
            <CardDescription>
              <span className="text-3xl font-bold text-foreground">{formatPrice(0)}</span> forever
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm">
              {freeIncludes.map((r) => (
                <li key={r.id} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  {r.label}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="w-full">
              <Link href={status === "signed-in" ? "/" : "/signup"}>{status === "signed-in" ? "Go to dashboard" : "Start free"}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pro {isPro && <Badge variant="success">Your plan</Badge>}
            </CardTitle>
            <CardDescription>
              <span className="text-3xl font-bold text-foreground" data-testid="pro-price">
                {formatPrice(PRICING.proMonthly)}
              </span>{" "}
              per month, billed monthly
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Everything in Free, plus:</p>
            <ul className="space-y-2 text-sm">
              {proAdds.map((r) => (
                <li key={r.id} className="flex gap-2">
                  {r.availability === "available" ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={r.availability === "available" ? "" : "text-muted-foreground"}>
                    {r.label}
                    {typeof r.pro === "string" ? ` (${r.pro})` : ""}
                    {r.availability === "planned" ? " — planned" : ""}
                  </span>
                </li>
              ))}
            </ul>
            {isPro ? (
              <Button asChild variant="outline" className="w-full">
                <Link href="/account/billing">Manage plan</Link>
              </Button>
            ) : (
              <UpgradeButton className="w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compare plans</CardTitle>
          <CardDescription>&quot;Planned&quot; features are on the roadmap and not built yet.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm" data-testid="plan-comparison">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-2 font-medium">Feature</th>
                <th className="w-32 py-2 text-center font-medium">Free</th>
                <th className="w-32 py-2 text-center font-medium">Pro</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_MATRIX.map((r) => (
                <tr key={r.id} className="border-b border-border/60 align-top">
                  <td className="py-2.5 pr-2">
                    <span className="font-medium">{r.label}</span>
                    <Availability row={r} />
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  </td>
                  <td className="py-2.5 text-center">
                    <Cell value={r.free} />
                  </td>
                  <td className="py-2.5 text-center">
                    <Cell value={r.pro} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Your progress stays saved on your device on every plan.
      </p>
    </div>
  );
}

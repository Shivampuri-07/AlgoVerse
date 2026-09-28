import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionValue } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/auth/shared";
import { isAdminConfigured } from "@/lib/firebase/admin";
import { getEntitlements } from "@/lib/entitlements";
import { allowSetupDetails } from "@/lib/firebase/deployment";
import { BillingView } from "@/components/billing/billing-view";
import { AccountSetupRequired } from "@/components/account/setup-notice";

export const metadata: Metadata = { title: "Plan & billing", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Protected: the plan comes from the server's entitlement lookup (never the browser). Payments
 * are Phase 4 — until then there's no real payment history. Never cached by the service worker
 * (it's under /account).
 */
export default async function BillingPage() {
  if (!isAdminConfigured()) return <AccountSetupRequired />;
  const user = await verifySessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login?next=/account/billing");
  let entitlements = null;
  try {
    entitlements = await getEntitlements(user.uid);
  } catch {
    entitlements = null;
  }
  return <BillingView entitlements={entitlements} showSample={allowSetupDetails()} />;
}

/**
 * SERVER-ONLY entitlement lookup. The client never decides what it may use: every premium
 * route calls requireFeature(), which derives the plan from Firestore `entitlements/{uid}`
 * (server-only collection — firestore.rules denies all client access). Phase 3/4 (payments)
 * will write that document; nothing in the browser can.
 *
 * Testing switch: CLOUD_SYNC_PREVIEW_OPEN=1 turns cloud sync on for every signed-in user, but
 * ONLY on Vercel Preview deployments (VERCEL_ENV=preview) or local development. It is ignored on
 * Production, so it can't give paid features away there.
 */
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { PLANS, type EntitlementsView, type Feature, type PlanId } from "@/lib/plans";

export const ENTITLEMENTS_COLLECTION = "entitlements";

function previewSyncOpen(): boolean {
  const env = process.env;
  if (env["CLOUD_SYNC_PREVIEW_OPEN"] !== "1") return false;
  const vercelEnv = env["VERCEL_ENV"];
  if (vercelEnv) return vercelEnv === "preview";
  return env["NODE_ENV"] !== "production" || env["ALGOVERSE_LOCAL"] === "1";
}

export async function getEntitlements(uid: string, now = Date.now()): Promise<EntitlementsView> {
  let plan: PlanId = "free";
  let expiresAt: string | null = null;
  const db = getAdminDb();
  if (db) {
    const snap = await db.collection(ENTITLEMENTS_COLLECTION).doc(uid).get();
    const data = snap.exists ? snap.data() : undefined;
    const exp = data?.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : null;
    if (data?.plan === "pro" && (exp === null || exp > now)) plan = "pro";
    expiresAt = exp !== null ? new Date(exp).toISOString() : null;
  }
  const features = { ...PLANS[plan].features };
  let grantedBy: EntitlementsView["grantedBy"] = "plan";
  if (!features.cloudSync && previewSyncOpen()) {
    features.cloudSync = true;
    grantedBy = "preview";
  }
  return { plan, features, grantedBy, expiresAt };
}

export async function hasFeature(uid: string, feature: Feature): Promise<boolean> {
  return (await getEntitlements(uid)).features[feature];
}

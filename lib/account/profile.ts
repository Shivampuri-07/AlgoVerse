/**
 * SERVER-ONLY profile storage. Firestore document `users/{uid}`:
 *   { displayName: string | null, createdAt: Timestamp, updatedAt: Timestamp }
 * Email and verification status stay in Firebase Auth (not duplicated here).
 * Callers pass the uid of the AUTHENTICATED user only (see lib/auth/server.ts).
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { AccountProfile } from "@/lib/auth/shared";

export const USERS_COLLECTION = "users";

function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

/** Creates `users/{uid}` if it doesn't exist yet. Idempotent and safe to call on every sign-in. */
export async function ensureProfile(uid: string): Promise<void> {
  const db = getAdminDb();
  if (!db) throw new Error("admin_not_configured");
  try {
    await db.collection(USERS_COLLECTION).doc(uid).create({
      displayName: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
}

/**
 * Records the account's current Firebase sign-in methods on the profile document and reports
 * whether the password method has disappeared since the last sign-in. That happens when someone
 * signs in with Google for an email whose password account was never verified: Firebase keeps the
 * same account (UID and data) but removes the password, by design, to prevent account takeover.
 * Source of truth is Firebase Admin (providerData), never the client.
 */
export async function recordSignInMethods(uid: string): Promise<{ passwordRemoved: boolean }> {
  const auth = getAdminAuth();
  const db = getAdminDb();
  if (!auth || !db) return { passwordRemoved: false };
  const record = await auth.getUser(uid);
  const methods = record.providerData.map((p) => p.providerId).sort();
  const ref = db.collection(USERS_COLLECTION).doc(uid);
  const snap = await ref.get();
  const previous: unknown = snap.exists ? snap.data()?.signInMethods : undefined;
  const hadPassword = Array.isArray(previous) && previous.includes("password");
  const passwordRemoved = hadPassword && !methods.includes("password");
  await ref.set(
    {
      signInMethods: methods,
      ...(passwordRemoved ? { passwordRemovedAt: FieldValue.serverTimestamp() } : {}),
      ...(methods.includes("password") ? { passwordRemovedAt: null } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { passwordRemoved };
}

/** Profile for the account page: fresh Auth record (verification status) + Firestore profile. */
export async function getProfile(uid: string): Promise<AccountProfile | null> {
  const auth = getAdminAuth();
  const db = getAdminDb();
  if (!auth || !db) return null;
  // The Auth record (verification status, sign-in methods) is authoritative and required; the
  // Firestore profile is optional, so a missing/unreachable database doesn't hide it.
  const [record, snap] = await Promise.all([
    auth.getUser(uid),
    db
      .collection(USERS_COLLECTION)
      .doc(uid)
      .get()
      .catch((err: unknown) => {
        console.error(`[account] profile document read failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
        return null;
      }),
  ]);
  const data = snap?.exists ? snap.data() : undefined;
  const created = data?.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null;
  const email = record.email?.toLowerCase() ?? null;
  const providers = record.providerData.map((p) => p.providerId);
  const verifiedByGoogle =
    record.emailVerified &&
    email !== null &&
    record.providerData.some((p) => p.providerId === "google.com" && p.email?.toLowerCase() === email);
  return {
    uid,
    email: record.email ?? null,
    emailVerified: record.emailVerified,
    providers,
    verifiedByGoogle,
    passwordRemovedAt:
      !providers.includes("password") && data?.passwordRemovedAt instanceof Timestamp
        ? data.passwordRemovedAt.toDate().toISOString()
        : null,
    displayName: typeof data?.displayName === "string" ? data.displayName : null,
    createdAt: created ?? (record.metadata.creationTime ? new Date(record.metadata.creationTime).toISOString() : null),
  };
}

/** Sets the display name (already validated with normalizeDisplayName). */
export async function updateDisplayName(uid: string, displayName: string | null): Promise<void> {
  const auth = getAdminAuth();
  const db = getAdminDb();
  if (!auth || !db) throw new Error("admin_not_configured");
  await db
    .collection(USERS_COLLECTION)
    .doc(uid)
    .set({ displayName, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await auth.updateUser(uid, { displayName });
}

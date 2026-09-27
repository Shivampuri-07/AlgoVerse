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

/** Profile for the account page: fresh Auth record (verification status) + Firestore profile. */
export async function getProfile(uid: string): Promise<AccountProfile | null> {
  const auth = getAdminAuth();
  const db = getAdminDb();
  if (!auth || !db) return null;
  const [record, snap] = await Promise.all([auth.getUser(uid), db.collection(USERS_COLLECTION).doc(uid).get()]);
  const data = snap.exists ? snap.data() : undefined;
  const created = data?.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null;
  return {
    uid,
    email: record.email ?? null,
    emailVerified: record.emailVerified,
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

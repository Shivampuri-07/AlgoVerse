/**
 * The document GET /api/auth/status READS (never writes) to tell "database not created yet" apart
 * from other errors. It must be a valid Firestore path — document IDs matching /^__.*__$/ are
 * reserved and rejected with INVALID_ARGUMENT (code 3), which the old `users/__status_probe__` hit —
 * and it lives in its own collection so it can never collide with a user's document. Clients can't
 * read it (firestore.rules denies everything not listed); the Admin SDK only reads it.
 */
export const STATUS_PROBE_PATH = "_diagnostics/status-probe";

/** Firestore's rules for a document path: even number of non-empty segments, no reserved IDs. */
export function isValidDocumentPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.length < 2 || segments.length % 2 !== 0) return false;
  return segments.every(
    (s) => s.length > 0 && s !== "." && s !== ".." && !/^__.*__$/.test(s) && new TextEncoder().encode(s).length <= 1500
  );
}

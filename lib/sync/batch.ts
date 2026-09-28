/**
 * Size-aware batching for sync (pure). Batches are limited by count AND by encoded size, so a
 * request or Firestore transaction never exceeds platform limits however long the notes are.
 */
import type { SyncOp } from "@/lib/sync/types";

const encoder = new TextEncoder();

/** Approximate encoded size of an op in the request body (UTF-8 JSON). */
export function opBytes(op: SyncOp): number {
  return encoder.encode(JSON.stringify(op)).length + 1;
}

/** The longest prefix of `ops` within both limits (always at least one op, so progress is guaranteed). */
export function takeBatch(ops: SyncOp[], maxOps: number, maxBytes: number): SyncOp[] {
  const out: SyncOp[] = [];
  let bytes = 2; // "[]"
  for (const op of ops) {
    const b = opBytes(op);
    if (out.length > 0 && (out.length >= maxOps || bytes + b > maxBytes)) break;
    out.push(op);
    bytes += b;
  }
  return out;
}

/** Splits `ops` into consecutive batches within both limits, preserving order. */
export function chunkOps(ops: SyncOp[], maxOps: number, maxBytes: number): SyncOp[][] {
  const chunks: SyncOp[][] = [];
  let rest = ops;
  while (rest.length) {
    const batch = takeBatch(rest, maxOps, maxBytes);
    chunks.push(batch);
    rest = rest.slice(batch.length);
  }
  return chunks;
}

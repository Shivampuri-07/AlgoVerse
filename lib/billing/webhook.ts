/**
 * SERVER-ONLY. Razorpay webhook authenticity: Razorpay signs the RAW request body with the
 * webhook secret (HMAC-SHA256, hex) and sends it in the X-Razorpay-Signature header. Verify
 * against the exact bytes received — never a re-serialised JSON — and compare in constant time.
 * An unverified webhook must change nothing.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(rawBody: string | Uint8Array, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

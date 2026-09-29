/**
 * SERVER-ONLY. Minimal Razorpay Subscriptions REST client (no SDK dependency): create, fetch and
 * cancel a subscription. Authenticates with HTTP Basic (key id : key secret) — the secret never
 * leaves the server. Errors carry Razorpay's status and error CODE only (no response bodies).
 */
export interface RazorpaySubscription {
  id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  plan_id?: string;
}

export class RazorpayError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`razorpay_${status}_${code}`);
    this.status = status;
    this.code = code;
  }
}

export interface RazorpayClient {
  createSubscription(opts: { planId: string; uid: string }): Promise<RazorpaySubscription>;
  fetchSubscription(id: string): Promise<RazorpaySubscription>;
  cancelSubscription(id: string, atCycleEnd: boolean): Promise<RazorpaySubscription>;
}

const SUB_ID = /^sub_[A-Za-z0-9]{1,40}$/;

export function razorpayClient(
  settings: { keyId: string; keySecret: string; apiBase: string },
  fetchImpl: typeof fetch = fetch
): RazorpayClient {
  const auth = "Basic " + Buffer.from(`${settings.keyId}:${settings.keySecret}`).toString("base64");
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<RazorpaySubscription> {
    let res: Response;
    try {
      res = await fetchImpl(`${settings.apiBase}${path}`, {
        method,
        headers: { Authorization: auth, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new RazorpayError(0, "network");
    }
    const data = (await res.json().catch(() => null)) as (RazorpaySubscription & { error?: { code?: string } }) | null;
    if (!res.ok || !data) throw new RazorpayError(res.status, String(data?.error?.code ?? "unknown"));
    if (typeof data.id !== "string" || !SUB_ID.test(data.id)) throw new RazorpayError(502, "malformed_response");
    return data;
  }
  return {
    createSubscription: ({ planId, uid }) =>
      // total_count: monthly cycles (10 years); notes.uid is informational only — ownership comes
      // from our own subscriptions/{id} record written before checkout.
      call("POST", "/v1/subscriptions", { plan_id: planId, total_count: 120, customer_notify: 1, quantity: 1, notes: { app: "algoverse", uid } }),
    fetchSubscription: (id) => {
      if (!SUB_ID.test(id)) throw new RazorpayError(400, "bad_id");
      return call("GET", `/v1/subscriptions/${id}`);
    },
    cancelSubscription: (id, atCycleEnd) => {
      if (!SUB_ID.test(id)) throw new RazorpayError(400, "bad_id");
      return call("POST", `/v1/subscriptions/${id}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
    },
  };
}

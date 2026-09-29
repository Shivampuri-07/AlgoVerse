/**
 * Browser side of billing (TEST mode). Talks only to our /api/billing/* routes and Razorpay's
 * official Checkout script; holds no secrets (the key id is public). The browser never grants Pro:
 * after checkout it waits for the server's entitlement, which only the verified webhook changes.
 */
export interface BillingStatusView {
  enabled: boolean;
  mode?: "test";
  keyId?: string;
  subscription?: { status: string; currentEnd: string | null; cancelRequested: boolean } | null;
  payments?: { id: string; amount: number; currency: string; status: string; createdAt: string }[];
}

export async function fetchBillingStatus(signal?: AbortSignal): Promise<BillingStatusView> {
  try {
    const res = await fetch("/api/billing/status", { cache: "no-store", credentials: "same-origin", signal });
    if (!res.ok) return { enabled: false };
    return (await res.json()) as BillingStatusView;
  } catch {
    return { enabled: false };
  }
}

async function post<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !data) throw new Error(data?.error?.message ?? "Payments are unavailable right now. Please try again later.");
  return data;
}

export const startCheckout = () => post<{ keyId: string; subscriptionId: string; email: string | null }>("/api/billing/checkout");
export const cancelSubscription = () => post<{ ok: true }>("/api/billing/cancel");

interface RazorpayInstance {
  open(): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<void> | null = null;

function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHECKOUT_JS;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve() : reject(new Error("checkout_unavailable")));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("checkout_unavailable"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Opens Razorpay Checkout for our subscription. Resolves "paid" or "dismissed". */
export async function openCheckout(opts: { keyId: string; subscriptionId: string; email: string | null }): Promise<"paid" | "dismissed"> {
  await loadCheckoutScript();
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: opts.keyId,
      subscription_id: opts.subscriptionId,
      name: "AlgoVerse",
      description: "AlgoVerse Pro — monthly (test mode)",
      prefill: opts.email ? { email: opts.email } : {},
      theme: { color: "#4f46e5" },
      // Razorpay's callback is NOT trusted to grant anything; we only use it to start waiting.
      handler: () => resolve("paid"),
      modal: { ondismiss: () => resolve("dismissed") },
    });
    rzp.open();
  });
}

/** Waits for the server to report Pro (the verified webhook has been applied). */
export async function waitForPro(timeoutMs = 60_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch("/api/me/entitlements", { cache: "no-store", credentials: "same-origin" });
      if (res.ok && ((await res.json()) as { plan?: string }).plan === "pro") return true;
    } catch {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

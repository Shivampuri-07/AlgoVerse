import {
  AI_CLIENT_MESSAGES,
  type AiErrorCode,
  type AiRequestBody,
  type AiStreamEvent,
} from "@/lib/ai/shared";

export type AiResult =
  | { ok: true; model?: string }
  | { ok: false; code: AiErrorCode; message: string; aborted?: boolean };

const KNOWN_CODES: readonly AiErrorCode[] = [
  "not_configured",
  "bad_request",
  "unauthorized",
  "rate_limited",
  "model_unavailable",
  "region_unsupported",
  "blocked",
  "timeout",
  "provider_unavailable",
  "empty_response",
  "malformed_response",
  "network",
];

function asCode(value: unknown, fallback: AiErrorCode): AiErrorCode {
  return typeof value === "string" && (KNOWN_CODES as readonly string[]).includes(value)
    ? (value as AiErrorCode)
    : fallback;
}

function fallbackMessage(code: AiErrorCode): string {
  if (code === "rate_limited") return AI_CLIENT_MESSAGES.rate_limited;
  if (code === "empty_response") return AI_CLIENT_MESSAGES.empty_response;
  if (code === "not_configured") return AI_CLIENT_MESSAGES.not_configured;
  if (code === "network") return AI_CLIENT_MESSAGES.network;
  return AI_CLIENT_MESSAGES.unavailable;
}

/** Our own server's message for an error, or a generic fallback. */
function messageFrom(value: unknown, code: AiErrorCode): string {
  return typeof value === "string" && value.trim() ? value.slice(0, 400) : fallbackMessage(code);
}

let configuredOnce = false;

/**
 * Asks our server (GET /api/ai) whether a Gemini API key is set, so a missing key shows the
 * setup message without firing a request that is bound to fail. Only a positive answer is
 * cached; the response never contains the key itself, just `{ configured, model, message? }`.
 */
export async function checkAiConfigured(
  signal?: AbortSignal
): Promise<{ configured: boolean; message?: string } | undefined> {
  if (configuredOnce) return { configured: true };
  try {
    const res = await fetch("/api/ai", { method: "GET", cache: "no-store", signal });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { configured?: unknown; message?: unknown };
    if (data.configured === true) configuredOnce = true;
    return {
      configured: data.configured === true,
      message: typeof data.message === "string" ? data.message : undefined,
    };
  } catch {
    return undefined; // unknown — let the POST report the real problem
  }
}

/**
 * Calls POST /api/ai and streams the answer. `onDelta` receives each text piece as it
 * arrives. Never talks to Google Gemini directly — the API key lives only on the server.
 */
export async function streamAiReply(
  body: AiRequestBody,
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<AiResult> {
  const status = await checkAiConfigured(signal);
  if (status && !status.configured) {
    return { ok: false, code: "not_configured", message: messageFrom(status.message, "not_configured") };
  }

  let res: Response;
  try {
    res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal?.aborted) return { ok: false, code: "network", message: "Stopped.", aborted: true };
    return { ok: false, code: "network", message: AI_CLIENT_MESSAGES.network };
  }

  if (!res.ok || !res.body) {
    let code: AiErrorCode = res.status === 429 ? "rate_limited" : "provider_unavailable";
    let message: unknown;
    try {
      const data = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
      code = asCode(data?.error?.code, code);
      message = data?.error?.message;
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, code, message: messageFrom(message, code) };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let event: AiStreamEvent;
        try {
          event = JSON.parse(line) as AiStreamEvent;
        } catch {
          continue;
        }
        if (event.type === "delta") {
          if (typeof event.text === "string" && event.text) {
            received = true;
            onDelta(event.text);
          }
        } else if (event.type === "error") {
          const code = asCode(event.code, "provider_unavailable");
          return { ok: false, code, message: messageFrom(event.message, code) };
        } else if (event.type === "done") {
          return received
            ? { ok: true, model: event.model }
            : { ok: false, code: "empty_response", message: AI_CLIENT_MESSAGES.empty_response };
        }
      }
    }
  } catch {
    if (signal?.aborted) return { ok: false, code: "network", message: "Stopped.", aborted: true };
    return { ok: false, code: "network", message: AI_CLIENT_MESSAGES.network };
  }
  return received
    ? { ok: true }
    : { ok: false, code: "empty_response", message: AI_CLIENT_MESSAGES.empty_response };
}

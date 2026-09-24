import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import {
  AI_ERROR_MESSAGES,
  allowRequest,
  buildContents,
  buildSystemInstruction,
  canFallBack,
  errorPayload,
  getApiKey,
  mapGeminiError,
  parseRequestBody,
  resolveModels,
  usesLowThinking,
  type MappedError,
} from "@/lib/ai/server";
import type { AiErrorCode, AiStreamEvent } from "@/lib/ai/shared";

/**
 * POST /api/ai — the browser's only way to reach the AI.
 *
 * The browser sends problem metadata + the conversation (and, for Debug My Code, the
 * student's code). This server route adds the tutor system instruction, calls Google Gemini
 * with the server-side GEMINI_API_KEY through the official @google/genai SDK, and streams the
 * answer back as newline-delimited JSON events (see AiStreamEvent).
 * The API key, raw provider errors and the system prompt never reach the client.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FIRST_TOKEN_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 58_000;

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

function fail(code: AiErrorCode, status: number, extraHeaders: Record<string, string> = {}) {
  return json(errorPayload(code), status, extraHeaders);
}

function failMapped(err: MappedError) {
  const headers: Record<string, string> = {};
  if (err.code === "rate_limited") headers["Retry-After"] = String(err.retryAfter ?? 30);
  return fail(err.code, err.status, headers);
}

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

function httpStatus(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? `, HTTP ${status}` : "";
}

/** Why a finished stream produced no text. */
function emptyReason(last: GenerateContentResponse | undefined): AiErrorCode {
  if (last?.promptFeedback?.blockReason) return "blocked";
  const finish = last?.candidates?.[0]?.finishReason;
  if (finish && /SAFETY|RECITATION|BLOCKLIST|PROHIBITED|SPII/.test(String(finish))) return "blocked";
  return "empty_response";
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) return fail("not_configured", 503);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("bad_request", 400);
  }
  const body = parseRequestBody(raw);
  if (!body) return fail("bad_request", 400);

  if (!allowRequest(clientKey(req))) return fail("rate_limited", 429, { "Retry-After": "60" });

  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  let tokenTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(),
    FIRST_TOKEN_TIMEOUT_MS
  );
  const clearTimers = () => {
    clearTimeout(totalTimer);
    clearTimeout(tokenTimer);
  };
  req.signal?.addEventListener("abort", () => controller.abort());

  const ai = new GoogleGenAI({ apiKey });
  const contents = buildContents(body);
  const systemInstruction = buildSystemInstruction(body.problem);

  // Open the stream and read the first chunk before answering, so failures that happen
  // before any text (bad key, 429, overloaded model…) get a proper HTTP status — and can
  // fall back to the lighter model — instead of a half-started stream.
  let iterator: AsyncIterator<GenerateContentResponse> | undefined;
  let first: IteratorResult<GenerateContentResponse> | undefined;
  let model = "";
  const models = resolveModels();
  for (let i = 0; i < models.length; i++) {
    model = models[i];
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: 0.4,
          maxOutputTokens: 4096,
          ...(usesLowThinking(model) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          abortSignal: controller.signal,
        },
      });
      iterator = stream[Symbol.asyncIterator]();
      first = await iterator.next();
      break;
    } catch (err) {
      const mapped = mapGeminiError(err, controller.signal.aborted);
      // Code + HTTP status only — never the provider message (it can echo request details).
      console.error(`[ai] Gemini ${model} failed before streaming (${mapped.code}${httpStatus(err)})`);
      if (i < models.length - 1 && canFallBack(mapped.code) && !controller.signal.aborted) continue;
      clearTimers();
      return failMapped(mapped);
    }
  }
  if (!iterator || !first) {
    clearTimers();
    return fail("provider_unavailable", 503);
  }
  const it = iterator;
  const firstResult = first;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(out) {
      const send = (event: AiStreamEvent) => out.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      let produced = 0;
      let last: GenerateContentResponse | undefined;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      };
      const finish = (event: AiStreamEvent) => {
        clearTimeout(idleTimer);
        clearTimers();
        try {
          send(event);
          out.close();
        } catch {
          /* client already gone */
        }
      };
      const handle = (chunk: GenerateContentResponse) => {
        last = chunk;
        const text = chunk.text;
        if (typeof text === "string" && text.length > 0) {
          if (tokenTimer) {
            clearTimeout(tokenTimer);
            tokenTimer = undefined;
          }
          produced += text.length;
          send({ type: "delta", text });
        }
      };

      try {
        armIdle();
        let result = firstResult;
        while (!result.done) {
          handle(result.value);
          armIdle();
          result = await it.next();
        }
        if (produced === 0) {
          const code = emptyReason(last);
          console.error(`[ai] Gemini ${model} returned no text (${code})`);
          return finish({ type: "error", code, message: errorPayload(code).error.message });
        }
        return finish({ type: "done", model });
      } catch (err) {
        const { code } = mapGeminiError(err, controller.signal.aborted);
        console.error(`[ai] Gemini ${model} stream failed (${code}${httpStatus(err)})`);
        return finish({ type: "error", code, message: errorPayload(code).error.message });
      }
    },
    cancel() {
      controller.abort();
      void it.return?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export function GET() {
  // Lets the UI check whether the helper is configured without exposing anything else.
  const configured = Boolean(getApiKey());
  return json(
    configured
      ? { configured, model: resolveModels()[0] }
      : { configured, model: resolveModels()[0], message: AI_ERROR_MESSAGES.not_configured },
    200
  );
}

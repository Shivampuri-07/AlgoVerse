import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import {
  AI_ERROR_MESSAGES,
  allowRequest,
  buildContents,
  buildSystemInstruction,
  canFallBack,
  errorPayload,
  getApiKey,
  apiKeyState,
  mapGeminiError,
  parseRequestBody,
  resolveModels,
  usesLowThinking,
  type MappedError,
} from "@/lib/ai/server";
import { istDay, type AiUsageStore } from "@/lib/ai/usage";
import type { AiErrorCode, AiStreamEvent, AiUsageView } from "@/lib/ai/shared";
import type { AuthUser } from "@/lib/auth/server";
import type { PlanId } from "@/lib/plans";

/**
 * SERVER-ONLY. POST/GET /api/ai — the browser's only way to reach the AI (app/api/ai/route.ts
 * wires in the real dependencies; tests pass fakes).
 *
 * Access (Phase 5), checked in this order before Gemini is called:
 *   1. a valid session cookie or Firebase ID token (401 sign_in_required)
 *   2. cookie requests must be same-origin (403 forbidden — CSRF)
 *   3. a verified email address (403 verify_email)
 *   4. the plan from the server (lib/entitlements.ts) — never from the request
 *   5. one unit reserved in the shared usage store (429 daily_limit / slow_down / busy)
 * If Gemini fails before any text, the unit is refunded.
 *
 * The browser sends problem metadata + the conversation (and, for Debug My Code, the
 * student's code). This adds the tutor system instruction, calls Google Gemini with the
 * server-side GEMINI_API_KEY through the official @google/genai SDK, and streams the answer
 * back as newline-delimited JSON events (see AiStreamEvent). The API key, raw provider errors
 * and the system prompt never reach the client; logs carry error codes only.
 */
export interface AiDeps {
  /** The signed-in user, null if none, "unavailable" if accounts can't be checked. */
  authenticate(req: Request): Promise<AuthUser | null | "unavailable">;
  sameOrigin(req: Request): boolean;
  /** Fresh from Firebase when the session's claim is stale. */
  emailVerified(user: AuthUser): Promise<boolean>;
  plan(uid: string): Promise<PlanId>;
  usage(): AiUsageStore | null;
  now(): number;
}

/** How long the primary model may take to start answering before the lighter model is tried. */
const PRIMARY_FIRST_TOKEN_MS = 20_000;
/** The last model's first-token wait (within the total budget). */
const FIRST_TOKEN_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 58_000;

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

function fail(code: AiErrorCode, status: number, extraHeaders: Record<string, string> = {}, usage?: AiUsageView) {
  return json(usage ? { ...errorPayload(code), usage } : errorPayload(code), status, extraHeaders);
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

type Access =
  { ok: true; uid: string; plan: PlanId; day: string; usage: AiUsageView } | { ok: false; response: Response };

async function checkAccess(req: Request, deps: AiDeps): Promise<Access> {
  const deny = (code: AiErrorCode, status: number, headers: Record<string, string> = {}, usage?: AiUsageView) =>
    ({ ok: false, response: fail(code, status, headers, usage) }) as const;
  let user: AuthUser | null | "unavailable";
  try {
    user = await deps.authenticate(req);
  } catch {
    user = "unavailable";
  }
  if (user === "unavailable") return deny("account_unavailable", 503);
  if (!user) return deny("sign_in_required", 401);
  if (user.via === "cookie" && !deps.sameOrigin(req)) return deny("forbidden", 403);
  let verified = false;
  try {
    verified = await deps.emailVerified(user);
  } catch (err) {
    console.error(`[ai] email verification lookup failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return deny("account_unavailable", 503);
  }
  if (!verified) return deny("verify_email", 403);

  const store = deps.usage();
  if (!store) return deny("account_unavailable", 503);
  const now = deps.now();
  try {
    const plan = await deps.plan(user.uid);
    const decision = await store.reserve(user.uid, plan, now);
    if (!decision.allowed) {
      return deny(decision.reason, 429, { "Retry-After": String(decision.retryAfterSeconds) }, decision.view);
    }
    return { ok: true, uid: user.uid, plan, day: istDay(now), usage: decision.view };
  } catch (err) {
    // Fail closed: without a working counter nobody gets unmetered access to the shared quota.
    console.error(`[ai] usage check failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    return deny("account_unavailable", 503);
  }
}

export async function handleAiPost(req: Request, deps: AiDeps): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(
      apiKeyState() === "preview_unscoped"
        ? "[ai] Preview deployment without its own Gemini key (GEMINI_KEY_SCOPE=preview is not set) — refusing to use a shared key"
        : "[ai] GEMINI_API_KEY is not set on the server"
    );
    return fail("not_configured", 503);
  }
  // Cheap per-instance flood guard before any Firebase work (the real limits are per account).
  if (!allowRequest(clientKey(req))) return fail("slow_down", 429, { "Retry-After": "60" });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("bad_request", 400);
  }
  const body = parseRequestBody(raw);
  if (!body) return fail("bad_request", 400);

  const access = await checkAccess(req, deps);
  if (!access.ok) return access.response;
  const refund = async () => {
    try {
      await deps.usage()?.release(access.uid, access.day);
    } catch (err) {
      console.error(`[ai] usage refund failed (${(err as { code?: unknown })?.code ?? "unknown"})`);
    }
  };

  // `overall` = the request's hard deadline and the client going away; each model attempt gets its
  // own controller (linked to `overall`) so a SLOW primary can time out and fall back to the
  // lighter model instead of failing the whole request.
  const overall = new AbortController();
  const totalTimer = setTimeout(() => overall.abort(), TOTAL_TIMEOUT_MS);
  req.signal?.addEventListener("abort", () => overall.abort());
  let controller = new AbortController(); // the attempt whose stream is sent to the client
  let tokenTimer: ReturnType<typeof setTimeout> | undefined;
  const clearTimers = () => {
    clearTimeout(totalTimer);
    clearTimeout(tokenTimer);
  };

  const ai = new GoogleGenAI({ apiKey });
  const contents = buildContents(body);
  const systemInstruction = buildSystemInstruction(body.problem);

  // Open the stream and read the first chunk before answering, so failures that happen
  // before any text (bad key, 429, overloaded or too-slow model…) get a proper HTTP status — and
  // can fall back to the lighter model — instead of a half-started stream.
  let iterator: AsyncIterator<GenerateContentResponse> | undefined;
  let first: IteratorResult<GenerateContentResponse> | undefined;
  let model = "";
  const models = resolveModels();
  for (let i = 0; i < models.length; i++) {
    model = models[i];
    const isLast = i === models.length - 1;
    const attempt = new AbortController();
    const relay = () => attempt.abort();
    if (overall.signal.aborted) attempt.abort();
    else overall.signal.addEventListener("abort", relay, { once: true });
    let attemptTimedOut = false;
    tokenTimer = setTimeout(
      () => {
        attemptTimedOut = true;
        attempt.abort();
      },
      isLast ? FIRST_TOKEN_TIMEOUT_MS : PRIMARY_FIRST_TOKEN_MS
    );
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: 0.4,
          maxOutputTokens: 4096,
          ...(usesLowThinking(model) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          abortSignal: attempt.signal,
        },
      });
      iterator = stream[Symbol.asyncIterator]();
      first = await iterator.next();
      controller = attempt;
      break;
    } catch (err) {
      clearTimeout(tokenTimer);
      tokenTimer = undefined;
      overall.signal.removeEventListener("abort", relay);
      const mapped = mapGeminiError(err, attempt.signal.aborted);
      // Code + HTTP status only — never the provider message (it can echo request details).
      console.error(`[ai] Gemini ${model} failed before streaming (${mapped.code}${httpStatus(err)})`);
      // Fall back on overload/limits, or when this model was too slow to start — never after the
      // client left or the request's overall deadline passed.
      if (!isLast && !overall.signal.aborted && (canFallBack(mapped.code) || attemptTimedOut)) continue;
      clearTimers();
      await refund();
      return failMapped(mapped);
    }
  }
  if (!iterator || !first) {
    clearTimers();
    await refund();
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
        return finish({ type: "done", model, usage: access.usage });
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

/** Whether the helper is configured, plus the signed-in user's allowance (never the key). */
export async function handleAiGet(req: Request, deps: AiDeps): Promise<Response> {
  const configured = Boolean(getApiKey());
  let usage: AiUsageView | undefined;
  try {
    const user = await deps.authenticate(req);
    const store = deps.usage();
    if (user && user !== "unavailable" && store)
      usage = await store.peek(user.uid, await deps.plan(user.uid), deps.now());
  } catch {
    /* allowance is optional here */
  }
  return json(
    {
      configured,
      model: resolveModels()[0],
      ...(configured ? {} : { message: AI_ERROR_MESSAGES.not_configured }),
      ...(usage ? { usage } : {}),
    },
    200,
  );
}

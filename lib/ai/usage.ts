/**
 * SERVER-ONLY. AI helper usage limits that hold across serverless instances.
 *
 * Every AI request RESERVES one unit before Gemini is called, in a single Firestore transaction:
 *   aiUsage/{uid}          { day, count, minuteStart, minuteCount, updatedAt }  per account
 *   aiUsageGlobal/{day}    { count, updatedAt }                                 whole app, per day
 * Limits:
 *   - per account per day: AI_DAILY_LIMITS[plan] (plan read on the server, never from the request)
 *   - per account per minute: AI_BURST_PER_MINUTE (stops scripted bursts)
 *   - whole app per day: AI_GLOBAL_DAILY_LIMIT env (default 500) — protects the shared free
 *     Gemini quota from many accounts together
 * Transactions serialise concurrent requests for the same account, so parallel requests can't
 * exceed a limit. A reservation is RELEASED (refunded) only when Gemini fails before producing
 * any answer — the user isn't charged for our/Google's outage.
 *
 * Days follow India time (UTC+05:30, no DST): allowances reset at 00:00 IST.
 * Both collections are server-only (firestore.rules denies all client access).
 */
import type { Firestore } from "firebase-admin/firestore";
import { AI_DAILY_LIMITS, type PlanId } from "@/lib/plans";
import type { AiUsageView } from "@/lib/ai/shared";

export const AI_BURST_PER_MINUTE = 5;
export const DEFAULT_GLOBAL_DAILY_LIMIT = 500;
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export function globalDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env["AI_GLOBAL_DAILY_LIMIT"]);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_GLOBAL_DAILY_LIMIT;
}

/** "YYYY-MM-DD" in India time. */
export function istDay(now: number): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The next 00:00 India time after `now` (ms). */
export function nextIstMidnight(now: number): number {
  return Math.floor((now + IST_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - IST_OFFSET_MS;
}

export interface UserUsage {
  day: string;
  count: number;
  minuteStart: number;
  minuteCount: number;
}

export interface Limits {
  daily: number;
  perMinute: number;
  globalDaily: number;
}

export function limitsFor(plan: PlanId, env: Record<string, string | undefined> = process.env): Limits {
  return { daily: AI_DAILY_LIMITS[plan], perMinute: AI_BURST_PER_MINUTE, globalDaily: globalDailyLimit(env) };
}

export type Decision =
  | { allowed: true; user: UserUsage; globalCount: number; view: AiUsageView }
  | { allowed: false; reason: "daily_limit" | "slow_down" | "busy"; retryAfterSeconds: number; view: AiUsageView };

function sanitize(u: Partial<UserUsage> | undefined, day: string): UserUsage {
  const same = u?.day === day;
  return {
    day,
    count: same && Number.isInteger(u?.count) && u!.count! > 0 ? u!.count! : 0,
    minuteStart: Number.isFinite(u?.minuteStart) ? u!.minuteStart! : 0,
    minuteCount: Number.isInteger(u?.minuteCount) && u!.minuteCount! > 0 ? u!.minuteCount! : 0,
  };
}

export function usageView(plan: PlanId, used: number, limits: Limits, now: number): AiUsageView {
  return {
    plan,
    limit: limits.daily,
    used: Math.min(used, limits.daily),
    remaining: Math.max(0, limits.daily - used),
    resetAt: new Date(nextIstMidnight(now)).toISOString(),
  };
}

/** Pure: may this account ask one more question now? Returns the new state if so. */
export function decide(
  stored: Partial<UserUsage> | undefined,
  globalCount: number,
  plan: PlanId,
  limits: Limits,
  now: number,
): Decision {
  const day = istDay(now);
  const u = sanitize(stored, day);
  // Requests read the clock before their transaction commits, so a slightly OLDER `now` can arrive
  // after a newer window started (or another instance's clock is a little ahead). That must not
  // open a fresh window — only a window that ended, or a start implausibly far in the future, does.
  const inWindow = now - u.minuteStart < MINUTE_MS && u.minuteStart - now < MINUTE_MS;
  const minuteCount = inWindow ? u.minuteCount : 0;
  const minuteStart = inWindow ? u.minuteStart : now;
  const untilMidnight = Math.max(1, Math.ceil((nextIstMidnight(now) - now) / 1000));

  if (u.count >= limits.daily) {
    return {
      allowed: false,
      reason: "daily_limit",
      retryAfterSeconds: untilMidnight,
      view: usageView(plan, u.count, limits, now),
    };
  }
  if (minuteCount >= limits.perMinute) {
    const wait = Math.max(1, Math.ceil((minuteStart + MINUTE_MS - now) / 1000));
    return {
      allowed: false,
      reason: "slow_down",
      retryAfterSeconds: wait,
      view: usageView(plan, u.count, limits, now),
    };
  }
  if (globalCount >= limits.globalDaily) {
    return {
      allowed: false,
      reason: "busy",
      retryAfterSeconds: untilMidnight,
      view: usageView(plan, u.count, limits, now),
    };
  }
  const next: UserUsage = { day, count: u.count + 1, minuteStart, minuteCount: minuteCount + 1 };
  return { allowed: true, user: next, globalCount: globalCount + 1, view: usageView(plan, next.count, limits, now) };
}

/** Where usage is counted. Firestore in the app; in memory for unit tests. */
export interface AiUsageStore {
  reserve(uid: string, plan: PlanId, now: number): Promise<Decision>;
  /** Refund a reservation made on `day` (Gemini failed before answering). */
  release(uid: string, day: string): Promise<void>;
  peek(uid: string, plan: PlanId, now: number): Promise<AiUsageView>;
}

export const USAGE_COLLECTION = "aiUsage";
export const GLOBAL_USAGE_COLLECTION = "aiUsageGlobal";

export function firestoreUsageStore(
  db: Firestore,
  env: Record<string, string | undefined> = process.env,
): AiUsageStore {
  const userRef = (uid: string) => db.collection(USAGE_COLLECTION).doc(uid);
  const globalRef = (day: string) => db.collection(GLOBAL_USAGE_COLLECTION).doc(day);
  return {
    async reserve(uid, plan, now) {
      const limits = limitsFor(plan, env);
      const day = istDay(now);
      return db.runTransaction(async (tx) => {
        const [u, g] = await Promise.all([tx.get(userRef(uid)), tx.get(globalRef(day))]);
        const decision = decide(
          u.data() as Partial<UserUsage> | undefined,
          Number(g.get("count")) || 0,
          plan,
          limits,
          now,
        );
        if (decision.allowed) {
          tx.set(userRef(uid), { ...decision.user, updatedAt: new Date(now) });
          tx.set(globalRef(day), { count: decision.globalCount, updatedAt: new Date(now) });
        }
        return decision;
      });
    },
    async release(uid, day) {
      await db.runTransaction(async (tx) => {
        const [u, g] = await Promise.all([tx.get(userRef(uid)), tx.get(globalRef(day))]);
        if (u.get("day") === day && Number(u.get("count")) > 0)
          tx.update(userRef(uid), { count: Number(u.get("count")) - 1 });
        if (Number(g.get("count")) > 0) tx.update(globalRef(day), { count: Number(g.get("count")) - 1 });
      });
    },
    async peek(uid, plan, now) {
      const snap = await userRef(uid).get();
      const u = sanitize(snap.data() as Partial<UserUsage> | undefined, istDay(now));
      return usageView(plan, u.count, limitsFor(plan, env), now);
    },
  };
}

/** Same rules, one process only — for unit tests. */
export function memoryUsageStore(env: Record<string, string | undefined> = {}): AiUsageStore & { reset(): void } {
  let users = new Map<string, UserUsage>();
  let global = new Map<string, number>();
  return {
    async reserve(uid, plan, now) {
      const day = istDay(now);
      const decision = decide(users.get(uid), global.get(day) ?? 0, plan, limitsFor(plan, env), now);
      if (decision.allowed) {
        users.set(uid, decision.user);
        global.set(day, decision.globalCount);
      }
      return decision;
    },
    async release(uid, day) {
      const u = users.get(uid);
      if (u && u.day === day && u.count > 0) users.set(uid, { ...u, count: u.count - 1 });
      global.set(day, Math.max(0, (global.get(day) ?? 0) - 1));
    },
    async peek(uid, plan, now) {
      return usageView(plan, sanitize(users.get(uid), istDay(now)).count, limitsFor(plan, env), now);
    },
    reset() {
      users = new Map();
      global = new Map();
    },
  };
}

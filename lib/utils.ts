import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names conditionally, resolving conflicts
 * (e.g. "p-2" vs "p-4") in favor of the last one applied.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Clamp a number between a min and max value. */
export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Safely compute a percentage (0-100), avoiding division by zero. */
export function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return clamp(Math.round((numerator / denominator) * 100), 0, 100);
}

/** Format a YYYY-MM-DD date key for "today" in the user's local timezone. */
export function todayKey(): string {
  return dateKey(new Date());
}

/** Format any Date as a YYYY-MM-DD local-time key. */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Local-calendar date key for an ISO timestamp. (Slicing the ISO string would give the
 * UTC date, which is the wrong day for anyone far from UTC — e.g. early morning in India.)
 */
export function isoToDateKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : dateKey(d);
}

/** Number of whole days between two YYYY-MM-DD keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86_400_000);
}

/** Shift a YYYY-MM-DD key by N days (negative to go backward). */
export function shiftDateKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + deltaDays);
  return dateKey(date);
}

export function formatDateLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

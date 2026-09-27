import type { StriverVideo } from "../data/striverVideos";

/**
 * Checks for data/striverVideos.ts, used by `npm run validate:data` and the tests.
 * No imports besides types, so it runs under Node's type stripping as well as in Next.js.
 */

/** A YouTube video id: exactly 11 characters from [A-Za-z0-9_-]. */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const SOURCES = new Set(["both", "tuf-site", "a2z-sheet"]);

export interface VideoMapReport {
  ok: boolean;
  problems: number;
  mapped: number;
  missing: number;
  distinctVideos: number;
  withStart: number;
  bySource: Record<string, number>;
  issues: string[];
}

export function validateVideoMap(
  map: Readonly<Record<number, StriverVideo>>,
  problemIds: readonly number[]
): VideoMapReport {
  const ids = new Set(problemIds);
  const issues: string[] = [];
  const bySource: Record<string, number> = {};
  const videos = new Set<string>();
  let mapped = 0;
  let withStart = 0;

  for (const [key, v] of Object.entries(map)) {
    const id = Number(key);
    const where = `video #${key}`;
    if (!Number.isInteger(id) || String(id) !== key) {
      issues.push(`${where}: key is not an integer problem id`);
      continue;
    }
    if (!ids.has(id)) issues.push(`${where}: no problem with this id`);
    if (!v || typeof v !== "object") {
      issues.push(`${where}: entry is not an object`);
      continue;
    }
    if (typeof v.videoId !== "string" || !YOUTUBE_ID_RE.test(v.videoId)) issues.push(`${where}: invalid YouTube id ${JSON.stringify(v.videoId)}`);
    if (typeof v.title !== "string" || v.title.trim() === "") issues.push(`${where}: missing video title`);
    if (v.start !== undefined && !(Number.isInteger(v.start) && v.start > 0)) issues.push(`${where}: start must be a positive whole number of seconds`);
    if (v.embeddable !== undefined && typeof v.embeddable !== "boolean") issues.push(`${where}: embeddable must be true/false`);
    if (!SOURCES.has(v.source)) issues.push(`${where}: unknown source ${JSON.stringify(v.source)}`);
    mapped++;
    if (v.start) withStart++;
    if (typeof v.videoId === "string") videos.add(v.videoId);
    bySource[v.source] = (bySource[v.source] ?? 0) + 1;
  }

  return {
    ok: issues.length === 0,
    problems: ids.size,
    mapped,
    missing: ids.size - mapped,
    distinctVideos: videos.size,
    withStart,
    bySource,
    issues,
  };
}

export function formatVideoReport(r: VideoMapReport): string {
  const line = "==============================";
  const out = [
    line,
    "STRIVER VIDEO MAPPING",
    line,
    `Problems with a verified video: ${r.mapped} / ${r.problems}`,
    `Problems without a video: ${r.missing} (listed in docs/STRIVER_VIDEOS.md)`,
    `Distinct YouTube videos: ${r.distinctVideos} (${r.withStart} mappings start at a timestamp)`,
    `By source: ${Object.entries(r.bySource)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
    `Invalid entries: ${r.issues.length}`,
  ];
  for (const i of r.issues) out.push(`- ${i}`);
  out.push(`VIDEOS: ${r.ok ? "PASS" : "FAIL"}`, line);
  return out.join("\n");
}

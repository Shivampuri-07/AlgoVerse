// Tests for the Striver video mapping (data/striverVideos.ts + lib/videos.ts).
// Run: npm run test:videos
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { a2zProblems } = await import("@/data/a2zProblems");
const { STRIVER_VIDEOS } = await import("@/data/striverVideos");
const videos = await import("@/lib/videos");
const { validateVideoMap } = await import("@/lib/video-validation");

const byId = new Map(a2zProblems.map((p) => [p.id, p]));

test("the dataset still has all 455 problems with unchanged ids (1..455, id = order)", () => {
  assert.equal(a2zProblems.length, 455);
  const ids = a2zProblems.map((p) => p.id).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 455 }, (_, i) => i + 1));
  for (const p of a2zProblems) assert.equal(p.id, p.order, `#${p.id}`);
  // Spot-check a few titles so a reordering would be caught.
  assert.equal(byId.get(1)?.title, "User Input / Output");
  assert.equal(byId.get(53)?.title, "2Sum Problem");
  assert.equal(byId.get(402)?.title, "0/1 Knapsack (DP - 19)");
  assert.equal(byId.get(455)?.title, "Count palindromic subsequence in given string");
});

test("the video map is valid: existing problem ids, real YouTube ids, titles, sources", () => {
  const r = validateVideoMap(STRIVER_VIDEOS, a2zProblems.map((p) => p.id));
  assert.deepEqual(r.issues, []);
  assert.ok(r.ok);
  assert.equal(r.mapped + r.missing, 455);
  assert.ok(r.mapped > 0 && r.mapped < 455, "not every problem has a verified video");
});

test("the report and the data file agree on the number of verified videos", () => {
  const doc = readFileSync("docs/STRIVER_VIDEOS.md", "utf8");
  const mapped = Object.keys(STRIVER_VIDEOS).length;
  assert.match(doc, new RegExp(`Problems with a verified video\\*\\* \\| \\*\\*${mapped}\\*\\*`));
  assert.match(doc, new RegExp(`Problems without a video \\(listed below\\) \\| ${455 - mapped} `));
  const rows = doc.split("## Verified videos")[1].split("\n").filter((l) => /^\| \d+ \|/.test(l));
  assert.equal(rows.length, mapped);
  for (const row of rows) {
    const id = Number(row.split("|")[1]);
    assert.ok(STRIVER_VIDEOS[id], `report row #${id} is in the data file`);
    assert.ok(row.includes(`watch?v=${STRIVER_VIDEOS[id].videoId}`), `report row #${id} has the same video`);
  }
});

test("a mapped problem returns its verified video and runtime-built URLs", () => {
  const v = videos.getStriverVideo(53);
  assert.ok(v);
  assert.equal(v.videoId, "UXDSeD9mN-k");
  assert.match(v.title, /2 Sum/);
  assert.equal(videos.youtubeWatchUrl(v), "https://www.youtube.com/watch?v=UXDSeD9mN-k");
  const embed = new URL(videos.youtubeEmbedUrl(v));
  assert.equal(embed.origin, "https://www.youtube-nocookie.com");
  assert.equal(embed.pathname, "/embed/UXDSeD9mN-k");
  assert.equal(embed.searchParams.get("autoplay"), null, "never autoplays");
  assert.equal(embed.searchParams.get("start"), null);
  assert.equal(videos.hasStriverVideo(53), true);
});

test("lecture videos keep their start time in both URLs", () => {
  const v = videos.getStriverVideo(14); // Reverse a Number, inside the Basic Maths lecture
  assert.ok(v);
  assert.equal(v.start, 930);
  assert.equal(videos.youtubeWatchUrl(v), `https://www.youtube.com/watch?v=${v.videoId}&t=930s`);
  assert.equal(new URL(videos.youtubeEmbedUrl(v)).searchParams.get("start"), "930");
  assert.equal(videos.formatTimestamp(930), "15:30");
  assert.equal(videos.formatTimestamp(3677), "1:01:17");
});

test("unmapped problems return no video (the page shows the 'not available yet' message)", () => {
  for (const id of [2, 9, 112, 242, 450, 455]) {
    assert.ok(byId.has(id));
    assert.equal(videos.getStriverVideo(id), undefined, `#${id}`);
    assert.equal(videos.hasStriverVideo(id), false, `#${id}`);
  }
});

test("candidates rejected on review stay unmapped", () => {
  // Wrong or non-specific videos in the sources: see docs/STRIVER_VIDEOS.md.
  for (const id of [41, 326, 332, 347, 359, 360, 369]) assert.equal(STRIVER_VIDEOS[id], undefined, `#${id}`);
  // The classic sheet's 0/1 Knapsack row carries the Assign Cookies video; it must not be used.
  assert.notEqual(STRIVER_VIDEOS[402]?.videoId, STRIVER_VIDEOS[259]?.videoId);
  assert.equal(STRIVER_VIDEOS[259]?.videoId, "DIX2p7vb9co");
});

test("items whose sheet video belongs to a neighbouring problem use their own video", () => {
  // e.g. the takeuforward.org sheet points BFS at the DFS lecture.
  assert.notEqual(STRIVER_VIDEOS[334]?.videoId, STRIVER_VIDEOS[335]?.videoId);
  assert.match(STRIVER_VIDEOS[334]!.title, /Breadth-First Search/);
  assert.match(STRIVER_VIDEOS[317]!.title, /Ceil/);
  assert.match(STRIVER_VIDEOS[374]!.title, /Kruskal/);
});

test("lookups are safe for unknown, malformed or hostile input", () => {
  for (const id of [0, -1, 456, 1.5, Number.NaN, Infinity]) assert.equal(videos.getStriverVideo(id), undefined, String(id));
  const bad = {
    1: { videoId: "not-a-real-youtube-id", title: "x", source: "both" },
    2: { videoId: "abc", title: "x", source: "both" },
    3: { videoId: "UXDSeD9mN-k", title: "ok", source: "both" },
  } as never;
  assert.equal(videos.getStriverVideo(1, bad), undefined);
  assert.equal(videos.getStriverVideo(2, bad), undefined);
  assert.equal(videos.getStriverVideo(3, bad)?.videoId, "UXDSeD9mN-k");
  // Object.prototype keys are not treated as mappings.
  assert.equal(videos.getStriverVideo("constructor" as never), undefined);
  assert.equal(videos.isValidYouTubeId("UXDSeD9mN-k"), true);
  assert.equal(videos.isValidYouTubeId("UXDSeD9mN-k?t=1"), false);
  assert.equal(videos.isValidYouTubeId(undefined), false);
});

test("the validator rejects bad entries", () => {
  const r = validateVideoMap(
    {
      1: { videoId: "UXDSeD9mN-k", title: "fine", source: "both" },
      999: { videoId: "UXDSeD9mN-k", title: "no such problem", source: "both" },
      2: { videoId: "https://youtu.be/UXDSeD9mN-k", title: "url instead of id", source: "both" },
      3: { videoId: "UXDSeD9mN-k", title: "", source: "both", start: -5 },
      4: { videoId: "UXDSeD9mN-k", title: "x", source: "somewhere" },
    } as never,
    [1, 2, 3, 4]
  );
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 5, r.issues.join("\n"));
});

test("only ids are stored — no URLs, API keys or tracking parameters in the data file", () => {
  const src = readFileSync("data/striverVideos.ts", "utf8");
  assert.ok(!/https?:\/\//.test(src.split("export const STRIVER_VIDEOS:")[1]), "no URLs in the map");
  assert.ok(!/AIza|GEMINI|api[_-]?key|si=|utm_/i.test(src));
});

test("browser-safe video index matches the server data and contains no video ids", async () => {
  const { STRIVER_VIDEO_TITLES } = await import("@/data/videoIndex");
  const index = readFileSync(new URL("../../data/videoIndex.ts", import.meta.url), "utf8");
  assert.deepEqual(Object.keys(STRIVER_VIDEO_TITLES).map(Number).sort((a, b) => a - b), Object.keys(STRIVER_VIDEOS).map(Number).sort((a, b) => a - b));
  for (const [id, v] of Object.entries(STRIVER_VIDEOS)) {
    assert.equal(STRIVER_VIDEO_TITLES[Number(id)], v.title, `title of #${id}`);
    assert.ok(!index.includes(v.videoId), `index leaks the id of #${id}`);
  }
});

test("Pro resources lookup: video watch link and article for a problem; none for unknown ids", async () => {
  const { getLearningResources } = await import("@/lib/resources");
  const { ARTICLES } = await import("@/data/articles");
  const r = getLearningResources(6)!;
  assert.match(r.video!.watchUrl, /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}/);
  assert.equal(r.article!.url, ARTICLES[6].url);
  assert.equal(getLearningResources(999_999), null);
  // Every dataset article flag has a server-side URL and vice versa.
  const flagged = a2zProblems.filter((p) => p.article).map((p) => p.id).sort((a, b) => a - b);
  assert.deepEqual(Object.keys(ARTICLES).map(Number).sort((a, b) => a - b), flagged);
  assert.ok(a2zProblems.every((p) => !(p.article && "url" in p.article)), "no article URL left in the public dataset");
});

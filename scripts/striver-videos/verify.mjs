// Fetches the inputs for scripts/striver-videos/build.py. Run from the repository root on a
// machine that can reach takeuforward.org and youtube.com:
//
//   node scripts/striver-videos/verify.mjs
//
// Writes (git-ignored):
//   .verify/striver-sheet.html   takeuforward.org's A2Z sheet page (holds a `yt_video` per item)
//   .verify/striver-oembed.json  YouTube oEmbed result for every candidate video id
//
// Uses only public pages and YouTube's public oEmbed endpoint — no API key, nothing is
// downloaded from YouTube except the small oEmbed JSON (title + channel).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SHEET_URL = "https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2/";
const ID_RE = /(?:youtu\.be\/|[?&]v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/g;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

async function get(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      if (i === tries - 1) return { status: 0, text: "", error: String(e?.message || e) };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

const idsIn = (text) => [...text.replace(/\\u002F/gi, "/").replace(/\\\//g, "/").matchAll(ID_RE)].map((m) => m[1]);

mkdirSync(".verify", { recursive: true });
const sheet = await get(SHEET_URL);
if (sheet.status !== 200) throw new Error(`sheet page: HTTP ${sheet.status} ${sheet.error ?? ""}`);
writeFileSync(".verify/striver-sheet.html", sheet.text);

const a2z = JSON.parse(readFileSync("scripts/striver-videos/a2z-sheet-videos.json", "utf8"));
const ids = [...new Set([...idsIn(sheet.text), ...Object.values(a2z).flatMap((v) => (v?.url ? idsIn(v.url) : []))])];
console.log(`sheet page: ${sheet.text.length} bytes; ${ids.length} candidate video ids`);

const out = {};
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const r = await get(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
      let j = null;
      try {
        j = JSON.parse(r.text);
      } catch {}
      // 200 = public and embeddable; 401 = embedding disabled; 400/403/404 = private/removed.
      out[id] = { status: r.status, title: j?.title ?? null, author_name: j?.author_name ?? null, author_url: j?.author_url ?? null };
    }
  })
);
writeFileSync(".verify/striver-oembed.json", JSON.stringify(out, null, 1));
const byStatus = Object.values(out).reduce((a, v) => ((a[v.status] = (a[v.status] || 0) + 1), a), {});
console.log("oEmbed statuses:", byStatus, "-> .verify/striver-oembed.json");

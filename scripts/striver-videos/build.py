#!/usr/bin/env python3
"""Build data/striverVideos.ts and docs/STRIVER_VIDEOS.md from verified sources.

Inputs:

  data/a2zProblems.ts                            ids, titles, TUF article / practice links
  scripts/striver-videos/a2z-sheet-videos.json   video link the classic A2Z sheet lists per item
  scripts/striver-videos/decisions.json          hand-review decisions
  .verify/striver-sheet.html   takeuforward.org's A2Z sheet page (its embedded sheet data has a
                               `yt_video` field per item)       } written by verify.mjs, on a
  .verify/striver-oembed.json  YouTube oEmbed result per id      } machine that can reach
                                                                   YouTube and takeuforward.org

A problem gets a video only when:
  * the video id is listed for that exact item by the takeuforward.org sheet and/or the
    classic A2Z sheet (never guessed, never searched for);
  * YouTube oEmbed returns 200 for it (exists, public, embeddable) with author
    "take U forward";
  * when the two sheets disagree or only one lists a video, the choice was reviewed by hand
    (decisions.json) against the YouTube title.

Run from the repository root:  python3 scripts/striver-videos/build.py
"""
import datetime
import html as htmlmod
import json
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
VERIFY = ROOT / ".verify"
HERE = Path(__file__).resolve().parent
CHANNEL = "take U forward"
ID_RE = re.compile(r"(?:youtu\.be/|[?&]v=|embed/|shorts/|live/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])")


def video_of(url):
    if not url:
        return None, None
    m = ID_RE.search(url)
    t = re.search(r"[?&]t=(\d+)", url)
    return (m.group(1) if m else None), (int(t.group(1)) if t else None)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def tuf_sheet_items(page):
    """Items of the sheet data embedded in the takeuforward.org A2Z sheet page."""
    s = page.replace("\\\\", "\x00").replace('\\"', '"').replace("\x00", "\\")
    s = s.replace("\\u002F", "/").replace("\\/", "/").replace("\\u0026", "&")
    j = s.find(',"rows":[')
    if j < 0:
        raise SystemExit("sheet page: no sheet data found")
    depth, k = 0, j - 1
    while True:  # walk back to the start of the "fields" array
        if s[k] == "]":
            depth += 1
        elif s[k] == "[":
            depth -= 1
            if depth == 0:
                break
        k -= 1
    dec = json.JSONDecoder()
    schemas, _ = dec.raw_decode(s[k:j])
    rows, _ = dec.raw_decode(s[j + len(',"rows":'):])

    def resolve(v):
        if isinstance(v, str) and v.startswith("$") and ":rows:" in v:
            a, b = v.split(":rows:")[1].split(":")
            return resolve(rows[int(a)][int(b)])
        return v

    items = []
    for r in rows:
        rec = {name: resolve(v) for name, v in zip(schemas[r[0]], r[1:])}
        if rec.get("type") == "item":
            items.append(rec)
    return items


def dataset_rows():
    """id, title, TUF article URL and TUF practice URL of every problem in data/a2zProblems.ts."""
    rows = []
    for line in (ROOT / "data" / "a2zProblems.ts").read_text().splitlines():
        m = re.match(r'\s*\{ id: (\d+), order: \d+,.*?title: ("(?:[^"\\]|\\.)*")', line)
        if not m:
            continue
        art = re.search(r'article: \{ url: "([^"]+)"', line)
        tuf = re.search(r'"(https://takeuforward\.org/practice/[^"]+)"', line)
        rows.append({"id": int(m.group(1)), "title": json.loads(m.group(2)),
                     "article": art.group(1) if art else None, "tuf": tuf.group(1) if tuf else None})
    return rows


def main():
    rows = dataset_rows()
    a2z = {int(k): v for k, v in json.loads((HERE / "a2z-sheet-videos.json").read_text()).items() if not k.startswith("_")}
    oembed = json.loads((VERIFY / "striver-oembed.json").read_text())
    items = tuf_sheet_items((VERIFY / "striver-sheet.html").read_text())
    decisions = json.loads((HERE / "decisions.json").read_text())
    ignore_a2z = {int(k) for k in decisions["ignoreA2zSheet"]}
    use_a2z = {int(k): v for k, v in decisions["useA2zSheet"].items()}
    exclude = {int(k): v for k, v in decisions["exclude"].items()}
    manual_item = {int(k): v for k, v in decisions["tufItem"].items() if not k.startswith("_")}

    titles = {r["id"]: r["title"] for r in rows}
    assert len(titles) == len(rows) == 455, len(rows)

    by_slug = {i["slug"]: i for i in items}
    by_blog, by_title = {}, {}
    for i in items:
        if i.get("free_blog_link"):
            by_blog.setdefault(i["free_blog_link"].rstrip("/"), []).append(i)
        by_title.setdefault(norm(i["label"]), []).append(i)

    def ok(vid):
        o = oembed.get(vid) or {}
        return o.get("status") == 200 and o.get("author_name") == CHANNEL

    videos, missing = {}, []
    for r in rows:
        pid = r["id"]
        item = None
        if pid in manual_item:
            item = by_slug.get(manual_item[pid])
        if not item and r.get("tuf"):
            item = by_slug.get(r["tuf"].rstrip("/").split("/")[-1])
        if not item and r.get("article"):
            c = by_blog.get(re.sub(r"^https://takeuforward\.org", "", r["article"]).rstrip("/"), [])
            item = c[0] if len(c) == 1 else None
        if not item:
            c = by_title.get(norm(r["title"]), [])
            item = c[0] if len(c) == 1 else None

        t_vid, t_start = video_of(item.get("yt_video") if item else None)
        a_vid, a_start = video_of(a2z[pid]["url"]) if pid in a2z and pid not in ignore_a2z else (None, None)

        if pid in exclude:
            missing.append((pid, r["title"], "Excluded after review: " + exclude[pid]))
            continue
        if t_vid and a_vid and t_vid != a_vid and pid not in use_a2z:
            chosen, start, source, note = t_vid, t_start, "tuf-site", "Sheets disagree; takeuforward.org sheet video used (YouTube title names this problem)."
        elif pid in use_a2z:
            chosen, start, source, note = a_vid, a_start, "a2z-sheet", use_a2z[pid]
        elif t_vid and a_vid:
            chosen, start, source, note = t_vid, t_start if t_start is not None else a_start, "both", ""
        elif t_vid:
            chosen, start, source, note = t_vid, t_start, "tuf-site", decisions["ignoreA2zSheet"].get(str(pid), "")
        elif a_vid:
            chosen, start, source, note = a_vid, a_start, "a2z-sheet", ""
        else:
            missing.append((pid, r["title"], "No video is listed for this item on the takeuforward.org sheet or the classic A2Z sheet."))
            continue
        if not chosen or not ok(chosen):
            missing.append((pid, r["title"], f"Candidate {chosen} failed the YouTube oEmbed check."))
            continue
        videos[pid] = {
            "videoId": chosen,
            "title": oembed[chosen]["title"],
            **({"start": start} if start else {}),
            "source": source,
            **({"note": note} if note else {}),
        }

    # ---- data/striverVideos.ts -------------------------------------------------------------
    today = datetime.date.today().isoformat()
    lines = [
        "/**",
        " * Striver (take U forward) YouTube explanations, keyed by problem id (data/a2zProblems.ts).",
        " *",
        " * GENERATED by scripts/striver-videos/build.py — see docs/STRIVER_VIDEOS.md for the sources,",
        " * the verification rules and the list of problems that have no verified video yet.",
        " * Only YouTube video ids are stored; lib/videos.ts builds the watch/embed URLs at runtime.",
        " * To add or fix one mapping by hand, edit its line here (and the report) — no UI change needed.",
        " */",
        "export type StriverVideoSource =",
        '  /** listed for this item by both the takeuforward.org sheet and the classic A2Z sheet */',
        '  | "both"',
        '  /** listed by the takeuforward.org A2Z sheet page */',
        '  | "tuf-site"',
        '  /** listed by the classic A2Z sheet (reviewed by hand, see the report) */',
        '  | "a2z-sheet";',
        "",
        "export interface StriverVideo {",
        "  /** 11-character YouTube video id. */",
        "  videoId: string;",
        "  /** The video's title on YouTube (from YouTube oEmbed at verification time). */",
        "  title: string;",
        "  /** Start offset in seconds, for lecture videos that cover several problems. */",
        "  start?: number;",
        "  /** Set to false if the channel disables embedding: the page then only links to YouTube. */",
        "  embeddable?: boolean;",
        "  source: StriverVideoSource;",
        "  /** Why this video was chosen when the sources disagreed. */",
        "  note?: string;",
        "}",
        "",
        f'export const STRIVER_VIDEOS_VERIFIED_ON = "{today}";',
        "",
        "export const STRIVER_VIDEOS: Readonly<Record<number, StriverVideo>> = {",
    ]
    for pid in sorted(videos):
        v = videos[pid]
        fields = [f"videoId: {json.dumps(v['videoId'])}", f"title: {json.dumps(v['title'], ensure_ascii=False)}"]
        if "start" in v:
            fields.append(f"start: {v['start']}")
        fields.append(f"source: {json.dumps(v['source'])}")
        if "note" in v:
            fields.append(f"note: {json.dumps(v['note'], ensure_ascii=False)}")
        lines.append(f"  {pid}: {{ {', '.join(fields)} }},")
    lines += ["};", ""]
    (ROOT / "data" / "striverVideos.ts").write_text("\n".join(lines))

    # ---- docs/STRIVER_VIDEOS.md --------------------------------------------------------------
    def fmt(sec):
        h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
        return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

    def cell(s):
        return htmlmod.escape(s, quote=False).replace("|", "\\|")

    counts = {k: sum(1 for v in videos.values() if v["source"] == k) for k in ("both", "tuf-site", "a2z-sheet")}
    unique = len({v["videoId"] for v in videos.values()})
    doc = [
        "# Striver video explanations — verification report",
        "",
        f"Generated by `scripts/striver-videos/build.py` on {today}. Data: `data/striverVideos.ts`.",
        "",
        "| | |",
        "|---|---|",
        "| Problems in AlgoVerse | 455 |",
        f"| **Problems with a verified video** | **{len(videos)}** |",
        f"| Problems without a video (listed below) | {len(missing)} |",
        f"| Distinct YouTube videos used | {unique} (lecture videos are shared, most with a start time) |",
        f"| Listed by both sheets | {counts['both']} |",
        f"| Listed by the takeuforward.org sheet only, or chosen from it when the sheets disagree | {counts['tuf-site']} |",
        f"| Taken from the classic A2Z sheet (reviewed by hand) | {counts['a2z-sheet']} |",
        "",
        "Not every problem has a video: some items have no video on either sheet (mostly the",
        "string, heap and some theory items), and a few candidates were rejected on review.",
        "Those problems show *\"Striver's video explanation is not available for this problem yet.\"*",
        "",
        "## Sources",
        "",
        "1. **takeuforward.org — Striver's A2Z DSA Sheet page**",
        "   (<https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2/>). The page",
        "   embeds the sheet data; each item has a `yt_video` field. Items were matched to AlgoVerse",
        "   problems by their TUF practice slug (the problem's TakeUForward practice link), then by the",
        "   TUF article path, then by exact title, plus 12 hand-checked title variants",
        "   (`decisions.json` → `tufItem`).",
        "2. **The classic A2Z sheet's video links** (the resource column of the 455-item sheet this",
        "   dataset was built from; same order and titles as `data/a2zProblems.ts`).",
        "3. **YouTube oEmbed** (`https://www.youtube.com/oembed?url=…`, public, no API key) for every",
        "   candidate id: all used videos returned HTTP 200 (exists, public, embeddable) with author",
        f"   **{CHANNEL}** (<https://www.youtube.com/@takeUforward>). The stored title is the YouTube title.",
        "",
        "TakeUForward article pages and practice pages were also fetched; they don't contain YouTube",
        "links in their HTML, so they weren't used as a source.",
        "",
        "## Rules",
        "",
        "- A video id is used only if a sheet lists it for that exact item — nothing is guessed or",
        "  found by searching YouTube.",
        "- Both sheets agree → used. Only one lists a video, or they disagree → the YouTube title was",
        "  checked by hand; the video whose title names this problem is used, otherwise none.",
        "- Lecture videos that cover several problems keep the sheet's start time.",
        "- AlgoVerse isn't affiliated with Take U Forward; videos are shown with YouTube's official",
        "  embed (privacy-enhanced, loaded only on click, no autoplay) and link back to YouTube.",
        "",
        "## Updating",
        "",
        "1. On a machine that can reach YouTube and takeuforward.org, run",
        "   `node scripts/striver-videos/verify.mjs` from the repository root (writes `.verify/`).",
        "2. `python3 scripts/striver-videos/build.py` — regenerates the data file and this report.",
        "3. Review the diff; record any hand decision in `scripts/striver-videos/decisions.json`.",
        "4. `npm run validate:data && npm test`.",
        "",
        "To fix a single mapping by hand, edit its line in `data/striverVideos.ts` (the video must be",
        "Striver's own video for that exact problem) and note it here.",
        "",
        f"## Problems without a verified video ({len(missing)})",
        "",
        "| # | Problem | Reason |",
        "|---:|---|---|",
    ]
    for pid, title, why in sorted(missing):
        doc.append(f"| {pid} | {cell(title)} | {cell(why)} |")
    doc += [
        "",
        f"## Verified videos ({len(videos)})",
        "",
        "| # | Problem | Video | Start | Source |",
        "|---:|---|---|---|---|",
    ]
    for pid in sorted(videos):
        v = videos[pid]
        url = f"https://www.youtube.com/watch?v={v['videoId']}" + (f"&t={v['start']}s" if v.get("start") else "")
        src = {"both": "both sheets", "tuf-site": "takeuforward.org", "a2z-sheet": "A2Z sheet"}[v["source"]]
        if v.get("note"):
            src += f" — {v['note']}"
        doc.append(f"| {pid} | {cell(titles[pid])} | [{cell(v['title'])}]({url}) | {fmt(v['start']) if v.get('start') else ''} | {cell(src)} |")
    doc.append("")
    (ROOT / "docs" / "STRIVER_VIDEOS.md").write_text("\n".join(doc))
    print(f"verified: {len(videos)}  missing: {len(missing)}  distinct videos: {unique}  sources: {counts}")


if __name__ == "__main__":
    main()

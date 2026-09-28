/**
 * Dataset validation — pure functions with no imports, so the same code runs in the app
 * (Settings → Dataset health) and from the command line (`npm run validate:data`).
 */

export interface ValidatableProblem {
  id: number;
  order: number;
  topic: string;
  section?: string;
  title: string;
  difficulty: string;
  kind?: string;
  platforms: { leetcode?: string; gfg?: string; code360?: string; other?: string };
  otherLabel?: string;
  /** The public dataset only records that an article exists; URLs are server-only (data/articles.ts). */
  article?: { source: string; url?: string };
  related?: { platform: string; url: string; title?: string }[];
  tags?: string[];
}

export interface ValidatableTopic {
  id: string;
  name: string;
}

export interface ReviewedExceptions {
  /** Items allowed to share an external URL, with the reason. */
  sharedLinkGroups?: { ids: number[]; reason: string }[];
  /** `${id}:${platform}` -> note, for exact links whose slug differs from the title. */
  reviewedEquivalents?: Record<string, string>;
}

export interface ValidationIssue {
  check: string;
  message: string;
  ids?: number[];
}

export interface ValidationCounts {
  duplicateIds: number;
  duplicateOrders: number;
  missingOrders: number;
  duplicateTitles: number;
  unknownTopics: number;
  missingFields: number;
  invalidUrls: number;
  undocumentedDuplicateUrls: number;
  classificationProblems: number;
  invalidArticleUrls: number;
}

export interface ValidationReport {
  total: number;
  practice: number;
  theoryItems: number;
  ok: boolean;
  counts: ValidationCounts;
  checks: { name: string; passed: boolean; detail?: string }[];
  issues: ValidationIssue[];
  byTopic: { id: string; name: string; count: number }[];
  links: {
    leetcode: number;
    gfg: number;
    code360: number;
    other: number;
    relatedLeetcode: number;
    relatedGfg: number;
    articles: number;
  };
  withoutAnyPlatform: { id: number; order: number; title: string }[];
  withoutPlatformOrArticle: { id: number; order: number; title: string }[];
  withoutArticle: number;
}

const HOST_RULES: Record<string, RegExp> = {
  leetcode: /^https:\/\/leetcode\.com\/problems\/[a-z0-9-]+\/$/,
  gfg: /^https:\/\/www\.geeksforgeeks\.org\/problems\/[a-z0-9-]+\/\d+$/,
  code360: /^https:\/\/www\.naukri\.com\/code360\/problems\/[a-z0-9-]+(?:_\d+)?$/,
  // practice pages only — lessons/articles belong in `article`
  other:
    /^https:\/\/(?:takeuforward\.org\/practice\/dsa\/\S+|www\.interviewbit\.com\/problems\/\S+|www\.hackerrank\.com\/challenges\/\S+|www\.spoj\.com\/problems\/\S+)$/,
};
const ARTICLE_RULE =
  /^https:\/\/takeuforward\.org\/(?!practice\/)(?:blogs\/data-structure-and-algorithm\/[a-z0-9-]+|learning\/dsa\/[a-z0-9-]+(?:\?category=[a-z0-9-]+)?|[a-z0-9-]+\/[a-z0-9-]+\/?)$/;

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const STOP = new Set(
  "a an the of in to and or is by from with using for on ll bt dp i ii iii iv problem array given".split(" ")
);
function tokens(s: string): Set<string> {
  const words = s.toLowerCase().replace(/'/g, "").match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => !STOP.has(w) && !/^dp\d*$/.test(w) && !/^\d+$/.test(w)));
}
function slugOf(url: string): string {
  const m = url.match(/\/problems\/([^/?#]+)/);
  return m ? m[1].replace(/\d{6,}|\d{3,}$/g, "") : "";
}
/** Share of the platform slug's words that also appear in the sheet title (0..1). */
export function titleSlugSimilarity(title: string, url: string): number {
  const t = tokens(title);
  const s = tokens(slugOf(url).replace(/-/g, " "));
  if (s.size === 0) return 1;
  let hit = 0;
  s.forEach((w) => {
    if (t.has(w)) hit++;
  });
  return hit / s.size;
}

export function validateDataset(
  problems: ValidatableProblem[],
  topics: ValidatableTopic[],
  reviewed: ReviewedExceptions = {},
  /** Server-only article URLs (data/articles.ts). Omitted in the browser, where article URLs are Pro-only. */
  articles?: Readonly<Record<number, { url: string; source: string }>>
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const checks: ValidationReport["checks"] = [];
  const add = (name: string, bad: ValidationIssue | null, detail?: string) => {
    checks.push({ name, passed: !bad, detail });
    if (bad) issues.push(bad);
  };

  // --- required fields --------------------------------------------------------
  const missingFields = problems.filter(
    (p) =>
      !Number.isInteger(p.id) ||
      !Number.isInteger(p.order) ||
      typeof p.title !== "string" ||
      !p.title.trim() ||
      typeof p.topic !== "string" ||
      !p.topic ||
      !["Easy", "Medium", "Hard"].includes(p.difficulty) ||
      (p.kind !== undefined && p.kind !== "practice" && p.kind !== "theory") ||
      typeof p.platforms !== "object" ||
      p.platforms === null ||
      (p.tags !== undefined && !Array.isArray(p.tags))
  );
  add(
    "Required fields present (id, order, title, topic, difficulty, type)",
    missingFields.length
      ? { check: "fields", message: "Missing/invalid required fields", ids: missingFields.map((p) => p.id) }
      : null
  );

  // --- duplicate ids -----------------------------------------------------------
  const seenIds = new Map<number, number>();
  for (const p of problems) seenIds.set(p.id, (seenIds.get(p.id) ?? 0) + 1);
  const dupIds = Array.from(seenIds).filter(([, n]) => n > 1).map(([id]) => id);
  add("No duplicate IDs", dupIds.length ? { check: "ids", message: `Duplicate ids: ${dupIds.join(", ")}`, ids: dupIds } : null);

  // --- duplicate / missing order numbers --------------------------------------
  const seenOrder = new Map<number, number[]>();
  for (const p of problems) seenOrder.set(p.order, [...(seenOrder.get(p.order) ?? []), p.id]);
  const dupOrders = Array.from(seenOrder).filter(([, ids]) => ids.length > 1);
  add(
    "No duplicate order numbers",
    dupOrders.length ? { check: "order", message: `Duplicate order numbers: ${dupOrders.map(([o]) => o).join(", ")}` } : null
  );
  const orders = new Set(problems.map((p) => p.order));
  const missing: number[] = [];
  for (let i = 1; i <= problems.length; i++) if (!orders.has(i)) missing.push(i);
  const outOfRange = problems.filter((p) => !Number.isInteger(p.order) || p.order < 1 || p.order > problems.length);
  add(
    "No missing order numbers (1..N)",
    missing.length || outOfRange.length
      ? {
          check: "order",
          message: `Missing: ${missing.slice(0, 20).join(", ") || "none"}; out of range: ${outOfRange.map((p) => p.id).join(", ") || "none"}`,
          ids: outOfRange.map((p) => p.id),
        }
      : null
  );
  const outOfSequence = problems.filter((p, i) => i > 0 && p.order < problems[i - 1].order).map((p) => p.id);
  add(
    "Problems listed in roadmap order",
    outOfSequence.length ? { check: "order", message: "Array is not sorted by order", ids: outOfSequence } : null
  );

  // --- duplicate titles ---------------------------------------------------------
  const titles = new Map<string, number[]>();
  for (const p of problems) {
    const key = (p.title ?? "").trim().toLowerCase();
    titles.set(key, [...(titles.get(key) ?? []), p.id]);
  }
  const dupTitles = Array.from(titles).filter(([, ids]) => ids.length > 1);
  add(
    "No duplicate titles",
    dupTitles.length
      ? { check: "titles", message: `Duplicate titles: ${dupTitles.map(([t]) => `"${t}"`).join(", ")}`, ids: dupTitles.flatMap(([, ids]) => ids) }
      : null
  );

  // --- topics ---------------------------------------------------------------------
  const topicIds = new Set(topics.map((t) => t.id));
  const unknownTopic = problems.filter((p) => !topicIds.has(p.topic));
  add(
    "No unknown topics",
    unknownTopic.length ? { check: "topics", message: "Unknown topic ids", ids: unknownTopic.map((p) => p.id) } : null
  );
  const emptyTopics = topics.filter((t) => !problems.some((p) => p.topic === t.id));
  add(
    "All topics present (each has at least one problem)",
    emptyTopics.length ? { check: "topics", message: `Topics with no problems: ${emptyTopics.map((t) => t.name).join(", ")}` } : null
  );

  // --- URL format -------------------------------------------------------------------
  const urlMessages: string[] = [];
  const urlBad: number[] = [];
  const links = { leetcode: 0, gfg: 0, code360: 0, other: 0, relatedLeetcode: 0, relatedGfg: 0, articles: 0 };
  for (const p of problems) {
    for (const key of ["leetcode", "gfg", "code360", "other"] as const) {
      const url = p.platforms?.[key];
      if (url === undefined) continue;
      links[key]++;
      if (!isHttpsUrl(url) || !HOST_RULES[key].test(url)) {
        urlBad.push(p.id);
        urlMessages.push(`#${p.order} ${key}: ${url}`);
      }
    }
    if (p.platforms?.other && !p.otherLabel) {
      urlBad.push(p.id);
      urlMessages.push(`#${p.order} "other" link has no otherLabel`);
    }
    for (const r of p.related ?? []) {
      if (r.platform === "leetcode") links.relatedLeetcode++;
      if (r.platform === "gfg") links.relatedGfg++;
      const rule = HOST_RULES[r.platform];
      if (!isHttpsUrl(r.url) || !rule || !rule.test(r.url)) {
        urlBad.push(p.id);
        urlMessages.push(`#${p.order} related ${r.platform}: ${r.url}`);
      }
    }
  }
  add(
    "Valid URL format on the right host (platform + related links)",
    urlBad.length ? { check: "urls", message: urlMessages.slice(0, 15).join("\n"), ids: urlBad } : null
  );

  // --- articles -------------------------------------------------------------------------
  const articleBad: number[] = [];
  const articleMessages: string[] = [];
  for (const p of problems) {
    if (!p.article) continue;
    links.articles++;
    const art = articles ? articles[p.id] : p.article.url ? { url: p.article.url, source: p.article.source } : undefined;
    if (!art) {
      // In the browser only the "has an article" flag exists (URLs are Pro-only), so skip.
      if (!articles) continue;
      articleBad.push(p.id);
      articleMessages.push(`#${p.order} article flagged in the dataset but missing from data/articles.ts`);
      continue;
    }
    if (!isHttpsUrl(art.url) || !ARTICLE_RULE.test(art.url) || !art.source || art.source !== p.article.source) {
      articleBad.push(p.id);
      articleMessages.push(`#${p.order} article: ${art.url}`);
    }
    if (Object.values(p.platforms ?? {}).includes(art.url)) {
      articleBad.push(p.id);
      articleMessages.push(`#${p.order} article URL is also used as a Solve link`);
    }
  }
  if (articles) {
    const flagged = new Set(problems.filter((p) => p.article).map((p) => p.id));
    for (const id of Object.keys(articles).map(Number)) {
      if (!flagged.has(id)) {
        articleBad.push(id);
        articleMessages.push(`data/articles.ts has an article for id ${id}, which the dataset doesn't flag`);
      }
    }
  }
  add(
    "Valid article URLs (TakeUForward lesson/blog pages, never a practice page)",
    articleBad.length ? { check: "articles", message: articleMessages.slice(0, 15).join("\n"), ids: articleBad } : null
  );
  const withoutArticle = problems.filter((p) => !p.article).length;
  checks.push({
    name: "Missing article URL",
    passed: true,
    detail: `${withoutArticle} items have no verified article (the Read Article button is hidden for them)`,
  });

  // --- duplicate external URLs must be documented ---------------------------------------
  const byUrl = new Map<string, number[]>();
  for (const p of problems) {
    for (const url of Object.values(p.platforms ?? {})) {
      if (url) byUrl.set(url, [...(byUrl.get(url) ?? []), p.id]);
    }
  }
  const groups = reviewed.sharedLinkGroups ?? [];
  const undocumented = Array.from(byUrl)
    .filter(([, ids]) => ids.length > 1)
    .filter(([, ids]) => !groups.some((g) => ids.every((id) => g.ids.includes(id))));
  add(
    "No undocumented duplicate external URLs",
    undocumented.length
      ? {
          check: "duplicate-urls",
          message: undocumented.map(([u, ids]) => `${u} used by ${ids.join(", ")}`).slice(0, 15).join("\n"),
          ids: undocumented.flatMap(([, ids]) => ids),
        }
      : null,
    `${Array.from(byUrl).filter(([, ids]) => ids.length > 1).length} shared URLs, all in reviewed groups`
  );

  // --- exact vs related classification -----------------------------------------------------
  const classMessages: string[] = [];
  const classBad: number[] = [];
  const equivalents = reviewed.reviewedEquivalents ?? {};
  for (const p of problems) {
    const exact = new Set(Object.values(p.platforms ?? {}).filter(Boolean));
    for (const r of p.related ?? []) {
      if (exact.has(r.url)) {
        classBad.push(p.id);
        classMessages.push(`#${p.order} ${r.url} is both exact and related`);
      }
    }
    for (const key of ["leetcode", "gfg"] as const) {
      const url = p.platforms?.[key];
      if (!url) continue;
      if (titleSlugSimilarity(p.title, url) < 0.5 && !equivalents[`${p.id}:${key}`]) {
        classBad.push(p.id);
        classMessages.push(`#${p.order} "${p.title}" -> ${url} looks different; review it and add to REVIEWED_EQUIVALENTS or move it to related`);
      }
    }
  }
  add(
    "Exact/related classification consistent (look-alike links reviewed)",
    classBad.length ? { check: "classification", message: classMessages.slice(0, 15).join("\n"), ids: classBad } : null,
    `${Object.keys(equivalents).length} reviewed look-alike exact links`
  );

  // --- summaries ------------------------------------------------------------------------------
  const withoutAnyPlatform = problems
    .filter((p) => !p.platforms?.leetcode && !p.platforms?.gfg && !p.platforms?.code360 && !p.platforms?.other)
    .map((p) => ({ id: p.id, order: p.order, title: p.title }));
  const withoutPlatformOrArticle = withoutAnyPlatform.filter((x) => !problems.find((p) => p.id === x.id)?.article);
  checks.push({
    name: "Problems without any practice link",
    passed: true,
    detail: `${withoutAnyPlatform.length} (${withoutAnyPlatform.length - withoutPlatformOrArticle.length} of them have an article; left empty rather than guessed)`,
  });

  const byTopic = topics.map((t) => ({ id: t.id, name: t.name, count: problems.filter((p) => p.topic === t.id).length }));
  checks.push({
    name: "Problem count by topic",
    passed: byTopic.reduce((s, t) => s + t.count, 0) === problems.length,
    detail: byTopic.map((t) => `${t.name} ${t.count}`).join(", "),
  });

  const theoryItems = problems.filter((p) => p.kind === "theory").length;
  return {
    total: problems.length,
    practice: problems.length - theoryItems,
    theoryItems,
    ok: issues.length === 0,
    counts: {
      duplicateIds: dupIds.length,
      duplicateOrders: dupOrders.length,
      missingOrders: missing.length + outOfRange.length,
      duplicateTitles: dupTitles.length,
      unknownTopics: unknownTopic.length,
      missingFields: missingFields.length,
      invalidUrls: urlMessages.length,
      undocumentedDuplicateUrls: undocumented.length,
      classificationProblems: classMessages.length,
      invalidArticleUrls: articleMessages.length,
    },
    checks,
    issues,
    byTopic,
    links,
    withoutAnyPlatform,
    withoutPlatformOrArticle,
    withoutArticle,
  };
}

/** Plain-text report in the format printed by `npm run validate:data`. */
export function formatReport(r: ValidationReport): string {
  const line = "==============================";
  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
  const out: string[] = [
    line,
    "A2Z DATASET REPORT",
    line,
    "",
    `Total entries: ${r.total}`,
    `Coding problems: ${r.practice}`,
    `Theory/Lesson entries: ${r.theoryItems}`,
    "",
  ];
  for (const t of r.byTopic) out.push(`${pad(t.name + ":", 30)}${t.count}`);
  out.push("");
  out.push(`Exact LeetCode links: ${r.links.leetcode}`);
  out.push(`Related LeetCode links: ${r.links.relatedLeetcode}`);
  out.push(`Exact GFG links: ${r.links.gfg}`);
  out.push(`Related GFG links: ${r.links.relatedGfg}`);
  out.push(`Code360 links: ${r.links.code360}`);
  out.push(`TakeUForward/other practice links: ${r.links.other}`);
  out.push(`Articles: ${r.links.articles}`);
  out.push(`No practice link: ${r.withoutAnyPlatform.length}`);
  out.push(`No practice link and no article: ${r.withoutPlatformOrArticle.length}`);
  out.push("");
  out.push(`Duplicate IDs: ${r.counts.duplicateIds}`);
  out.push(`Duplicate order numbers: ${r.counts.duplicateOrders}`);
  out.push(`Missing order numbers: ${r.counts.missingOrders}`);
  out.push(`Duplicate titles: ${r.counts.duplicateTitles}`);
  out.push(`Unknown topics: ${r.counts.unknownTopics}`);
  out.push(`Missing required fields: ${r.counts.missingFields}`);
  out.push(`Invalid URLs: ${r.counts.invalidUrls}`);
  out.push(`Invalid article URLs: ${r.counts.invalidArticleUrls}`);
  out.push(`Undocumented duplicate URLs: ${r.counts.undocumentedDuplicateUrls}`);
  out.push(`Exact/related classification problems: ${r.counts.classificationProblems}`);
  out.push("");
  for (const c of r.checks) out.push(`${c.passed ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  if (r.issues.length) {
    out.push("", "ISSUES:");
    for (const i of r.issues) out.push(`- [${i.check}] ${i.message}`);
  }
  if (r.withoutPlatformOrArticle.length) {
    out.push("", "No verified practice link or article (intentionally left empty):");
    for (const p of r.withoutPlatformOrArticle) out.push(`  #${p.order} ${p.title}`);
  }
  out.push("", `RESULT: ${r.ok ? "PASS" : "FAIL"}`, line);
  return out.join("\n");
}

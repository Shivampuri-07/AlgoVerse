import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLATFORM_LABELS, PLATFORM_PRIORITY, platformLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Problem, ProblemArticle } from "@/lib/types";

const PLATFORM_STYLES: Record<string, string> = {
  leetcode: "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400",
  gfg: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400",
  code360: "border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-400",
  other: "border-border bg-muted text-foreground hover:bg-accent",
};

/**
 * One "Solve on X" button per platform that actually has a URL, in priority order.
 * Never fabricates a link — a platform with no URL is simply omitted here;
 * see <PlatformAvailability> for the explicit "Not available" list.
 */
export function PlatformLinks({
  problem,
  size = "default",
}: {
  problem: Pick<Problem, "platforms" | "otherLabel" | "title">;
  size?: "default" | "sm";
}) {
  const entries = PLATFORM_PRIORITY.map((key) => [key, problem.platforms[key]] as const).filter(
    ([, url]) => Boolean(url)
  );

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No verified practice link for this item. Add one in <code className="rounded bg-muted px-1">data/a2zProblems.ts</code>.
      </p>
    );
  }

  return (
    <div className="contents">
      {entries.map(([key, url]) => (
        <Button
          key={key}
          asChild
          variant="outline"
          size={size === "sm" ? "sm" : "default"}
          className={cn("border", PLATFORM_STYLES[key] ?? PLATFORM_STYLES.other)}
        >
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Solve ${problem.title} on ${platformLabel(problem, key)} (opens in new tab)`}
          >
            Solve on {platformLabel(problem, key)}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      ))}
    </div>
  );
}

/** Explicit availability list, e.g. "LeetCode: Not available", per platform. */
export function PlatformAvailability({ problem }: { problem: Pick<Problem, "platforms" | "otherLabel"> }) {
  const keys = ["leetcode", "gfg", "code360"] as const;
  const rows: { label: string; url?: string }[] = keys.map((key) => ({
    label: PLATFORM_LABELS[key],
    url: problem.platforms[key],
  }));
  if (problem.platforms.other) {
    rows.push({ label: platformLabel(problem, "other"), url: problem.platforms.other });
  }
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{row.label}</span>
          {row.url ? (
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-muted-foreground/70">Not available</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * "Article" — the problem has a verified explanation article (Pro). The URL isn't in the page
 * data: this opens the problem's Learning resources section, where Pro users get the link from
 * the server and Free users see the upgrade prompt. Renders nothing when there's no article.
 */
export function ArticleButton({
  problemId,
  article,
  title,
  size = "default",
  compact = false,
}: {
  problemId: number;
  article?: ProblemArticle;
  title: string;
  size?: "default" | "sm" | "icon";
  compact?: boolean;
}) {
  if (!article) return null;
  return (
    <Button asChild variant="outline" size={size}>
      <Link
        href={`/problems/${problemId}#learning-resources`}
        aria-label={`Explanation article for ${title} (${article.source}) — Pro`}
        title={`Article (${article.source}) — Pro`}
      >
        <BookOpen className="h-4 w-4" />
        {!compact && (
          <>
            Article
            <span className="rounded bg-primary/10 px-1 text-[10px] font-semibold uppercase text-primary">Pro</span>
          </>
        )}
      </Link>
    </Button>
  );
}

/** Solve buttons for every verified platform, followed by the Read Article button. */
export function ProblemActions({ problem }: { problem: Problem }) {
  const hasSolve = PLATFORM_PRIORITY.some((key) => problem.platforms[key]);
  return (
    <div className="space-y-2">
      {hasSolve ? (
        <div className="flex flex-wrap gap-2">
          <PlatformLinks problem={problem} />
          <ArticleButton problemId={problem.id} article={problem.article} title={problem.title} />
        </div>
      ) : (
        <div className="space-y-2">
          <PlatformLinks problem={problem} />
          <ArticleButton problemId={problem.id} article={problem.article} title={problem.title} />
        </div>
      )}
    </div>
  );
}

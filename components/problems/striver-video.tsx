"use client";

import * as React from "react";
import { BookOpen, ExternalLink, Loader2, Lock, Sparkles, Youtube } from "lucide-react";
import { useSyncSetup } from "@/components/sync/sync-provider";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { striverVideoTitle } from "@/lib/video-index";
import type { Problem } from "@/lib/types";

/** Shape returned by GET /api/resources/[id] (lib/resources.ts). */
interface LearningResources {
  video: { title: string; watchUrl: string; startsAt: string | null } | null;
  article: { url: string; source: string } | null;
}

type LoadState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; data: LearningResources } | { kind: "locked" } | { kind: "error" };

/**
 * "Learning resources" on a problem page: Striver's video explanation and the explanation article.
 * Both are Pro. The links never ship to the browser in the page data: Pro users get them from
 * GET /api/resources/[id], which checks the session and the server-side entitlement. Everyone
 * can see that a resource exists (and the video's title); Free users get an upgrade prompt.
 * No embedded YouTube player: videos open on YouTube (owner decision; YouTube policy III.F.3).
 * The problem itself, its practice links, progress and notes stay free.
 */
export function StriverVideo({ problem }: { problem: Pick<Problem, "id" | "title" | "article"> }) {
  const { entitlements } = useSyncSetup();
  const isPro = entitlements?.features.learningResources === true;
  const videoTitle = striverVideoTitle(problem.id);
  const articleSource = problem.article?.source ?? null;
  const [state, setState] = React.useState<LoadState>({ kind: "idle" });
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);
  const [upgradeReason, setUpgradeReason] = React.useState("");
  const headingId = `learning-resources-${problem.id}`;

  React.useEffect(() => {
    if (!isPro || (!videoTitle && !articleSource)) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/resources/${problem.id}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) return setState({ kind: "locked" });
        if (!res.ok) return setState({ kind: "error" });
        setState({ kind: "ready", data: (await res.json()) as LearningResources });
      })
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [isPro, problem.id, videoTitle, articleSource]);

  const unlocked = isPro && state.kind !== "locked";
  const openUpgrade = (reason: string) => {
    setUpgradeReason(reason);
    setUpgradeOpen(true);
  };

  return (
    <Card aria-labelledby={headingId} id="learning-resources">
      <CardHeader className="pb-3">
        <CardTitle id={headingId} className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          Learning resources
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Pro</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!videoTitle && !articleSource ? (
          <p className="text-sm text-muted-foreground">No verified video or article for this problem yet.</p>
        ) : (
          <>
            {videoTitle && (
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Youtube className="h-4 w-4 shrink-0 text-red-600 dark:text-red-500" aria-hidden="true" />
                    Striver&apos;s video explanation
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={videoTitle} data-testid="video-title">
                    {videoTitle}
                    {state.kind === "ready" && state.data.video?.startsAt ? ` · from ${state.data.video.startsAt}` : ""}
                  </p>
                </div>
                {unlocked && state.kind === "ready" && state.data.video ? (
                  <Button asChild size="sm" className="shrink-0">
                    <a
                      href={state.data.video.watchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Watch Striver's explanation of ${problem.title} on YouTube (opens in new tab)`}
                      data-testid="watch-video"
                    >
                      Watch on YouTube
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                ) : unlocked && state.kind === "loading" ? (
                  <Button size="sm" disabled className="shrink-0">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    data-testid="locked-video"
                    onClick={() => openUpgrade("Striver's video explanations are part of AlgoVerse Pro.")}
                  >
                    <Lock className="h-3.5 w-3.5" /> Watch — Pro
                  </Button>
                )}
              </div>
            )}
            {articleSource && (
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Explanation article <span className="font-normal text-muted-foreground">({articleSource})</span>
                </p>
                {unlocked && state.kind === "ready" && state.data.article ? (
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <a
                      href={state.data.article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Read the ${state.data.article.source} article for ${problem.title} (opens in new tab)`}
                      data-testid="read-article"
                    >
                      Read article
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                ) : unlocked && state.kind === "loading" ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    data-testid="locked-article"
                    onClick={() => openUpgrade("Articles are part of AlgoVerse Pro.")}
                  >
                    <Lock className="h-3.5 w-3.5" /> Read — Pro
                  </Button>
                )}
              </div>
            )}
            {state.kind === "error" && (
              <p className="text-sm text-muted-foreground">Couldn&apos;t load the links right now. Check your connection and reload.</p>
            )}
            {!unlocked && (
              <p className="text-xs text-muted-foreground">All 455 problems stay free — Pro adds articles, videos and cloud sync.</p>
            )}
          </>
        )}
      </CardContent>
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} reason={upgradeReason} />
    </Card>
  );
}

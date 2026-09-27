"use client";

import * as React from "react";
import { AlertTriangle, BookOpen, ExternalLink, Loader2, PlayCircle, Youtube } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatTimestamp, getStriverVideo, youtubeEmbedUrl, youtubeWatchUrl } from "@/lib/videos";
import { cn } from "@/lib/utils";
import type { Problem } from "@/lib/types";

/** How long the embedded player may take before we offer the YouTube link instead. */
const LOAD_TIMEOUT_MS = 15_000;

type PlayerState = "idle" | "loading" | "ready" | "failed" | "offline";

/**
 * "Striver's Video Explanation" on a problem page.
 *
 * Nothing is requested from YouTube until the viewer clicks "Load video": no iframe, no
 * thumbnail, no script. Then the official embed (privacy-enhanced youtube-nocookie.com) is
 * inserted without autoplay. Problems without a verified mapping get a plain message — never
 * a guessed or unrelated video.
 */
export function StriverVideo({ problem }: { problem: Pick<Problem, "id" | "title" | "article"> }) {
  const video = getStriverVideo(problem.id);
  const headingId = `striver-video-${problem.id}`;

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader className="pb-3">
        <CardTitle id={headingId} className="flex items-center gap-2 text-base">
          <Youtube className="h-4 w-4 text-red-600 dark:text-red-500" aria-hidden="true" />
          Striver&apos;s Video Explanation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {video ? (
          <VideoPlayer video={video} problemTitle={problem.title} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Striver&apos;s video explanation is not available for this problem yet.
            </p>
            {problem.article && (
              <Button asChild variant="outline" size="sm">
                <a
                  href={problem.article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Read the ${problem.article.source} article for ${problem.title} (opens in new tab)`}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Read the {problem.article.source} article
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VideoPlayer({
  video,
  problemTitle,
}: {
  video: NonNullable<ReturnType<typeof getStriverVideo>>;
  problemTitle: string;
}) {
  const [state, setState] = React.useState<PlayerState>("idle");
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>();
  const watchUrl = youtubeWatchUrl(video);
  const embeddable = video.embeddable !== false;
  const iframeTitle = `Striver's video explanation for ${problemTitle}: ${video.title} (YouTube)`;

  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  const load = () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState("offline");
      return;
    }
    setState("loading");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState((s) => (s === "loading" ? "failed" : s)), LOAD_TIMEOUT_MS);
  };

  const showFrame = embeddable && (state === "loading" || state === "ready");

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg border border-border bg-muted",
          // The player is always 16:9. The placeholder may grow on narrow phones so its text never clips.
          showFrame ? "aspect-video" : "flex min-h-40 items-center justify-center p-4 sm:aspect-video"
        )}
      >
        {showFrame ? (
          <>
            <iframe
              src={youtubeEmbedUrl(video)}
              title={iframeTitle}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              loading="lazy"
              onLoad={() => {
                clearTimeout(timerRef.current);
                setState("ready");
              }}
            />
            {state === "loading" && (
              <div
                role="status"
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-sm text-muted-foreground"
              >
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                Loading the YouTube player…
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            {state === "failed" || state === "offline" ? (
              <div role="alert" className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-6 w-6 text-warning" aria-hidden="true" />
                <p>
                  {state === "offline"
                    ? "You're offline — the video needs an internet connection."
                    : "The video player didn't load. You can watch it on YouTube instead."}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={load}>
                  Try again
                </Button>
              </div>
            ) : embeddable ? (
              <>
                <p className="line-clamp-2 max-w-md text-sm font-medium">{video.title}</p>
                <Button type="button" onClick={load} aria-label={`Load the YouTube player for "${video.title}"`}>
                  <PlayCircle className="h-4 w-4" aria-hidden="true" />
                  Load video
                </Button>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Nothing is loaded from YouTube until you click. The video won&apos;t start by itself.
                </p>
              </>
            ) : (
              <>
                <p className="line-clamp-2 max-w-md text-sm font-medium">{video.title}</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  This video can&apos;t be embedded here — watch it on YouTube.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {video.start ? <>Starts at {formatTimestamp(video.start)} · </> : null}
          Video by take U forward (Striver) on YouTube. AlgoVerse isn&apos;t affiliated with Take U Forward.
        </p>
        <Button asChild variant="outline" size="sm">
          <a href={watchUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open "${video.title}" on YouTube (opens in new tab)`}>
            Open on YouTube
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </div>
  );
}

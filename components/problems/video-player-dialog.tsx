"use client";

import * as React from "react";
import { ArrowLeft, ExternalLink, Loader2, VideoOff, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isEmbeddingBlocked, loadYouTubeIframeApi, type YTPlayer } from "@/lib/youtube-player";

export interface PlayableVideo {
  title: string;
  watchUrl: string;
  startsAt: string | null;
  embed: { videoId: string; start: number | null; embeddable: boolean };
}

type PlayerState = "loading" | "ready" | "blocked" | "error" | "offline";

const READY_TIMEOUT_MS = 15_000;

/**
 * "Watch in AlgoVerse" (Pro): the official YouTube player in a modal on the problem page.
 * - The video id comes from the authorised /api/resources response (never from page data).
 * - Official IFrame Player API on the privacy-enhanced host; YouTube's controls, branding, ads and
 *   fullscreen are untouched; no autoplay (the viewer presses play).
 * - Embedding disabled by the creator (player errors 101/150) or not loading → a friendly message
 *   with the "Watch on YouTube" link. Never a workaround.
 * - Closing (button, X or Escape) returns focus to the problem page; nothing on the page is reset.
 */
export function VideoPlayerDialog({
  open,
  onOpenChange,
  problemTitle,
  video,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  problemTitle: string;
  video: PlayableVideo;
  /** Element that gets focus back when the player closes (the button that opened it). */
  returnFocusRef?: React.RefObject<HTMLElement>;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<PlayerState>("loading");

  React.useEffect(() => {
    if (!open) return;
    if (!video.embed.embeddable) {
      setState("blocked");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState("offline");
      return;
    }
    setState("loading");
    let cancelled = false;
    let player: YTPlayer | null = null;
    let host: HTMLDivElement | null = null; // the element the player was mounted in
    const timer = setTimeout(() => !cancelled && setState((s) => (s === "loading" ? "error" : s)), READY_TIMEOUT_MS);

    // The dialog content mounts on the next frame; wait for the container.
    const frame = requestAnimationFrame(() => {
      loadYouTubeIframeApi()
        .then((YT) => {
          if (cancelled || !containerRef.current) return;
          host = containerRef.current;
          const mount = document.createElement("div");
          host.replaceChildren(mount);
          player = new YT.Player(mount, {
            host: "https://www.youtube-nocookie.com",
            videoId: video.embed.videoId,
            width: "100%",
            height: "100%",
            playerVars: {
              autoplay: 0,
              rel: 0,
              playsinline: 1,
              origin: window.location.origin,
              ...(video.embed.start ? { start: video.embed.start } : {}),
            },
            events: {
              onReady: (e) => {
                if (cancelled) return;
                clearTimeout(timer);
                const iframe = e.target.getIframe();
                iframe.title = `Striver's video explanation for ${problemTitle}: ${video.title} (YouTube)`;
                iframe.setAttribute("allowfullscreen", "");
                setState("ready");
              },
              onError: (e) => {
                if (cancelled) return;
                clearTimeout(timer);
                setState(isEmbeddingBlocked(e.data) ? "blocked" : "error");
              },
            },
          });
        })
        .catch(() => {
          if (cancelled) return;
          clearTimeout(timer);
          setState(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
        });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      try {
        player?.destroy();
      } catch {
        /* already gone */
      }
      host?.replaceChildren();
    };
  }, [open, video.embed.videoId, video.embed.start, video.embed.embeddable, video.title, problemTitle]);

  const message =
    state === "blocked"
      ? "This video can't be played inside AlgoVerse — its owner allows it to be watched on YouTube only."
      : state === "offline"
        ? "You're offline. Connect to the internet to watch the video."
        : state === "error"
          ? "The player didn't load. You can still watch the video on YouTube."
          : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl gap-3 p-4 sm:p-6"
        data-testid="video-player-dialog"
        onCloseAutoFocus={(e) => {
          if (returnFocusRef?.current) {
            e.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base sm:text-lg">{problemTitle}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <Youtube className="h-4 w-4 shrink-0 text-red-600 dark:text-red-500" aria-hidden="true" />
            <span className="truncate" title={video.title}>
              {video.title}
              {video.startsAt ? ` · from ${video.startsAt}` : ""}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
          <div ref={containerRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" data-testid="player-container" />
          {state === "loading" && (
            <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
              <Loader2 className="h-6 w-6 animate-spin" />
              Loading the YouTube player…
            </div>
          )}
          {message && (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-4 text-center text-sm" data-testid="player-message">
              <VideoOff className="h-6 w-6 text-muted-foreground" />
              <p className="max-w-sm">{message}</p>
              <Button asChild size="sm">
                <a href={video.watchUrl} target="_blank" rel="noopener noreferrer">
                  Watch on YouTube <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <DialogClose asChild>
            <Button variant="outline" data-testid="close-player">
              <ArrowLeft className="h-4 w-4" />
              Back to problem
            </Button>
          </DialogClose>
          <Button asChild variant="ghost">
            <a href={video.watchUrl} target="_blank" rel="noopener noreferrer" aria-label={`Watch ${video.title} on YouTube (opens in new tab)`}>
              Watch on YouTube <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

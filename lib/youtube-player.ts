/**
 * Loads YouTube's official IFrame Player API (https://www.youtube.com/iframe_api) once.
 * Used by the Pro in-app player: the official player keeps YouTube's controls, branding,
 * ads and fullscreen; nothing is proxied, downloaded or extracted. The video id it plays comes
 * only from the authorised GET /api/resources/[id] response.
 */

/** The small part of the official API this app uses. */
export interface YTPlayer {
  destroy(): void;
  getIframe(): HTMLIFrameElement;
}

export interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      host?: string;
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onError?: (e: { data: number; target: YTPlayer }) => void;
      };
    }
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = "https://www.youtube.com/iframe_api";
let loading: Promise<YTNamespace> | null = null;

export function loadYouTubeIframeApi(timeoutMs = 15_000): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no_window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => {
      loading = null;
      reject(new Error("timeout"));
    }, timeoutMs);
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else {
        loading = null;
        reject(new Error("unavailable"));
      }
    };
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      loading = null;
      script.remove();
      reject(new Error("load_failed"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Official player error codes: 2 invalid parameter, 5 HTML5 player error, 100 not found/private,
 * 101 and 150 embedding disabled by the owner.
 */
export function isEmbeddingBlocked(code: number): boolean {
  return code === 101 || code === 150;
}

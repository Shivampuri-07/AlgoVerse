import type { MetadataRoute } from "next";
import { APP_NAME, APP_SHORT_DESCRIPTION } from "@/lib/constants";

/** Web App Manifest, served by Next.js at /manifest.webmanifest and linked from every page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_SHORT_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Brand indigo for the title bar; the splash screen uses the dark app background.
    theme_color: "#4F5BF5",
    background_color: "#0B0E14",
    lang: "en",
    dir: "ltr",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "All problems",
        short_name: "Problems",
        url: "/problems",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Bookmarks",
        short_name: "Bookmarks",
        url: "/bookmarks",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}

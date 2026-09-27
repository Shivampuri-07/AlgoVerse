import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
import { firebaseEnvReport } from "./scripts/firebase-env-report.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Separate build folder for scripts/mac-verify.command (NEXT_DIST_DIR=.next-verify), so a
  // verification build never overwrites the .next folder a running `npm run dev` is using.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Gemini SDK and the Firebase Admin SDK are server-only; load them from node_modules
  // instead of bundling them (they pull in Node-only auth/gRPC/websocket libraries).
  serverExternalPackages: ["@google/genai", "firebase-admin"],
  // Next.js 15 streams page metadata into <body> for regular browsers. iOS only reads the
  // apple-mobile-web-app-* tags (and some browsers the manifest link) from <head>, so render
  // metadata up front for every user agent.
  htmlLimitedBots: /.*/,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Always fetch the newest service worker so updates roll out on the next visit.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default function config(phase) {
  // Build log line: which Firebase settings this build can see (names/booleans only).
  // Next.js loads this file in several build workers; print once (workers inherit the marker).
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.__ALGOVERSE_ENV_REPORTED) {
    process.env.__ALGOVERSE_ENV_REPORTED = "1";
    console.log(firebaseEnvReport());
  }
  return nextConfig;
}

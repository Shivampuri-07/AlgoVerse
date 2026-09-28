// Fails if a server-only secret (or the Admin SDK itself) ended up in the browser bundle.
// Scans every file under <distDir>/static — what browsers download — for:
//   - the actual values of server secrets from the environment / .env.local (never printed)
//   - private-key / service-account markers and the Admin SDK
// Run after `npm run build`: npm run check:secrets
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const staticDir = join(distDir, "static");
if (!existsSync(staticDir)) {
  console.error(`No ${staticDir} folder — run \`npm run build\` first.`);
  process.exit(2);
}

function envFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...envFile(".env.local"), ...process.env };

const SECRET_NAMES = ["GEMINI_API_KEY", "FIREBASE_SERVICE_ACCOUNT_KEY", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
const needles = [];
for (const name of SECRET_NAMES) {
  const value = env[name]?.trim();
  if (!value || value.length < 12) continue;
  needles.push({ label: `value of ${name}`, text: value.slice(0, 40) });
  if (name === "FIREBASE_SERVICE_ACCOUNT_KEY") {
    try {
      const json = JSON.parse(value.startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8"));
      const key = String(json.private_key ?? "").replace(/\\n/g, "\n").split("\n").find((l) => l.length > 40);
      if (key) needles.push({ label: "service-account private key", text: key.slice(0, 40) });
    } catch {
      /* not JSON */
    }
  }
}
// Pro-only learning resources must never ship to the browser (served by GET /api/resources/[id]).
const proResources = [];
try {
  const articles = readFileSync("data/articles.ts", "utf8");
  for (const m of articles.matchAll(/url: "([^"]+)"/g)) proResources.push({ label: "Pro-only article URL", text: m[1] });
  const videos = readFileSync("data/striverVideos.ts", "utf8");
  for (const m of videos.matchAll(/videoId: "([A-Za-z0-9_-]{11})"/g)) proResources.push({ label: "Pro-only video id", text: m[1] });
} catch {
  /* data files missing: nothing to check */
}

const MARKERS = [
  { label: "PEM private key", re: /-----BEGIN (RSA )?PRIVATE KEY-----/ },
  { label: "service-account JSON", re: /"private_key_id"\s*:/ },
  { label: "Firebase Admin SDK", re: /firebase-admin|FirebaseAppError|credential\.cert\(/ },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
const problems = [];
for (const file of walk(staticDir)) {
  if (!/\.(js|css|html|json|map|txt)$/.test(file)) continue;
  files++;
  const text = readFileSync(file, "utf8");
  for (const n of needles) if (text.includes(n.text)) problems.push(`${file}: contains the ${n.label}`);
  for (const r of proResources) if (text.includes(r.text)) problems.push(`${file}: contains a ${r.label}`);
  for (const m of MARKERS) if (m.re.test(text)) problems.push(`${file}: contains a ${m.label}`);
}

if (problems.length) {
  console.error("SECRET CHECK FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(
  `Secret check passed: ${files} browser files scanned, ${needles.length} secret values and ${proResources.length} Pro-only links checked, none found.`
);

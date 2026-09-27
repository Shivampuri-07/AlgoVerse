// Node module hooks for the script tests: resolve the "@/..." path alias and
// extension-less relative imports to the project's .ts/.tsx files.
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
const ROOT = process.cwd() + "/";
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) {
    const base = ROOT + spec.slice(2);
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      if (ext === "" && !/\.[mc]?[jt]sx?$/.test(base)) continue;
      if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, ctx);
    }
  }
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[mc]?[jt]sx?$/.test(spec)) {
    const u = new URL(spec, ctx.parentURL);
    for (const ext of [".ts", ".tsx"]) if (existsSync(u.pathname + ext)) return next(u.href + ext, ctx);
  }
  return next(spec, ctx);
}

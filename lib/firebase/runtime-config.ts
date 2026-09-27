/**
 * SERVER-ONLY: the public Firebase web config as the deployment's environment has it RIGHT NOW
 * (read on each request by the root layout and handed to the browser).
 *
 * Deliberately uses computed keys (`process.env[name]`) so Next.js does NOT inline these at
 * build time — that is the whole point: it is the fallback for builds that didn't get the
 * NEXT_PUBLIC_ values inlined. Only the four public values (and the dev-only emulator host) are
 * read here; the service-account key never goes near this file.
 */
import {
  PUBLIC_CONFIG_VARS,
  getAuthEmulatorHost,
  readPublicVars,
  resolvePublicConfig,
  type PublicConfigState,
  type PublicConfigValues,
} from "@/lib/firebase/config";

const env = process.env;

export function readRuntimePublicVars(): PublicConfigValues {
  const out = {} as PublicConfigValues;
  for (const name of PUBLIC_CONFIG_VARS) out[name] = env[name]?.trim() ?? "";
  return out;
}

function runtimeEmulatorHost(): string | null {
  const key = "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST";
  return getAuthEmulatorHost() || env[key]?.trim() || null;
}

export function getPublicConfigState(): PublicConfigState {
  return resolvePublicConfig(readPublicVars(), readRuntimePublicVars(), runtimeEmulatorHost());
}

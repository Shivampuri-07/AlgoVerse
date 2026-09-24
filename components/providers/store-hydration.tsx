"use client";

import * as React from "react";
import { useAppStore } from "@/lib/store";

/**
 * Kicks off the one-time client-side rehydration of the persisted Zustand
 * store (see `skipHydration: true` in lib/store.ts). Doing this manually,
 * after mount, guarantees the server-rendered HTML and the client's first
 * paint always match — a returning user's localStorage is only applied
 * once we're safely past hydration.
 */
export function StoreHydration() {
  React.useEffect(() => {
    useAppStore.persist.rehydrate();
  }, []);

  return null;
}

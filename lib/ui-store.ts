import { create } from "zustand";

/** Ephemeral (non-persisted) UI state: dialogs, palettes, mobile drawer. */
interface UIState {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandOpen: false,
  setCommandOpen: (open) => set({ commandOpen: open }),
  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));

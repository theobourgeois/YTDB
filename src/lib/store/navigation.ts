import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Key under which each browser history entry remembers its place in `entries`. */
const STAMP = "ytdbNav";

type NavigationState = {
  /** Every place visited this session, oldest first, as pathnames. */
  entries: string[];
  /** Which entry the page is showing. */
  index: number;
  /** True between a browser back/forward and the render that lands it. */
  traversing: boolean;
  /** True when the next arrival should replace the current entry, not follow it. */
  replaceNext: boolean;
  /** Records the pathname the app has just rendered. Called by the tracker only. */
  arrive: (href: string) => void;
  markTraversal: () => void;
  markReplace: () => void;
};

function stampedIndex(): number | undefined {
  const state: unknown = window.history.state;
  if (!state || typeof state !== "object") return undefined;
  const value = (state as Record<string, unknown>)[STAMP];
  return typeof value === "number" ? value : undefined;
}

function stamp(index: number) {
  const state = window.history.state;
  if (state && typeof state === "object" && state[STAMP] === index) return;
  window.history.replaceState({ ...(state ?? {}), [STAMP]: index }, "");
}

/**
 * The app's own back/forward trail. The browser keeps the real history; this
 * mirrors it so the UI can say where back leads and whether forward exists.
 * Each history entry is stamped with its index, so browser and app agree even
 * after a reload.
 */
export const useNavigation = create<NavigationState>()(
  persist(
    (set, get) => ({
      entries: [],
      index: -1,
      traversing: false,
      replaceNext: false,
      markTraversal: () => set({ traversing: true }),
      markReplace: () => set({ replaceNext: true }),
      arrive: (href) => {
        const { entries, index, traversing, replaceNext } = get();
        const stamped = stampedIndex();

        if (entries[index] === href && !replaceNext) {
          set({ traversing: false });
          stamp(index);
          return;
        }

        let nextEntries = entries;
        let nextIndex: number;
        if (stamped !== undefined && entries[stamped] === href) {
          nextIndex = stamped;
        } else if (traversing && entries[index - 1] === href) {
          nextIndex = index - 1;
        } else if (traversing && entries[index + 1] === href) {
          nextIndex = index + 1;
        } else if (replaceNext && index >= 0) {
          nextEntries = entries.map((entry, position) => (position === index ? href : entry));
          nextIndex = index;
        } else {
          nextEntries = [...entries.slice(0, index + 1), href];
          nextIndex = nextEntries.length - 1;
        }
        set({ entries: nextEntries, index: nextIndex, traversing: false, replaceNext: false });
        stamp(nextIndex);
      },
    }),
    {
      name: "ytdb:navigation",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ entries: state.entries, index: state.index }),
    },
  ),
);

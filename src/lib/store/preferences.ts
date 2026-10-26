import { create } from "zustand";
import { persist } from "zustand/middleware";

type PreferencesState = {
  /** Keeps every opened table in a row of tabs above the view. */
  tabView: boolean;
  setTabView: (tabView: boolean) => void;
};

/** App-wide settings, the same on every connection. */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      tabView: false,
      setTabView: (tabView) => set({ tabView }),
    }),
    {
      name: "ytdb:preferences",
      partialize: (state) => ({ tabView: state.tabView }),
    },
  ),
);

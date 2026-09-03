import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  isThemeId,
  type ThemeId,
} from "../themes";
import { migrateLegacyStorage } from "./storage-migration";

migrateLegacyStorage("db-studio:theme", THEME_STORAGE_KEY);

type ThemeState = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME_ID,
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: THEME_STORAGE_KEY,
      partialize: (state) => ({ theme: state.theme }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<ThemeState> | undefined;
        return {
          ...current,
          theme: isThemeId(stored?.theme) ? stored.theme : current.theme,
        };
      },
    },
  ),
);

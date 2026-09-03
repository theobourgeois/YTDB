"use client";

import { useLayoutEffect, type ReactNode } from "react";
import { useThemeStore } from "@/lib/store/theme";
import { applyTheme } from "@/lib/themes";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore((state) => state.theme);

  useLayoutEffect(() => {
    if (!useThemeStore.persist.hasHydrated()) return;
    applyTheme(theme);
  }, [theme]);

  useLayoutEffect(() => {
    return useThemeStore.persist.onFinishHydration((state) => {
      applyTheme(state.theme);
    });
  }, []);

  return children;
}

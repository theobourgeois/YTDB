"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useNavigation } from "@/lib/store/navigation";

/** Keeps the app's back/forward trail in step with the pages it renders. */
export function NavigationTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const onPopState = () => useNavigation.getState().markTraversal();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    useNavigation.getState().arrive(pathname);
  }, [pathname]);

  return null;
}

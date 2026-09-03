import type { Cell } from "@/lib/types";

export function httpUrl(value: Cell): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "" || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

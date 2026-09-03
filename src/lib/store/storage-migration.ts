/** Copies pre-YTDB browser state once without deleting the original recovery copy. */
export function migrateLegacyStorage(legacyKey: string, ytdbKey: string): void {
  if (typeof window === "undefined" || window.localStorage.getItem(ytdbKey) !== null) return;
  const legacyValue = window.localStorage.getItem(legacyKey);
  if (legacyValue !== null) window.localStorage.setItem(ytdbKey, legacyValue);
}

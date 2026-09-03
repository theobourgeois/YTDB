/**
 * Single source of truth for the hosted UI origin.
 *
 * Switching domains is a one-line edit to `HOSTED_ORIGIN`. Nothing else in the
 * codebase hardcodes a domain: `bin/ytdb.mjs` opens this origin in the browser
 * and `src/proxy.ts` uses it as the local bridge's CORS allowlist.
 */

/** The domain the CLI opens and the local bridge trusts. */
export const HOSTED_ORIGIN = "https://ytdb.theobourgeois.com";

/**
 * Extra origins the local bridge also accepts.
 *
 * Populate this during a domain switch with the domain being retired, so an
 * already-installed CLI keeps working before users upgrade. Only ever list a
 * domain you currently control: an entry here can talk to the local database
 * bridge, so a lapsed domain someone else registers inherits that trust.
 */
export const ALSO_TRUSTED_UI_ORIGINS = [];

/** `https://Example.com/path` -> `https://example.com`; null when unusable. */
export function normalizeOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The active hosted origin. `YTDB_HOSTED_ORIGIN` overrides the default. */
export function resolveHostedOrigin(env = process.env) {
  return normalizeOrigin(env.YTDB_HOSTED_ORIGIN) ?? HOSTED_ORIGIN;
}

/** Every origin the local bridge accepts cross-origin database calls from. */
export function resolveTrustedUiOrigins(env = process.env) {
  return new Set([resolveHostedOrigin(env), HOSTED_ORIGIN, ...ALSO_TRUSTED_UI_ORIGINS]);
}

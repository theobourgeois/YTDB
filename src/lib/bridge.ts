const BRIDGE_PORT_KEY = "ytdb:bridge-port";
const DEFAULT_BRIDGE_PORT = 4371;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "local.ytdb" ||
    hostname === "local.dbstudio"
  );
}

export function isHostedUi(): boolean {
  return typeof window !== "undefined" && !isLoopbackHostname(window.location.hostname);
}

function parsePort(value: string | null): number | null {
  const port = Number(value);
  return value && Number.isInteger(port) && port >= 1024 && port <= 65_535 ? port : null;
}

/**
 * The CLI opens `#port=N`. Remember it so a plain visit to the hosted UI later finds the
 * same bridge; otherwise fall back to the last port seen, then the default.
 */
function bridgePort(): number {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (fragment.has("port")) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const launched = parsePort(fragment.get("port"));
    if (launched) {
      window.localStorage.setItem(BRIDGE_PORT_KEY, String(launched));
      return launched;
    }
  }
  return parsePort(window.localStorage.getItem(BRIDGE_PORT_KEY)) ?? DEFAULT_BRIDGE_PORT;
}

/** Where database calls go: the local bridge from the hosted UI, same-origin otherwise. */
export function bridgeOrigin(): string | null {
  return isHostedUi() ? `http://127.0.0.1:${bridgePort()}` : null;
}

export async function bridgeFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const origin = bridgeOrigin();
  return fetch(origin ? new URL(path, origin) : path, {
    ...init,
    // Chromium's Local Network Access model uses this hint for public → loopback requests.
    targetAddressSpace: origin ? "loopback" : undefined,
  } as RequestInit);
}

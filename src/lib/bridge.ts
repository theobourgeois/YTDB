const BRIDGE_STORAGE_KEY = "ytdb:bridge";
const DEFAULT_BRIDGE_PORT = 4371;

export type BridgeConfig = {
  origin: string;
  token: string;
};

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

function readLaunchConfig(): BridgeConfig | null {
  if (typeof window === "undefined") return null;

  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("token");
  const rawPort = fragment.get("port");
  if (!token) return null;

  const port = rawPort ? Number(rawPort) : DEFAULT_BRIDGE_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) return null;

  const config = { origin: `http://127.0.0.1:${port}`, token };
  window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(config));
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return config;
}

export function getBridgeConfig(): BridgeConfig | null {
  if (typeof window === "undefined") return null;

  const launched = readLaunchConfig();
  if (launched) return launched;

  const stored = window.sessionStorage.getItem(BRIDGE_STORAGE_KEY);
  if (!stored) return null;
  try {
    const config = JSON.parse(stored) as Partial<BridgeConfig>;
    if (
      typeof config.origin === "string" &&
      /^http:\/\/127\.0\.0\.1:\d+$/.test(config.origin) &&
      typeof config.token === "string" &&
      config.token.length > 0
    ) {
      return config as BridgeConfig;
    }
  } catch {
    // A malformed or stale bridge session should behave like a missing local process.
  }
  window.sessionStorage.removeItem(BRIDGE_STORAGE_KEY);
  return null;
}

export async function bridgeFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const config = getBridgeConfig();
  if (isHostedUi() && !config) {
    throw new Error("Start YTDB with `npx @theobourgeois/ytdb`, then use the browser tab it opens.");
  }

  const headers = new Headers(init.headers);
  if (config) headers.set("Authorization", `Bearer ${config.token}`);
  const url = config ? new URL(path, config.origin) : path;

  return fetch(url, {
    ...init,
    headers,
    // Chromium's Local Network Access model uses this hint for public → loopback requests.
    targetAddressSpace: config ? "loopback" : undefined,
  } as RequestInit);
}

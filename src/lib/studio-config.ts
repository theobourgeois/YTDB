import { isThemeId, type ThemeId } from "./themes";
import type { Connection } from "./types";
import type { BrowseState, TableState } from "./store/explorer";
import { useConnections } from "./store/connections";
import { useExplorer } from "./store/explorer";
import { useThemeStore } from "./store/theme";

export const STUDIO_CONFIG_VERSION = 1;

export type StudioConfig = {
  version: typeof STUDIO_CONFIG_VERSION;
  exportedAt: string;
  connections: Connection[];
  explorer: {
    browse: Record<string, BrowseState>;
    tables: Record<string, TableState>;
  };
  theme: ThemeId;
};

export function snapshotStudioConfig(): StudioConfig {
  const { connections } = useConnections.getState();
  const { browse, tables } = useExplorer.getState();
  const { theme } = useThemeStore.getState();
  return {
    version: STUDIO_CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    connections,
    explorer: { browse, tables },
    theme,
  };
}

export function downloadStudioConfig(): void {
  const json = `${JSON.stringify(snapshotStudioConfig(), null, 2)}\n`;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "db-studio.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function parseStudioConfig(text: string): StudioConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn’t valid JSON.");
  }
  if (!isRecord(raw)) {
    throw new Error("That file isn’t a DB Studio config.");
  }
  if (raw.version !== STUDIO_CONFIG_VERSION) {
    throw new Error("That config file isn’t supported.");
  }
  if (!Array.isArray(raw.connections)) {
    throw new Error("That config file has no connections list.");
  }
  const connections = raw.connections.map((item, index) => parseConnection(item, index));
  const explorerRaw = isRecord(raw.explorer) ? raw.explorer : {};
  const browse = isRecord(explorerRaw.browse)
    ? (explorerRaw.browse as Record<string, BrowseState>)
    : {};
  const tables = isRecord(explorerRaw.tables)
    ? (explorerRaw.tables as Record<string, TableState>)
    : {};
  const theme = isThemeId(raw.theme) ? raw.theme : useThemeStore.getState().theme;
  const exportedAt =
    typeof raw.exportedAt === "string" ? raw.exportedAt : new Date().toISOString();
  return {
    version: STUDIO_CONFIG_VERSION,
    exportedAt,
    connections,
    explorer: { browse, tables },
    theme,
  };
}

export function applyStudioConfig(config: StudioConfig): void {
  useConnections.setState({ connections: config.connections });
  useExplorer.setState({
    browse: config.explorer.browse,
    tables: config.explorer.tables,
  });
  useThemeStore.getState().setTheme(config.theme);
}

export function hasStudioConfigToReplace(): boolean {
  const { connections } = useConnections.getState();
  const { browse, tables } = useExplorer.getState();
  return (
    connections.length > 0 ||
    Object.keys(browse).length > 0 ||
    Object.keys(tables).length > 0
  );
}

function parseConnection(value: unknown, index: number): Connection {
  if (!isRecord(value)) {
    throw new Error(`Connection ${index + 1} is invalid.`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`Connection ${index + 1} is missing an id.`);
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error(`Connection ${index + 1} is missing a name.`);
  }
  if (typeof value.url !== "string" || value.url.length === 0) {
    throw new Error(`Connection ${index + 1} is missing a URL.`);
  }
  const connection: Connection = {
    id: value.id,
    name: value.name,
    url: value.url,
  };
  if (typeof value.color === "string") connection.color = value.color;
  if (typeof value.layoutGroup === "string") connection.layoutGroup = value.layoutGroup;
  return connection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

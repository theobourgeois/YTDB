export const CONNECTION_COLORS = [
  "#e11d48",
  "#f97316",
  "#d97706",
  "#65a30d",
  "#0d9488",
  "#0284c7",
  "#4f46e5",
  "#7c3aed",
  "#c026d3",
  "#57534e",
] as const;

export type ConnectionColor = (typeof CONNECTION_COLORS)[number];

export function isConnectionColor(value: string | undefined): value is ConnectionColor {
  return CONNECTION_COLORS.some((color) => color === value);
}

export function colorFromId(id: string): ConnectionColor {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return CONNECTION_COLORS[hash % CONNECTION_COLORS.length] ?? CONNECTION_COLORS[0];
}

export function nextConnectionColor(used: string[]): ConnectionColor {
  const unused = CONNECTION_COLORS.find((color) => !used.includes(color));
  if (unused) return unused;
  return CONNECTION_COLORS[used.length % CONNECTION_COLORS.length] ?? CONNECTION_COLORS[0];
}

export function resolveConnectionColor(connection: {
  id: string;
  color?: string;
}): ConnectionColor {
  if (isConnectionColor(connection.color)) return connection.color;
  return colorFromId(connection.id);
}

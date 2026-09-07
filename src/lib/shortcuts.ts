/** Display labels for the app's global keyboard shortcuts. */
export const SHORTCUTS = {
  commandPalette: "⌘⇧P",
  tableSearch: "⌘P",
  columnSearch: "⌘/",
  sqlEditor: "⌘E",
  switchConnection: "⌘⇧E",
} as const;

function opener() {
  const handlers = new Set<() => void>();
  return {
    register(open: () => void) {
      handlers.add(open);
      return () => {
        handlers.delete(open);
      };
    },
    open() {
      for (const handler of handlers) handler();
    },
  };
}

/** Lets the command palette reach overlays owned by other views. */
const columnSearch = opener();
const tableSearch = opener();

export const registerColumnSearch = columnSearch.register;
export const openColumnSearch = columnSearch.open;
export const registerTableSearch = tableSearch.register;
export const openTableSearch = tableSearch.open;

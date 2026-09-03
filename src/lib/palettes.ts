const closers = new Set<() => void>();

export function registerPaletteCloser(close: () => void) {
  closers.add(close);
  return () => {
    closers.delete(close);
  };
}

export function dismissPalettes() {
  for (const close of closers) close();
}

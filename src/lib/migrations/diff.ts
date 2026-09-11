/**
 * A line diff of two SQL texts, for showing how a migration's file differs from
 * the SQL a database actually ran. Myers' algorithm, run only on what lies
 * between the shared head and tail, which is where an edited migration differs.
 */

export type DiffLine = {
  kind: "same" | "add" | "remove";
  text: string;
  /** Line number in the old text; null for an added line. */
  oldNo: number | null;
  /** Line number in the new text; null for a removed line. */
  newNo: number | null;
};

export type DiffHunk = {
  /** `@@ -12,7 +12,9 @@`, as git writes it. */
  header: string;
  lines: DiffLine[];
};

type Edit = { kind: DiffLine["kind"]; text: string };

/** Past this much search state the middle is shown as one replacement instead of computed. */
const MAX_TRACE_CELLS = 20_000_000;

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return normalized ? normalized.split("\n") : [];
}

/** The shortest edit script from `a` to `b`, or null when it would take too much memory to find. */
function myers(a: string[], b: string[]): Edit[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  let found = false;
  for (let d = 0; d <= max && !found; d += 1) {
    if ((trace.length + 1) * v.length > MAX_TRACE_CELLS) return null;
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const state = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && state[offset + k - 1] < state[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = state[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      edits.push({ kind: "same", text: a[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      if (x === prevX) edits.push({ kind: "add", text: b[y - 1] });
      else edits.push({ kind: "remove", text: a[x - 1] });
    }
    x = prevX;
    y = prevY;
  }
  return edits.reverse();
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const middleA = a.slice(head, a.length - tail);
  const middleB = b.slice(head, b.length - tail);
  const middle = myers(middleA, middleB) ?? [
    ...middleA.map((text): Edit => ({ kind: "remove", text })),
    ...middleB.map((text): Edit => ({ kind: "add", text })),
  ];
  const edits: Edit[] = [
    ...a.slice(0, head).map((text): Edit => ({ kind: "same", text })),
    ...middle,
    ...a.slice(a.length - tail).map((text): Edit => ({ kind: "same", text })),
  ];

  let oldNo = 0;
  let newNo = 0;
  return edits.map((edit): DiffLine => {
    if (edit.kind === "same") {
      oldNo += 1;
      newNo += 1;
      return { ...edit, oldNo, newNo };
    }
    if (edit.kind === "remove") {
      oldNo += 1;
      return { ...edit, oldNo, newNo: null };
    }
    newNo += 1;
    return { ...edit, oldNo: null, newNo };
  });
}

/** Groups a diff into hunks with `context` unchanged lines around each change, as git does. */
export function toHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const ranges: [number, number][] = [];
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  });

  const oldBefore: number[] = [];
  const newBefore: number[] = [];
  let oldSeen = 0;
  let newSeen = 0;
  for (const line of lines) {
    oldBefore.push(oldSeen);
    newBefore.push(newSeen);
    if (line.kind !== "add") oldSeen += 1;
    if (line.kind !== "remove") newSeen += 1;
  }

  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    const oldCount = slice.filter((line) => line.kind !== "add").length;
    const newCount = slice.filter((line) => line.kind !== "remove").length;
    // An empty side is numbered by the line before it, as git does.
    const oldStart = oldBefore[start] + (oldCount === 0 ? 0 : 1);
    const newStart = newBefore[start] + (newCount === 0 ? 0 : 1);
    return { header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines: slice };
  });
}

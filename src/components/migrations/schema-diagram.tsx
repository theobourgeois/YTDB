"use client";

import "@xyflow/react/dist/base.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExpandIcon,
  KeyIcon,
  LinkIcon,
  SchemaIcon,
  TableIcon,
  ViewIcon,
} from "@/components/icons";
import { describeChanges, qualifiedName } from "@/lib/migrations/changes";
import {
  buildDiagram,
  type Diagram,
  type DiagramColumn,
  type DiagramEdge,
  type DiagramSchema,
  type DiagramTable,
} from "@/lib/migrations/diagram";
import type { MigrationStep } from "@/lib/migrations/types";
import type { TableInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ADDED, CHANGED, REMOVED } from "./schema-changes";

/** Heights the layout reserves, matched by the classes the table node renders with. */
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 22;
const MORE_HEIGHT = 22;
const BODY_PADDING = 4;
const CHAR_WIDTH = 6.7;

const FIT = { padding: 0.08, maxZoom: 1 };

const EDGE_COLOR: Record<DiagramEdge["status"], string> = {
  added: "#10b981",
  dropped: "#ef4444",
  same: "var(--muted-foreground)",
};

/**
 * The migration as a diagram: schemas as regions, tables in them, foreign keys
 * between. A track along the top steps through the files, showing the schema
 * as it stands after each one with that file's changes brought forward.
 */
export function SchemaDiagram(props: {
  steps: MigrationStep[];
  live: TableInfo[] | null;
  /** The file the diagram stands at, or null for all of them. */
  at: string | null;
  onAt: (version: string | null) => void;
  /** Opens one file in the list. */
  onVersion: (version: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <DiagramView {...props} />
    </ReactFlowProvider>
  );
}

function DiagramView({
  steps,
  live,
  at,
  onAt,
  onVersion,
}: {
  steps: MigrationStep[];
  live: TableInfo[] | null;
  at: string | null;
  onAt: (version: string | null) => void;
  onVersion: (version: string) => void;
}) {
  const atIndex = at === null ? -1 : steps.findIndex((step) => step.version === at);
  const through = atIndex === -1 ? steps : steps.slice(0, atIndex + 1);
  const diagram = useMemo(() => {
    const changes = describeChanges(through.map((step) => ({ version: step.version, sql: step.applySql })));
    return buildDiagram(changes, live, atIndex === -1 ? null : new Set([steps[atIndex].version]));
    // `through` is derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, live, atIndex]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const { fitView } = useReactFlow();
  // Fitted when what is shown changes, not when a table is opened up, and only
  // once the nodes have been measured, since fitting goes by their sizes.
  const fittedFor = useRef<Diagram | null>(null);
  const [fitPending, setFitPending] = useState(false);
  const measured = useNodesInitialized();
  useEffect(() => {
    if (!fitPending || !measured) return;
    // A frame later the pane has its size too, which fitting also goes by.
    const frame = window.requestAnimationFrame(() => {
      setFitPending(false);
      void fitView(FIT);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitPending, measured, fitView]);

  useEffect(() => {
    let cancelled = false;
    void layout(diagram, expanded, toggle, atIndex !== -1).then((result) => {
      if (cancelled) return;
      setNodes(result.nodes);
      setEdges(result.edges);
      if (fittedFor.current !== diagram) {
        fittedFor.current = diagram;
        setFitPending(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [diagram, expanded, toggle, atIndex, setNodes]);

  const empty = diagram.tables.length === 0 && diagram.schemas.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StepTrack steps={steps} atIndex={atIndex} onAt={onAt} onVersion={onVersion}>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Fit to view"
          title="Fit to view"
          onClick={() => void fitView({ ...FIT, duration: 200 })}
        >
          <ExpandIcon />
        </Button>
      </StepTrack>
      <div className="relative min-h-0 flex-1">
        {empty ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            {diagram.otherCount > 0
              ? "No tables change here; see Schema for everything else."
              : "No schema changes"}
          </p>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            minZoom={0.1}
            maxZoom={2}
            className="text-foreground"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border)" />
          </ReactFlow>
        )}
        {diagram.otherCount > 0 && !empty && (
          <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted-foreground">
            {diagram.otherCount} more change{diagram.otherCount === 1 ? "" : "s"} besides tables, in Schema
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ step track */

function StepTrack({
  steps,
  atIndex,
  onAt,
  onVersion,
  children,
}: {
  steps: MigrationStep[];
  atIndex: number;
  onAt: (version: string | null) => void;
  onVersion: (version: string) => void;
  children?: React.ReactNode;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atIndex]);

  const step = (offset: number) => {
    // Stepping back from the first file, or forward from the last, is all of them.
    const next = (atIndex === -1 ? (offset > 0 ? 0 : steps.length - 1) : atIndex + offset);
    onAt(next < 0 || next >= steps.length ? null : steps[next].version);
  };
  const current = atIndex === -1 ? null : steps[atIndex];

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") step(-1);
        else if (event.key === "ArrowRight") step(1);
        else return;
        event.preventDefault();
      }}
    >
      <Button size="icon-xs" variant="ghost" aria-label="Previous file" onClick={() => step(-1)}>
        <ChevronLeftIcon />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Next file" onClick={() => step(1)}>
        <ChevronRightIcon />
      </Button>
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        <TrackButton
          active={atIndex === -1}
          ref={atIndex === -1 ? selectedRef : undefined}
          title="Everything, all files together"
          onClick={() => onAt(null)}
        >
          All
        </TrackButton>
        {steps.map((item, index) => (
          <TrackButton
            key={item.version}
            ref={index === atIndex ? selectedRef : undefined}
            active={index === atIndex}
            later={atIndex !== -1 && index > atIndex}
            title={`${item.version} ${item.name}: the schema after this file`}
            onClick={() => onAt(item.version)}
            className="font-mono"
          >
            {item.version}
          </TrackButton>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
        {current && (
          <button
            type="button"
            title={`Show ${current.version}`}
            onClick={() => onVersion(current.version)}
            className="max-w-64 cursor-pointer truncate rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {current.name}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

function TrackButton({
  active,
  later = false,
  className,
  ...props
}: React.ComponentProps<"button"> & { active: boolean; later?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "h-6 shrink-0 cursor-pointer rounded-sm px-1.5 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? "bg-muted text-foreground"
          : later
            ? "text-muted-foreground/40 hover:text-foreground"
            : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------- layout */

type TableData = {
  table: DiagramTable;
  expanded: boolean;
  /** Something is in focus and this is not part of it. */
  quiet: boolean;
  onToggle: (id: string) => void;
};

type SchemaData = { schema: DiagramSchema };

const elk = new ELK();

function columnsShown(table: DiagramTable, expanded: boolean): DiagramColumn[] {
  return expanded ? [...table.columns, ...table.hidden] : table.columns;
}

function tableSize(table: DiagramTable, expanded: boolean): { width: number; height: number } {
  const columns = columnsShown(table, expanded);
  const widest = Math.max(
    table.name.length + 12,
    ...columns.map((column) => column.name.length + Math.min(shortType(column.detail).length, 22) + 6),
  );
  const width = Math.round(Math.min(380, Math.max(220, widest * CHAR_WIDTH + 40)));
  const rows = columns.length + (table.unknownColumns && columns.length === 0 ? 1 : 0);
  const height = HEADER_HEIGHT + rows * ROW_HEIGHT + (table.hidden.length > 0 ? MORE_HEIGHT : 0) + BODY_PADDING;
  return { width, height };
}

async function layout(
  diagram: Diagram,
  expanded: ReadonlySet<string>,
  onToggle: (id: string) => void,
  focusing: boolean,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const tablesBySchema = new Map<string, DiagramTable[]>();
  for (const table of diagram.tables) {
    const list = tablesBySchema.get(table.schema) ?? [];
    list.push(table);
    tablesBySchema.set(table.schema, list);
  }
  const byId = new Map(diagram.tables.map((table) => [table.id, table]));

  // Every shown column has a port on each side, where a key's line starts or ends,
  // so the router knows exactly where lines meet a table and keeps them off the rest.
  const tableNode = (table: DiagramTable): ElkNode => {
    const size = tableSize(table, expanded.has(table.id));
    const columns = columnsShown(table, expanded.has(table.id));
    const port = (name: string, side: "in" | "out", y: number) => ({
      id: portId(table.id, name, side),
      x: side === "in" ? 0 : size.width,
      y,
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": side === "in" ? "WEST" : "EAST" },
    });
    return {
      id: table.id,
      ...size,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: [
        port(TABLE_PORT, "in", HEADER_HEIGHT / 2),
        port(TABLE_PORT, "out", HEADER_HEIGHT / 2),
        ...columns.flatMap((column, index) => {
          const y = HEADER_HEIGHT + BODY_PADDING / 2 + index * ROW_HEIGHT + ROW_HEIGHT / 2;
          return [port(column.name, "in", y), port(column.name, "out", y)];
        }),
      ],
    };
  };

  /** The port a key's line meets a table at: its first column, or the header when that column is not shown. */
  const endOf = (tableIdValue: string, columns: string[], side: "in" | "out") => {
    const table = byId.get(tableIdValue);
    const name = columns[0];
    const shown = table && name !== undefined && columnsShown(table, expanded.has(table.id)).some((column) => column.name === name);
    return portId(tableIdValue, shown ? name : TABLE_PORT, side);
  };
  const primaryKeyOf = (edge: DiagramEdge) =>
    edge.targetColumns.length > 0
      ? edge.targetColumns
      : (byId.get(edge.to)?.columns.filter((column) => column.primaryKey).map((column) => column.name) ?? []);

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "28",
      "elk.spacing.edgeNode": "16",
      "elk.spacing.edgeEdge": "8",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.layered.spacing.edgeNodeBetweenLayers": "16",
      "elk.spacing.componentComponent": "48",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: diagram.schemas.map((schema) => ({
      id: `schema:${schema.name}`,
      layoutOptions: { "elk.padding": "[top=40,left=20,bottom=20,right=20]" },
      // A schema with nothing in it — made or dropped on its own — still shows as a region.
      ...(tablesBySchema.has(schema.name) ? {} : { width: 200, height: 40 }),
      children: (tablesBySchema.get(schema.name) ?? []).map(tableNode),
    })),
    // From the table a key points at to the one holding it, so referenced tables sit to the left.
    edges: diagram.edges.map((edge) => ({
      id: edge.id,
      sources: [endOf(edge.to, primaryKeyOf(edge), "out")],
      targets: [endOf(edge.from, edge.columns, "in")],
    })),
  };
  const result = await elk.layout(graph);

  const nodes: Node[] = [];
  // Where each node sits on the canvas, for edges whose route is relative to a schema.
  const origin = new Map<string, { x: number; y: number }>([["root", { x: 0, y: 0 }]]);
  for (const group of result.children ?? []) {
    const schema = diagram.schemas.find((item) => `schema:${item.name}` === group.id)!;
    origin.set(group.id, { x: group.x ?? 0, y: group.y ?? 0 });
    nodes.push({
      id: group.id,
      type: "schema",
      position: { x: group.x ?? 0, y: group.y ?? 0 },
      style: { width: group.width, height: group.height },
      data: { schema } satisfies SchemaData,
      draggable: false,
      zIndex: -1,
    });
    for (const child of group.children ?? []) {
      const table = byId.get(child.id)!;
      nodes.push({
        id: table.id,
        type: "table",
        parentId: group.id,
        position: { x: child.x ?? 0, y: child.y ?? 0 },
        style: { width: child.width },
        data: {
          table,
          expanded: expanded.has(table.id),
          quiet: focusing && !table.focused,
          onToggle,
        } satisfies TableData,
      });
    }
  }

  const routes = new Map((result.edges ?? []).map((edge) => [edge.id, edge]));
  const edges: Edge[] = diagram.edges.map((edge) => {
    const routed = routes.get(edge.id);
    const offset = origin.get(routed?.container ?? "root") ?? { x: 0, y: 0 };
    const points = (routed?.sections ?? []).flatMap((section) =>
      [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => ({
        x: point.x + offset.x,
        y: point.y + offset.y,
      })),
    );
    const quiet = focusing && !edge.focused;
    return {
      id: edge.id,
      source: edge.to,
      target: edge.from,
      type: "routed",
      data: { points } satisfies RoutedData,
      style: {
        stroke: EDGE_COLOR[edge.status],
        strokeWidth: edge.status === "same" ? 1 : 1.5,
        strokeDasharray: edge.status === "dropped" ? "4 3" : undefined,
        opacity: quiet ? 0.3 : edge.status === "same" ? 0.6 : 1,
      },
      zIndex: edge.status === "same" ? 0 : 1,
    };
  });
  return { nodes, edges };
}

const TABLE_PORT = "";

function portId(table: string, column: string, side: "in" | "out"): string {
  return JSON.stringify([table, column, side]);
}

/* ----------------------------------------------------------------- edges */

type RoutedData = { points: { x: number; y: number }[] };

/** A line along the route the layout found, its corners rounded. */
function RoutedEdge({ data, style, sourceX, sourceY, targetX, targetY }: EdgeProps<Edge<RoutedData>>) {
  const points = data?.points ?? [];
  const path = points.length >= 2 ? roundedPath(points, 6) : `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  return <BaseEdge path={path} style={style} />;
}

function roundedPath(points: { x: number; y: number }[], radius: number): string {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [before, corner, after] = [points[i - 1], points[i], points[i + 1]];
    const into = Math.min(radius, Math.hypot(corner.x - before.x, corner.y - before.y) / 2);
    const out = Math.min(radius, Math.hypot(after.x - corner.x, after.y - corner.y) / 2);
    const start = toward(corner, before, into);
    const end = toward(corner, after, out);
    d += ` L ${start.x} ${start.y} Q ${corner.x} ${corner.y} ${end.x} ${end.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

function toward(from: { x: number; y: number }, to: { x: number; y: number }, distance: number) {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / length) * distance, y: from.y + ((to.y - from.y) / length) * distance };
}

const EDGE_TYPES = { routed: RoutedEdge };

/* ----------------------------------------------------------------- nodes */

const NODE_TYPES = {
  schema: memo(SchemaNode),
  table: memo(TableNode),
};

function SchemaNode({ data }: NodeProps<Node<SchemaData>>) {
  const { schema } = data;
  return (
    <div
      className={cn(
        "size-full rounded-lg border border-dashed bg-muted/15",
        schema.status === "created" && "border-emerald-500/50 bg-emerald-500/[0.03]",
        schema.status === "dropped" && "border-red-500/50 bg-red-500/[0.03]",
      )}
    >
      <div className="flex h-8 items-center gap-1.5 px-3">
        <SchemaIcon className="size-3.5 text-muted-foreground" />
        <span
          className={cn(
            "font-mono text-xs font-medium",
            schema.status === "dropped" && "text-muted-foreground line-through decoration-red-500/60",
          )}
        >
          {schema.name}
        </span>
        {schema.status === "created" && <span className={cn("text-[11px]", ADDED)}>new</span>}
        {schema.status === "dropped" && <span className={cn("text-[11px]", REMOVED)}>dropped</span>}
      </div>
    </div>
  );
}

const HANDLE = "!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

function TableNode({ data }: NodeProps<Node<TableData>>) {
  const { table, expanded, quiet, onToggle } = data;
  const Icon = table.kind === "view" ? ViewIcon : TableIcon;
  const columns = columnsShown(table, expanded);
  const context = table.status === "context";
  return (
    <div
      title={table.versions.length > 0 ? `Changed in ${table.versions.join(", ")}` : "Unchanged, linked to a change"}
      className={cn(
        "rounded-md border bg-card shadow-xs transition-opacity",
        table.status === "created" && "border-emerald-500/60",
        table.status === "altered" && "border-amber-500/50",
        table.status === "dropped" && "border-red-500/50",
        context && "border-dashed opacity-60",
        quiet && !context && "opacity-50",
      )}
    >
      <div className="relative flex items-center gap-1.5 border-b px-2.5" style={{ height: HEADER_HEIGHT }}>
        {/* Lines follow the layout's routes; these only give React Flow an end to attach them to. */}
        <Handle type="target" position={Position.Left} className={HANDLE} isConnectable={false} />
        <Handle type="source" position={Position.Right} className={HANDLE} isConnectable={false} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "min-w-0 truncate font-mono text-xs font-medium",
            context && "text-muted-foreground",
            table.status === "dropped" && "text-muted-foreground line-through decoration-red-500/60",
          )}
        >
          {table.name}
        </span>
        <TableLabel table={table} />
      </div>
      <div style={{ paddingTop: BODY_PADDING / 2, paddingBottom: BODY_PADDING / 2 }}>
        {columns.map((column) => (
          <ColumnRow key={column.name} column={column} dimmed={context || (quiet && !column.focused)} />
        ))}
        {table.unknownColumns && columns.length === 0 && (
          <div className="flex items-center px-2.5 text-[11px] text-muted-foreground/70" style={{ height: ROW_HEIGHT }}>
            columns not known here
          </div>
        )}
        {table.hidden.length > 0 && (
          <button
            type="button"
            onClick={() => onToggle(table.id)}
            className="nodrag flex w-full cursor-pointer items-center px-2.5 text-left text-[11px] text-muted-foreground/70 hover:text-foreground"
            style={{ height: MORE_HEIGHT }}
          >
            {expanded ? "Fewer columns" : `${table.hidden.length} more column${table.hidden.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}

function TableLabel({ table }: { table: DiagramTable }) {
  const className = "ml-auto shrink-0 pl-2 text-[11px]";
  switch (table.status) {
    case "created":
      return <span className={cn(className, ADDED)}>new</span>;
    case "dropped":
      return <span className={cn(className, REMOVED)}>dropped</span>;
    case "altered":
      if (table.from) {
        const moved = table.from.schema !== table.schema;
        return (
          <span className={cn(className, "font-mono", CHANGED)}>
            from {moved ? qualifiedName(table.from.schema, table.from.name) : table.from.name}
          </span>
        );
      }
      return <span className={cn(className, CHANGED)}>changed</span>;
    case "context":
      return null;
  }
}

const COLUMN_MARK: Record<DiagramColumn["status"], { sign: string; className: string }> = {
  added: { sign: "+", className: ADDED },
  dropped: { sign: "−", className: REMOVED },
  changed: { sign: "~", className: CHANGED },
  renamed: { sign: "~", className: CHANGED },
  same: { sign: "", className: "" },
};

function ColumnRow({ column, dimmed }: { column: DiagramColumn; dimmed: boolean }) {
  const mark = COLUMN_MARK[column.status];
  const type = shortType(column.detail);
  return (
    <div
      className={cn("relative flex items-center gap-1.5 px-2.5 font-mono text-[11px]", dimmed && "opacity-60")}
      style={{ height: ROW_HEIGHT }}
      title={[column.from ? `${column.from} → ${column.name}` : column.name, column.detail].filter(Boolean).join("  ")}
    >
      <span className={cn("w-2 shrink-0 text-center select-none", mark.className)}>{mark.sign}</span>
      <span
        className={cn(
          "min-w-0 truncate",
          column.status === "dropped" && "text-muted-foreground line-through decoration-red-500/60",
        )}
      >
        {column.from && <span className="text-muted-foreground">{column.from} → </span>}
        {column.name}
      </span>
      {column.primaryKey && <KeyIcon className="size-3 shrink-0 text-amber-600/80 dark:text-amber-400/80" />}
      {column.linked && !column.primaryKey && <LinkIcon className="size-3 shrink-0 text-muted-foreground" />}
      <span className="ml-auto min-w-0 shrink truncate pl-2 text-muted-foreground">{type}</span>
    </div>
  );
}

/** A column's type alone, from a detail that may run on into its constraints. */
function shortType(detail: string | undefined): string {
  if (!detail) return "";
  const first = detail.split(" · ")[0];
  return first.startsWith("→") || first === "primary key" || first === "not null" ? "" : first;
}

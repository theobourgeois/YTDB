import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const logDir = process.env.YTDB_LOG_DIR ?? join(repoRoot, ".ytdb", "activity");

const args = process.argv.slice(2);

function flag(...names) {
  return names.some((name) => args.includes(name));
}

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

if (flag("--help", "-h")) {
  console.log(`Usage: npm run log -- [options]

  --limit N        Entries to show (default 50, "all" for everything)
  --action NAME    Only this action, e.g. query, rows, cell.update
  --connection S   Only connections whose redacted URL contains S
  --date DATE      Only this day's file (YYYY-MM-DD)
  --errors         Only failed actions
  --slow MS        Only actions that took at least MS milliseconds
  --json           Print raw JSONL instead of the formatted view
  --follow, -f     Print new entries as they are written

Logs live in ${logDir}`);
  process.exit(0);
}

const limitArg = option("--limit", "50");
const limit = limitArg === "all" ? Infinity : Number(limitArg);
const actionFilter = option("--action");
const connectionFilter = option("--connection");
const dateFilter = option("--date");
const errorsOnly = flag("--errors");
const slowMs = Number(option("--slow", "0"));
const asJson = flag("--json");
const follow = flag("--follow", "-f");

function logFiles() {
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir)
    .filter((name) => name.endsWith(".jsonl"))
    .filter((name) => !dateFilter || name === `${dateFilter}.jsonl`)
    .sort()
    .map((name) => join(logDir, name));
}

function readEntries(file, fromByte = 0) {
  const text = readFileSync(file).subarray(fromByte).toString("utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function matches(entry) {
  if (actionFilter && entry.action !== actionFilter) return false;
  if (connectionFilter && !(entry.connection ?? "").includes(connectionFilter)) return false;
  if (errorsOnly && entry.status !== "error") return false;
  if (slowMs && (entry.durationMs ?? 0) < slowMs) return false;
  return true;
}

const DIM = "\u001b[2m";
const RED = "\u001b[31m";
const RESET = "\u001b[0m";

function paint(code, text) {
  return process.stdout.isTTY ? `${code}${text}${RESET}` : text;
}

function summary(entry) {
  if (entry.status === "error") return paint(RED, entry.error ?? "error");
  return Object.entries(entry.result ?? {})
    .filter(([, value]) => value !== null && value !== false && value !== undefined)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
    .join(" ");
}

/** The one field worth seeing inline: which table, or the SQL that ran. */
function detail(entry) {
  const params = entry.params ?? {};
  if (entry.action === "query" && typeof params.sql === "string") {
    return params.sql.replace(/\s+/g, " ").trim().slice(0, 120);
  }
  const table =
    params.table ?? params.query?.table ?? params.update?.table ?? params.deletion?.table;
  if (table?.name) return `${table.schema}.${table.name}`;
  if (params.name) return params.name;
  return "";
}

function print(entry) {
  if (asJson) {
    console.log(JSON.stringify(entry));
    return;
  }
  const database = entry.connection ? entry.connection.split("/").pop() : "-";
  const line = [
    paint(DIM, entry.ts.slice(11, 19)),
    entry.action.padEnd(13),
    paint(DIM, database.padEnd(14)),
    detail(entry).padEnd(30),
    paint(DIM, `${entry.durationMs}ms`.padStart(7)),
    summary(entry),
  ].join(" ");
  console.log(line.trimEnd());
}

const files = logFiles();
if (files.length === 0) {
  console.log(`No activity logged yet. Logs will appear in ${logDir}`);
  process.exit(0);
}

const entries = files.flatMap((file) => readEntries(file)).filter(matches);
for (const entry of limit > 0 ? entries.slice(-limit) : []) print(entry);

if (follow) {
  const today = join(logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  let offset = existsSync(today) ? statSync(today).size : 0;
  console.log(paint(DIM, `- following ${today} -`));
  setInterval(() => {
    if (!existsSync(today)) return;
    const size = statSync(today).size;
    if (size <= offset) return;
    for (const entry of readEntries(today, offset).filter(matches)) print(entry);
    offset = size;
  }, 500);
}

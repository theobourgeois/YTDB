#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const defaultPort = 4371;
const hostedOrigin = "https://ytdb.theobourgeois.com";

function usage() {
  console.log(`YTDB ${packageJson.version}

Usage: npx @theobourgeois/ytdb [options]

Options:
  --port <number>  Local bridge port (default: ${defaultPort})
  --local          Open the UI directly on 127.0.0.1
  --no-open        Start without opening a browser
  --help, -h       Show this help
  --version, -v    Print the version`);
}

function optionValue(name) {
  const exact = process.argv.indexOf(name);
  if (exact !== -1) return process.argv[exact + 1];
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) { usage(); process.exit(0); }
if (process.argv.includes("--version") || process.argv.includes("-v")) { console.log(packageJson.version); process.exit(0); }

const port = Number(optionValue("--port") ?? defaultPort);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  console.error("YTDB: --port must be an integer between 1024 and 65535.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const buildId = join(packageRoot, ".next", "BUILD_ID");
if (!existsSync(buildId)) {
  console.error("YTDB: the production application is missing. Run `npm run build` first.");
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");
const fragment = `token=${encodeURIComponent(token)}&port=${port}`;
const localOrigin = `http://127.0.0.1:${port}`;
const browserUrl = process.argv.includes("--local") ? `${localOrigin}/#${fragment}` : `${hostedOrigin}/#${fragment}`;

const child = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: packageRoot,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", YTDB_BRIDGE_TOKEN: token, YTDB_LOG_DIR: join(homedir(), ".ytdb", "activity") },
  stdio: "inherit",
});

let stopped = false;
child.once("exit", (code, signal) => {
  stopped = true;
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));

async function waitUntilReady() {
  for (let attempt = 0; attempt < 100 && !stopped; attempt += 1) {
    try {
      const response = await fetch(`${localOrigin}/api/health`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the local server did not become ready");
}

function openBrowser(url) {
  const command = platform() === "darwin" ? ["open", [url]] : platform() === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const opener = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
  opener.unref();
}

try {
  await waitUntilReady();
  console.log(`\nYTDB is ready: ${browserUrl}\n`);
  if (!process.argv.includes("--no-open")) openBrowser(browserUrl);
} catch (error) {
  if (!stopped) {
    console.error(`YTDB: ${error instanceof Error ? error.message : String(error)}.`);
    child.kill("SIGTERM");
    process.exitCode = 1;
  }
}

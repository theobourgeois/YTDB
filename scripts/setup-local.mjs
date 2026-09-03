import { execFileSync } from "node:child_process";
import { realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_PORT,
  DAEMON_LABEL,
  LOCAL_HOSTNAME,
  PROXY_PORT,
} from "./local-hostname.mjs";

const undo = process.argv.includes("--undo");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const proxyScript = join(repoRoot, "scripts", "local-proxy.mjs");
const nodePath = realpathSync(process.execPath);
const plistPath = `/Library/LaunchDaemons/${DAEMON_LABEL}.plist`;
const hostsLine = `127.0.0.1 ${LOCAL_HOSTNAME}`;

function applescriptString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function runAsAdmin(script) {
  const tmp = join(tmpdir(), `dbstudio-setup-${Date.now()}.sh`);
  writeFileSync(tmp, script, { mode: 0o755 });
  try {
    execFileSync(
      "osascript",
      [
        "-e",
        `do shell script ${applescriptString(`/bin/bash ${tmp}`)} with administrator privileges`,
      ],
      { stdio: "inherit" },
    );
  } finally {
    unlinkSync(tmp);
  }
}

function plist() {
  const args = [nodePath, proxyScript].map(
    (value) => `    <string>${escapeXml(value)}</string>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.join("\n")}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/${DAEMON_LABEL}.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/${DAEMON_LABEL}.log</string>
</dict>
</plist>
`;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (undo) {
  runAsAdmin(`set -euo pipefail
launchctl bootout system/${DAEMON_LABEL} 2>/dev/null || true
rm -f ${JSON.stringify(plistPath)}
if grep -qxF ${JSON.stringify(hostsLine)} /etc/hosts; then
  sed -i '' ${JSON.stringify(`/^${hostsLine.replaceAll(".", "\\.")}$/d`)} /etc/hosts
fi
`);
  console.log(`Removed ${LOCAL_HOSTNAME}.`);
  process.exit(0);
}

const tmpPlist = join(tmpdir(), `${DAEMON_LABEL}.plist`);
writeFileSync(tmpPlist, plist());

try {
  runAsAdmin(`set -euo pipefail
if ! grep -qxF ${JSON.stringify(hostsLine)} /etc/hosts; then
  printf '%s\\n' ${JSON.stringify(hostsLine)} >> /etc/hosts
fi
cp ${JSON.stringify(tmpPlist)} ${JSON.stringify(plistPath)}
chmod 644 ${JSON.stringify(plistPath)}
chown root:wheel ${JSON.stringify(plistPath)}
launchctl bootout system/${DAEMON_LABEL} 2>/dev/null || true
launchctl bootstrap system ${JSON.stringify(plistPath)}
launchctl enable system/${DAEMON_LABEL}
launchctl kickstart -k system/${DAEMON_LABEL}
`);
} finally {
  unlinkSync(tmpPlist);
}
console.log(`http://${LOCAL_HOSTNAME} → 127.0.0.1:${APP_PORT} (via :${PROXY_PORT})`);
console.log("Start the app with npm run dev, then open that URL.");

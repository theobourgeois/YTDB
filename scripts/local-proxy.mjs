import net from "node:net";
import { APP_PORT, LOCAL_HOSTNAME, PROXY_PORT } from "./local-hostname.mjs";

const TARGET_HOST = "127.0.0.1";

const OFFLINE = Buffer.from(
  [
    "HTTP/1.1 502 Bad Gateway",
    "Content-Type: text/html; charset=utf-8",
    "Connection: close",
    "",
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>DB Studio</title>
    <style>
      body { margin: 0; min-height: 100dvh; display: grid; place-items: center;
        font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; background: #0c0c0c; color: #e8e8e8; }
      main { max-width: 28rem; padding: 2rem; }
      h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
      p { margin: 0; color: #a1a1a1; }
      code { font-family: ui-monospace, SFMono-Regular, monospace; color: #e8e8e8; }
    </style>
  </head>
  <body>
    <main>
      <h1>DB Studio isn’t running</h1>
      <p>Start it with <code>npm run dev</code>, then reload <code>${LOCAL_HOSTNAME}</code>.</p>
    </main>
  </body>
</html>
`,
  ].join("\r\n"),
);

const server = net.createServer((client) => {
  const dest = net.connect(APP_PORT, TARGET_HOST);
  let connected = false;

  dest.on("connect", () => {
    connected = true;
    client.pipe(dest);
    dest.pipe(client);
  });

  dest.on("error", () => {
    if (connected || client.destroyed) {
      client.destroy();
      return;
    }
    client.end(OFFLINE);
  });

  dest.on("close", () => {
    if (connected) client.destroy();
  });

  client.on("error", () => dest.destroy());
  client.on("close", () => dest.destroy());
});

server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

server.listen(PROXY_PORT, TARGET_HOST, () => {
  console.log(`${LOCAL_HOSTNAME} → ${TARGET_HOST}:${APP_PORT}`);
});

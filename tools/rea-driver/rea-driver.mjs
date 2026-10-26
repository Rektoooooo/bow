// Minimal MCP stdio client that keeps one REA server (and its Ghidra session) alive between requests.
// REA's CLI starts a fresh Ghidra import for every command; this driver avoids that for large binaries.
//
// usage:   node tools/rea-driver/rea-driver.mjs <workDir>
//          (GHIDRA_INSTALL_DIR, JAVA_HOME, REA_GHIDRA_STARTUP_TIMEOUT_MS, GHIDRA_HEADLESS_MAXMEM are passed through)
// request: write {"name": "<tool>", "arguments": {...}} to <workDir>/req/<id>.json  (rea-call.sh does this)
// reply:   <workDir>/res/<id>.json ; logs in <workDir>/driver.log and server.stderr.log ; tool list in tools.json
// stop:    touch <workDir>/req/STOP
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const work = process.argv[2];
if (!work) {
  console.error("usage: node rea-driver.mjs <workDir>");
  process.exit(2);
}
const reqDir = path.join(work, "req");
const resDir = path.join(work, "res");
fs.mkdirSync(reqDir, { recursive: true });
fs.mkdirSync(resDir, { recursive: true });
const log = fs.createWriteStream(path.join(work, "driver.log"), { flags: "a" });
const say = (message) => log.write(`[${new Date().toISOString()}] ${message}\n`);

const server = spawn("npx", ["-y", "rea-agents@6.8.0", "mcp"], {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});
server.stderr.on("data", (chunk) => fs.appendFileSync(path.join(work, "server.stderr.log"), chunk));
server.on("exit", (code) => { say(`server exited ${code}`); process.exit(code ?? 1); });

let nextId = 1;
const pending = new Map();
let buffer = "";
server.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { say(`unparsed: ${line.slice(0, 200)}`); continue; }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message); }
    } else if (message.method && message.id !== undefined) {
      // Server-to-client request (roots, sampling, elicitation): answer roots, decline the rest.
      const reply = message.method === "roots/list"
        ? { jsonrpc: "2.0", id: message.id, result: { roots: [] } }
        : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not supported by driver" } };
      server.stdin.write(JSON.stringify(reply) + "\n");
    } else if (message.method && message.method !== "notifications/progress") {
      say(`notify ${message.method}`);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve) => pending.set(id, resolve));
}

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "rea-driver", version: "1.0.0" },
});
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
say(`initialized: ${JSON.stringify(init.result?.serverInfo ?? init.error)}`);
const tools = await rpc("tools/list", {});
fs.writeFileSync(path.join(work, "tools.json"), JSON.stringify(tools.result ?? tools.error, null, 1));
say(`tools: ${tools.result?.tools?.length}`);

const busy = new Set();
setInterval(() => {
  for (const file of fs.readdirSync(reqDir)) {
    if (file === "STOP") { say("stop requested"); server.kill("SIGTERM"); return; }
    if (!file.endsWith(".json") || busy.has(file)) continue;
    busy.add(file);
    const id = file.replace(/\.json$/, "");
    const { name, arguments: args } = JSON.parse(fs.readFileSync(path.join(reqDir, file), "utf8"));
    const started = Date.now();
    say(`call ${id} ${name}`);
    rpc("tools/call", { name, arguments: args ?? {} }).then((message) => {
      const out = { elapsed_ms: Date.now() - started, ...message };
      fs.writeFileSync(path.join(resDir, file + ".tmp"), JSON.stringify(out, null, 1));
      fs.renameSync(path.join(resDir, file + ".tmp"), path.join(resDir, file));
      fs.renameSync(path.join(reqDir, file), path.join(reqDir, file + ".done"));
      busy.delete(file);
      say(`done ${id} in ${out.elapsed_ms} ms`);
    });
  }
}, 500);

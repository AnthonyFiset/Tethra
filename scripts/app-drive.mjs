#!/usr/bin/env node
/**
 * Drive the REAL Tethra app (Tauri dev or debug build) from the command line.
 *
 * The UI's dev-only bridge (apps/ui/src/dev/bridge.ts) long-polls this
 * server for JS jobs and posts results back. This gives a scriptable eye
 * on WKWebView + tmux + real PTYs — the layer the mock harness cannot see.
 *
 *   node scripts/app-drive.mjs serve            # run the driver (keep open)
 *   node scripts/app-drive.mjs eval 'return dev.sessions()'
 *   node scripts/app-drive.mjs snapshot [sessionId] [scrollbackRows]
 *   node scripts/app-drive.mjs shot [out.png]   # window screenshot (needs
 *                                               #   Screen Recording permission)
 *   node scripts/app-drive.mjs keys 'text'      # native keystrokes via
 *                                               #   System Events (Accessibility)
 *   node scripts/app-drive.mjs status
 *
 * Inside `eval`, `dev` is the bridge API: sessions(), term(id), snapshot(id),
 * blocks(id), chrome(id), key(k), type(text), click(sel), clickText(text),
 * layout().
 */
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 47811;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const [, , cmd = "status", ...rest] = process.argv;

if (cmd === "serve") serve();
else if (cmd === "eval") await client("/eval", rest.join(" "));
else if (cmd === "snapshot") {
  const [id, back = "0"] = rest;
  const js = id
    ? `return dev.snapshot(${JSON.stringify(id)}, { scrollback: ${Number(back)} })`
    : `return dev.sessions().map((s) => dev.snapshot(s, { scrollback: ${Number(back)} }))`;
  await client("/eval", js);
} else if (cmd === "shot") await client("/shot", rest[0] ?? "");
else if (cmd === "keys") await client("/keys", rest.join(" "));
else if (cmd === "status") await client("/status", "");
else {
  console.error("unknown command", cmd);
  process.exit(2);
}

async function client(route, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${route}`, {
    method: "POST",
    body,
  }).catch((e) => {
    console.error(
      `driver not running (${e.message}) — start: node scripts/app-drive.mjs serve`,
    );
    process.exit(1);
  });
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.value === "string") {
      try {
        parsed.value = JSON.parse(parsed.value);
      } catch {
        // keep string
      }
    }
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(text);
  }
  if (!res.ok) process.exit(1);
}

function serve() {
  const queue = [];
  const waiters = []; // pending /poll responses from the app
  const results = new Map(); // id -> resolve
  let lastPoll = 0;
  let seq = 0;

  const readBody = (req) =>
    new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });

  const dispatch = () => {
    while (queue.length && waiters.length) {
      const job = queue.shift();
      const res = waiters.shift();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(job));
    }
  };

  const submit = (js, timeoutMs = 20000) =>
    new Promise((resolve) => {
      const id = `job-${++seq}`;
      const timer = setTimeout(() => {
        results.delete(id);
        resolve({
          ok: false,
          value: `timeout after ${timeoutMs}ms (app connected: ${connected()})`,
        });
      }, timeoutMs);
      results.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      queue.push({ id, js });
      dispatch();
    });

  const connected = () => Date.now() - lastPoll < 30000;

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url === "/poll") {
      lastPoll = Date.now();
      waiters.push(res);
      req.on("close", () => {
        const i = waiters.indexOf(res);
        if (i >= 0) waiters.splice(i, 1);
      });
      setTimeout(() => {
        const i = waiters.indexOf(res);
        if (i >= 0) {
          waiters.splice(i, 1);
          res.writeHead(204);
          res.end();
        }
      }, 25000);
      dispatch();
      return;
    }
    const body = await readBody(req);
    if (url === "/result") {
      const r = JSON.parse(body || "{}");
      results.get(r.id)?.(r);
      results.delete(r.id);
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          connected: connected(),
          lastPollAgoMs: Date.now() - lastPoll,
        }),
      );
      return;
    }
    if (url === "/eval") {
      const r = await submit(body);
      res.writeHead(r.ok ? 200 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify(r));
      return;
    }
    if (url === "/shot") {
      const r = screenshot(body.trim());
      res.writeHead(r.ok ? 200 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify(r));
      return;
    }
    if (url === "/keys") {
      const r = nativeKeys(body);
      res.writeHead(r.ok ? 200 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify(r));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`app-drive listening on 127.0.0.1:${PORT}`);
  });
}

function windowId() {
  const dir = mkdtempSync(path.join(tmpdir(), "tethra-winid-"));
  const src = path.join(dir, "winid.swift");
  const bin = path.join(HERE, ".winid");
  if (!existsSync(bin)) {
    writeFileSync(
      src,
      `import CoreGraphics
import Foundation
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
for w in list {
  let owner = w["kCGWindowOwnerName"] as? String ?? ""
  let id = w["kCGWindowNumber"] as? Int ?? 0
  let layer = w["kCGWindowLayer"] as? Int ?? 0
  let b = w["kCGWindowBounds"] as? [String: Any] ?? [:]
  let wd = b["Width"] as? Int ?? 0
  if layer == 0 && owner.lowercased() == "tethra" && wd > 200 { print(id); break }
}
`,
    );
    execFileSync("swiftc", ["-O", src, "-o", bin], { stdio: "pipe" });
  }
  const out = execFileSync(bin, { encoding: "utf8" }).trim();
  return out ? Number(out) : null;
}

function screenshot(outPath) {
  try {
    const id = windowId();
    if (!id) return { ok: false, value: "no Tethra window on screen" };
    const file = outPath || path.join(tmpdir(), `tethra-${Date.now()}.png`);
    const r = spawnSync("screencapture", ["-x", "-o", "-l", String(id), file], {
      encoding: "utf8",
    });
    if (r.status !== 0 || !existsSync(file)) {
      return {
        ok: false,
        value: `screencapture failed (${(r.stderr || "").trim()}) — grant Screen Recording to the terminal app in System Settings › Privacy & Security`,
      };
    }
    return { ok: true, value: file, windowId: id };
  } catch (e) {
    return { ok: false, value: String(e) };
  }
}

function nativeKeys(text) {
  const esc = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `tell application "System Events"
  set frontmost of first process whose name is "tethra" to true
  delay 0.15
  keystroke "${esc}"
end tell`;
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  if (r.status !== 0) {
    return {
      ok: false,
      value: `osascript: ${(r.stderr || "").trim()} — grant Accessibility to the terminal app`,
    };
  }
  return { ok: true, value: "sent" };
}

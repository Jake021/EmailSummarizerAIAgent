import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ROOT } from "./env.js";
import { runDigest } from "./digest.js";
import { loadDigests, saveDigest } from "./store.js";

const PORT = Number(process.env.DASHBOARD_PORT ?? 4545);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const PAGE = path.join(ROOT, "public", "index.html");
const FAVICON = path.join(ROOT, "public", "favicon.svg");

const state = { running: false, startedAt: null, lastRunAt: null, lastError: null, lastNote: null };

function providers() {
  return (process.env.DIGEST_PROVIDERS ?? "outlook").split(",").map((s) => s.trim()).filter(Boolean);
}

function startRefresh() {
  if (state.running) return false;
  state.running = true;
  state.startedAt = Date.now();
  state.lastError = null;
  state.lastNote = null;
  runDigest({
    providers: providers(),
    days: Number(process.env.DIGEST_DAYS ?? 1),
    max: Number(process.env.DIGEST_MAX ?? 20),
    includeRead: false,
    interactive: false, // never block waiting for a sign-in prompt
  })
    .then((d) => {
      if (d.emailCount > 0) saveDigest(d);
      else state.lastNote = "No unread emails in the window, nothing to summarize.";
      if (d.errors.length) state.lastError = d.errors.join(" | ");
    })
    .catch((e) => {
      state.lastError = e.message;
    })
    .finally(() => {
      state.running = false;
      state.lastRunAt = Date.now();
    });
  return true;
}

function send(res, code, body, type = "application/json") {
  res.writeHead(code, {
    "Content-Type": type + "; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  // Block DNS-rebinding and cross-site requests: only our own origin may talk to us.
  if (!HOSTS.has(req.headers.host)) return send(res, 403, { error: "forbidden" });
  if (req.method === "POST") {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, { error: "forbidden" });
  }

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'",
    });
    return res.end(fs.readFileSync(PAGE));
  }
  if (req.method === "GET" && (pathname === "/favicon.svg" || pathname === "/favicon.ico")) {
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" });
    return res.end(fs.readFileSync(FAVICON));
  }
  if (req.method === "GET" && pathname === "/api/digests") return send(res, 200, loadDigests());
  if (req.method === "GET" && pathname === "/api/status") {
    return send(res, 200, { ...state, providers: providers() });
  }
  if (req.method === "POST" && pathname === "/api/refresh") {
    return send(res, 202, { started: startRefresh() });
  }
  send(res, 404, { error: "not found" });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log(`Dashboard already running on port ${PORT}.`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
});

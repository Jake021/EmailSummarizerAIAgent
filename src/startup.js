// Run by a Claude Code SessionStart hook. Returns immediately (detaches a worker)
// so it never delays Claude starting. The worker:
//   1. starts the dashboard server if it isn't running
//   2. refreshes the digest only if the newest one is older than STALE_HOURS
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT } from "./env.js";

const PORT = Number(process.env.DASHBOARD_PORT ?? 4545);
const STALE_HOURS = Number(process.env.STALE_HOURS ?? 8);
const BASE = `http://127.0.0.1:${PORT}`;
const SELF = fileURLToPath(import.meta.url);
const SERVER = fileURLToPath(new URL("./server.js", import.meta.url));

function detach(script, args = []) {
  spawn(process.execPath, [script, ...args], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

if (!process.argv.includes("--worker")) {
  detach(SELF, ["--worker"]);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, init) {
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
async function isUp() {
  try {
    await api("/api/status");
    return true;
  } catch {
    return false;
  }
}

if (!(await isUp())) {
  detach(SERVER);
  for (let i = 0; i < 20 && !(await isUp()); i++) await sleep(250);
}

try {
  const [latest] = await api("/api/digests");
  const ageHours = latest ? (Date.now() - new Date(latest.id).getTime()) / 3600_000 : Infinity;
  if (ageHours >= STALE_HOURS) await api("/api/refresh", { method: "POST" });
} catch {
  /* dashboard not reachable; nothing to do */
}

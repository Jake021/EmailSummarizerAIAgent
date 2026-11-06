import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.js";

const DIR = path.join(ROOT, "data");
const FILE = path.join(DIR, "digests.json");
const KEEP = 60;

/** Newest first. */
export function loadDigests() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

export function saveDigest(digest) {
  fs.mkdirSync(DIR, { recursive: true });
  const all = [digest, ...loadDigests()].slice(0, KEEP);
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, FILE); // atomic replace
}

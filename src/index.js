import fs from "node:fs";
import { parseArgs } from "node:util";
import "./env.js";
import { getAuth } from "./gmail.js";
import { getOutlookAuth } from "./outlook.js";
import { runDigest, toMarkdown } from "./digest.js";
import { saveDigest } from "./store.js";

const { values } = parseArgs({
  options: {
    provider: { type: "string", short: "p", default: process.env.DIGEST_PROVIDERS ?? "outlook" },
    days: { type: "string", short: "d", default: "1" },
    "include-read": { type: "boolean", default: false },
    query: { type: "string", short: "q" }, // Gmail only: overrides --days/--include-read
    max: { type: "string", short: "n", default: "20" },
    save: { type: "boolean", default: false }, // also write a digest-YYYY-MM-DD.md file
    "auth-only": { type: "boolean", default: false },
  },
});

const providers = values.provider.split(",").map((s) => s.trim()).filter(Boolean);

if (values["auth-only"]) {
  for (const p of providers) {
    if (p === "outlook") await (await getOutlookAuth())();
    else if (p === "gmail") await getAuth();
    else throw new Error(`Unknown provider "${p}"`);
    console.log(`${p} authorized.`);
  }
  process.exit(0);
}

console.log(`Fetching up to ${values.max} emails from: ${providers.join(", ")}`);
const digest = await runDigest({
  providers,
  days: Number(values.days),
  max: Number(values.max),
  includeRead: values["include-read"],
  query: values.query,
  interactive: true,
});

for (const e of digest.errors) console.error(`! ${e}`);
if (digest.emailCount === 0) {
  console.log("No matching emails.");
  process.exit(digest.errors.length ? 1 : 0);
}

saveDigest(digest); // shows up in the dashboard too
const md = toMarkdown(digest);
console.log(`\nSummarized ${digest.emailCount} emails.\n\n${md}`);

if (values.save) {
  const file = `digest-${new Date().toISOString().slice(0, 10)}.md`;
  fs.writeFileSync(file, md);
  console.log(`Saved ${file}`);
}

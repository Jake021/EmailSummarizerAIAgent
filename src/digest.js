import "./env.js";
import { getAuth, fetchEmails } from "./gmail.js";
import { getOutlookAuth, fetchOutlookEmails } from "./outlook.js";
import { summarizeEmails, MODEL } from "./summarize.js";

/** Collect emails from each provider; one failing provider doesn't stop the others. */
export async function collectEmails({ providers, days, max, includeRead, query, interactive }) {
  const emails = [];
  const errors = [];
  for (const p of providers) {
    try {
      if (p === "outlook") {
        const getToken = await getOutlookAuth({ interactive });
        const list = await fetchOutlookEmails(getToken, { days, includeRead, max });
        emails.push(...list.map((e) => ({ ...e, provider: "outlook" })));
      } else if (p === "gmail") {
        const auth = await getAuth({ interactive });
        const q = query ?? `${includeRead ? "" : "is:unread "}newer_than:${days}d`;
        const list = await fetchEmails(auth, { query: q, max });
        emails.push(...list.map((e) => ({ ...e, provider: "gmail" })));
      } else {
        throw new Error(`Unknown provider "${p}"`);
      }
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  return { emails, errors };
}

/** Fetch + summarize. Returns a digest entry ready to store and render. */
export async function runDigest(opts) {
  const { emails, errors } = await collectEmails(opts);
  const base = {
    id: new Date().toISOString(),
    providers: opts.providers,
    model: MODEL,
    emailCount: emails.length,
    errors,
  };
  if (emails.length === 0) return { ...base, overview: "No matching emails.", items: [] };

  const result = await summarizeEmails(emails);
  const seen = new Set();
  const items = [];
  for (const it of result.items) {
    const e = emails[it.index - 1];
    if (!e || seen.has(it.index)) continue; // ignore invalid or duplicate indexes
    seen.add(it.index);
    items.push({
      category: it.category,
      summary: it.summary,
      deadline: it.deadline,
      verdict: it.verdict,
      reason: it.reason,
      suspicious: it.verdict === "spam" || it.verdict === "phishing", // kept for older dashboards
      inJunk: !!e.inJunk,
      from: e.from,
      subject: e.subject,
      date: e.date,
      link: e.link ?? "",
      provider: e.provider,
    });
  }
  return { ...base, overview: result.overview, items };
}

const TITLES = { attention: "Needs your attention", fyi: "FYI", low: "Low priority", spam: "Spam & phishing" };
const isSpam = (i) => i.verdict === "spam" || i.verdict === "phishing" || (!i.verdict && i.suspicious);
const sectionOf = (i) => (isSpam(i) ? "spam" : i.category);

export function toMarkdown(d) {
  const out = [d.overview, ""];
  for (const cat of ["attention", "fyi", "low", "spam"]) {
    const list = d.items.filter((i) => sectionOf(i) === cat);
    if (!list.length) continue;
    out.push(`## ${TITLES[cat]}`);
    for (const i of list) {
      const flags = [
        i.verdict === "phishing" ? "PHISHING" : i.verdict === "spam" ? "spam" : "",
        i.reason || "",
        i.deadline ? `due: ${i.deadline}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      out.push(`- **${i.from} - ${i.subject}**: ${i.summary}${flags ? ` (${flags})` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}

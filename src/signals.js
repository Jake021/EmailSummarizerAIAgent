// Objective spam/phishing evidence extracted from message headers. Header values are
// attacker-controlled, so only fixed enums and a length-limited domain are passed on.
const domainOf = (s) => (String(s ?? "").match(/@([A-Za-z0-9.-]{1,80})/)?.[1] ?? "").toLowerCase();

export function buildSignals({ authResults = "", from = "", replyTo = "", junk = false }) {
  const parts = [];
  if (junk) parts.push("folder: Junk (the mail provider's own filter put it there)");
  for (const k of ["spf", "dkim", "dmarc"]) {
    const m = authResults.match(new RegExp(`\\b${k}=(pass|fail|softfail|neutral|none|temperror|permerror)`, "i"));
    parts.push(`${k.toUpperCase()}: ${m ? m[1].toLowerCase() : "unknown"}`);
  }
  const fd = domainOf(from);
  const rd = domainOf(replyTo);
  if (fd && rd && fd !== rd) parts.push(`Reply-To domain differs from sender (${rd})`);
  return parts.join("; ");
}

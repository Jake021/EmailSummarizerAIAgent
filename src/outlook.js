import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicClientApplication } from "@azure/msal-node";
import { buildSignals } from "./signals.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_PATH = path.join(ROOT, "msal-cache.json");
// Read-only: the agent can never send, delete, or modify mail.
const SCOPES = ["Mail.Read"];
const JUNK_MAX = 10; // also look at the most recent Junk-folder mail so it can be confirmed as spam

const cachePlugin = {
  async beforeCacheAccess(ctx) {
    if (fs.existsSync(CACHE_PATH)) ctx.tokenCache.deserialize(fs.readFileSync(CACHE_PATH, "utf8"));
  },
  async afterCacheAccess(ctx) {
    if (ctx.cacheHasChanged) fs.writeFileSync(CACHE_PATH, ctx.tokenCache.serialize());
  },
};

/** Returns a function that yields a valid access token (refreshing silently when possible). */
export async function getOutlookAuth({ interactive = true } = {}) {
  const clientId = process.env.MS_CLIENT_ID;
  if (!clientId) throw new Error("Missing MS_CLIENT_ID in .env. See README.md (Outlook setup).");

  const pca = new PublicClientApplication({
    auth: {
      clientId,
      // "common" supports personal Outlook.com and work/school accounts.
      authority: `https://login.microsoftonline.com/${process.env.MS_TENANT ?? "common"}`,
    },
    cache: { cachePlugin },
  });

  return async () => {
    const accounts = await pca.getTokenCache().getAllAccounts();
    if (accounts.length > 0) {
      try {
        return (await pca.acquireTokenSilent({ account: accounts[0], scopes: SCOPES })).accessToken;
      } catch {
        /* fall through to interactive sign-in */
      }
    }
    if (!interactive) {
      throw new Error("Outlook sign-in needed. Run: npm run auth -- --provider outlook");
    }
    const result = await pca.acquireTokenByDeviceCode({
      scopes: SCOPES,
      deviceCodeCallback: (r) => console.log(`\n${r.message}\n`),
    });
    return result.accessToken;
  };
}

async function fetchFolder(token, folder, { since, includeRead, top }) {
  const filter = `receivedDateTime ge ${since}` + (includeRead ? "" : " and isRead eq false");
  const url =
    `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?` +
    new URLSearchParams({
      $top: String(top),
      $select: "id,subject,from,receivedDateTime,body,webLink,internetMessageHeaders",
      $filter: filter,
      $orderby: "receivedDateTime desc",
    });
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
  });
  if (!res.ok) throw new Error(`Graph API ${res.status}: ${await res.text()}`);
  return (await res.json()).value;
}

/** Fetch recent Inbox (+ some Junk) messages, normalized to the same shape as the Gmail provider. */
export async function fetchOutlookEmails(getToken, { days, includeRead, max }) {
  const token = await getToken();
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const [inbox, junk] = await Promise.all([
    fetchFolder(token, "inbox", { since, includeRead, top: max }),
    fetchFolder(token, "junkemail", { since, includeRead, top: Math.min(max, JUNK_MAX) }),
  ]);

  const normalize = (m, inJunk) => {
    const headers = m.internetMessageHeaders ?? [];
    const named = (n) => headers.filter((h) => h.name.toLowerCase() === n).map((h) => h.value);
    const from = m.from?.emailAddress
      ? `${m.from.emailAddress.name} <${m.from.emailAddress.address}>`
      : "";
    return {
      id: m.id,
      from,
      subject: m.subject || "(no subject)",
      date: m.receivedDateTime,
      body: (m.body?.content ?? "").trim(),
      link: m.webLink ?? "",
      inJunk,
      signals: buildSignals({
        authResults: named("authentication-results").join(" "),
        from,
        replyTo: named("reply-to")[0] ?? "",
        junk: inJunk,
      }),
    };
  };

  return [...inbox.map((m) => normalize(m, false)), ...junk.map((m) => normalize(m, true))].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
}

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { google } from "googleapis";
import { buildSignals } from "./signals.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CREDENTIALS_PATH = path.join(ROOT, "credentials.json");
const TOKEN_PATH = path.join(ROOT, "token.json");
// Read-only: the agent can never send, delete, or modify mail.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const REDIRECT_PORT = 53682;

function loadClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing ${CREDENTIALS_PATH}. See README.md step 1 to download it from Google Cloud Console.`
    );
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const c = raw.installed ?? raw.web;
  return new google.auth.OAuth2(
    c.client_id,
    c.client_secret,
    `http://localhost:${REDIRECT_PORT}`
  );
}

function openBrowser(url) {
  exec(`start "" "${url}"`); // Windows
}

function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.end(code ? "Authorized. You can close this tab." : `Error: ${error}`);
      server.close();
      code ? resolve(code) : reject(new Error(error ?? "No code returned"));
    });
    server.listen(REDIRECT_PORT);
  });
}

export async function getAuth({ interactive = true } = {}) {
  const client = loadClient();
  if (fs.existsSync(TOKEN_PATH)) {
    client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")));
    return client;
  }
  if (!interactive) {
    throw new Error("Gmail sign-in needed. Run: npm run auth -- --provider gmail");
  }
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
  console.log("Opening browser to authorize read-only Gmail access...");
  console.log(`If it doesn't open, visit:\n${url}\n`);
  const codePromise = waitForCode();
  openBrowser(url);
  const { tokens } = await client.getToken(await codePromise);
  client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log("Saved token.json");
  return client;
}

function decode(data) {
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function extractBody(payload) {
  let plain = "";
  let html = "";
  (function walk(part) {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data) plain += decode(part.body.data);
    else if (part.mimeType === "text/html" && part.body?.data) html += decode(part.body.data);
    (part.parts ?? []).forEach(walk);
  })(payload);
  return plain.trim() || stripHtml(html);
}

/** Fetch up to `max` messages matching a Gmail search query. */
export async function fetchEmails(auth, { query, max }) {
  const gmail = google.gmail({ version: "v1", auth });
  const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: max });
  const ids = (list.data.messages ?? []).map((m) => m.id);

  const emails = [];
  for (const id of ids) {
    const { data } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const h = Object.fromEntries(
      (data.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value])
    );
    emails.push({
      id,
      from: h.from ?? "",
      subject: h.subject ?? "(no subject)",
      date: h.date ?? "",
      body: extractBody(data.payload),
      link: `https://mail.google.com/mail/u/0/#inbox/${id}`,
      signals: buildSignals({
        authResults: h["authentication-results"] ?? "",
        from: h.from ?? "",
        replyTo: h["reply-to"] ?? "",
      }),
    });
  }
  return emails;
}

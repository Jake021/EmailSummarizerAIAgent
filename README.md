# Email Summarizer

Reads your Gmail (**read-only** scope, it can't send, delete or modify anything) and has Claude write a prioritized digest.

## Setup

### 1. Gmail credentials (one time)
1. Go to https://console.cloud.google.com/ and create a project.
2. **APIs & Services → Library** → enable **Gmail API**.
3. **APIs & Services → OAuth consent screen** → External, add your Gmail address as a **test user**.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**.
5. Download the JSON, save it here as `credentials.json`.

### 1b. Outlook credentials (one time, if using Outlook)
1. Go to https://entra.microsoft.com → **App registrations → New registration**.
2. Supported account types: **"Accounts in any organizational directory and personal Microsoft accounts"**.
3. After creating it, open **Authentication → Advanced settings** and set **Allow public client flows** to **Yes**. Save.
4. **API permissions → Add → Microsoft Graph → Delegated → `Mail.Read`**. (Work accounts may need admin consent.)
5. Copy the **Application (client) ID** into `.env` as `MS_CLIENT_ID`.

Then run `npm run auth -- --provider outlook`. It prints a code and a URL; sign in there once. The token is cached in `msal-cache.json`.

### 2. Anthropic key
Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` (from https://console.anthropic.com/).

### 3. Authorize and run
```bash
npm run auth     # opens browser once; saves token.json
npm start        # summarizes unread mail from the last day
```

## Dashboard
```bash
npm run dashboard      # http://localhost:4545
```
Shows the latest digest as cards (needs attention / FYI / low priority), with search, history, spam/phishing flags, deadlines, and an **Open** link to each email. The **Refresh** button fetches and re-summarizes.
It only listens on your own machine and rejects requests from other websites.

## Auto-start with Claude
A `SessionStart` hook in `~/.claude/settings.json` runs `src/startup.js` whenever a new Claude Code session starts. It starts the dashboard in the background and refreshes the digest only if the last one is older than `STALE_HOURS` (default 8), so opening Claude often doesn't cost extra. To turn it off, delete the `hooks` block from that file.

## Options
```bash
npm start -- --query "is:unread" --max 30 --save
npm start -- -q "from:boss@example.com newer_than:7d"
```
Outlook:
```bash
npm start -- --provider outlook                 # unread, last day
npm start -- -p outlook --days 7 --include-read # last week, read + unread
```
`--query` (Gmail only) accepts any Gmail search syntax; Outlook uses `--days` / `--include-read`. `--save` writes `digest-YYYY-MM-DD.md`.

## Notes
- Default model is `claude-opus-5-5`; set `CLAUDE_MODEL=claude-haiku-5-5` in `.env` for a much cheaper digest.
- Email bodies are capped at 6,000 characters each (marked `[body truncated]`).
- Email content is sent to Anthropic's API for summarization. Emails are treated as untrusted data in the prompt to resist prompt injection.
- `credentials.json`, `token.json` and `.env` are git-ignored. Don't share them.

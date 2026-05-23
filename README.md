# AI Gateway

A self-hosted gateway that lets you use **Claude Code**, **Codex**, and **Gemini CLI** via **Telegram** and **Email** — using your existing subscriptions, no API keys required.

Send a message to your Telegram bot or email your AI inbox. The gateway runs the CLI, captures the output, and replies. It maintains shared memory and per-channel conversation history across all three AIs.

```
Telegram / Email → AI Gateway → Claude / Codex / Gemini CLI → reply
```

---

## Features

- **Three AIs, one interface** — prefix with `claude:`, `codex:`, or `gemini:`. No prefix defaults to Claude.
- **Telegram bot** — webhook-based, instant replies, chunked for long responses
- **Email** — polls IMAP every 30 seconds, replies via SMTP. Subject = command, body = context.
- **Git operations** — pull, push, commit, diff, log on any configured repo
- **Shared memory** — one `memory.md` file all AIs read on every request. Save facts with `memory: <fact>`
- **Conversation history** — last 10 exchanges per channel, auto-compacted when long
- **Domain-restricted email** — only configured sender domains accepted
- **No API keys** — uses OAuth-authenticated CLIs (Claude Max, ChatGPT Plus, Google account)

---

## Requirements

- Linux server / LXC / VM with internet access
- Node.js 20+
- A public HTTPS URL (via reverse proxy — Nginx, Caddy, NPMplus, etc.)
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- **Codex CLI** — `npm install -g @openai/codex`
- **Gemini CLI** — `npm install -g @google/gemini-cli`
- A Telegram bot token (free, from @BotFather)
- An email account with IMAP/SMTP access (mailcow, Gmail, Fastmail, etc.)
- (Optional) GitHub SSH key for git operations

---

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/masternazz/ai-gateway.git /opt/ai-gateway
cd /opt/ai-gateway
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
nano .env
```

Fill in all values. See `.env.example` for descriptions of each variable.

### 3. Set up the AI CLIs

Each CLI uses OAuth — run these once and complete the browser flow:

```bash
# Claude Code (requires Claude Max subscription)
claude login

# Codex (requires ChatGPT Plus/Pro)
codex login --device-auth

# Gemini (requires Google account with Gemini access)
gemini auth
```

> Run all three, or just the ones you want to use. Unauthenticated CLIs will error on use.

### 4. Set up Telegram bot

1. Message **@BotFather** on Telegram → `/newbot`
2. Pick a name and username for your bot
3. Copy the token → paste into `.env` as `TELEGRAM_BOT_TOKEN`
4. Get your user ID from **@userinfobot** → paste as `TELEGRAM_ALLOWED_USER_ID`

### 5. Set up email

Create a dedicated mailbox for the gateway (e.g. `ai@yourdomain.com`). Fill in the IMAP/SMTP settings in `.env`.

If using mailcow, Gmail, or similar — just use the standard IMAP/SMTP credentials.

> **Tip:** Set up a server-side filter to only accept mail from your own domain so others can't trigger your AI.

### 6. Set up GitHub SSH key (optional — for git operations)

```bash
ssh-keygen -t ed25519 -f /opt/ai-gateway/.ssh/id_github_gateway -C "ai-gateway" -N ""
cat /opt/ai-gateway/.ssh/id_github_gateway.pub
```

Add the public key to: **GitHub → Settings → SSH and GPG keys → New SSH key**

Then add your repos to `.env`:
```
REPOS=my-docs:git@github.com:youruser/my-docs.git,my-site:git@github.com:youruser/my-site.git
```

### 7. Set up reverse proxy

The gateway needs a public HTTPS URL for the Telegram webhook. Point a subdomain at your server and proxy to port 3000.

**Nginx example:**
```nginx
server {
    listen 443 ssl;
    server_name ai-gateway.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Set `PUBLIC_URL=https://ai-gateway.example.com` in `.env`.

### 8. Run as a systemd service

```bash
cp ai-gateway.service /etc/systemd/system/ai-gateway.service
# Edit the service file if your install path differs from /opt/ai-gateway
systemctl daemon-reload
systemctl enable --now ai-gateway
journalctl -u ai-gateway -f
```

---

## Usage

### Telegram

Open a chat with your bot and send:

```
claude: explain what a subnet mask is
codex: write a python script to check disk usage
gemini: what's new in Node.js 22?
what is 2+2
```

No prefix defaults to Claude.

### Email

```
To: ai@yourdomain.com
Subject: claude: review this bash script
Body: #!/bin/bash
      df -h | awk '$5 > 80 {print $0}'
```

Subject = the command (with optional prefix). Body = additional context. Body is optional.

### Git operations

```
pull my-docs
push my-site
claude: pull my-docs and summarize the last 3 commits
```

Repos are cloned to `/opt/ai-gateway/repos/` on first use.

### Save a memory fact

```
memory: my server is running Ubuntu 24.04 on a Dell R720
memory: always use zsh not bash in examples
```

Facts are saved to `memory.md` and prepended to every prompt for all AIs.

### Edit memory directly

```bash
nano /opt/ai-gateway/memory.md
```

---

## How it works

```
Telegram message / Email
        │
        ▼
   parser.js          ← detects engine prefix, git ops, memory commands
        │
        ├─ git ops?   → git.js (clone/pull/push/commit/diff/log via simple-git)
        │
        ├─ memory?    → memory.js (append to memory.md, return confirmation)
        │
        └─ AI prompt  → memory.js (prepend memory.md + history)
                              │
                              ▼
                         runner.js   ← spawns CLI subprocess
                              │
                         ┌────┴────┐
                       claude    codex    gemini
                              │
                              ▼
                         reply.js    ← sends back via Telegram or SMTP
```

**Memory system:**
- `memory.md` — shared across all AIs and channels. Edit freely.
- `history/<channel>.json` — per-channel conversation log. Auto-compacted at 20 entries.

---

## File structure

```
/opt/ai-gateway/
├── src/
│   ├── index.js          # Express app, startup
│   ├── parser.js         # Parses engine prefix, git ops, memory commands
│   ├── runner.js         # Spawns AI CLI subprocesses
│   ├── git.js            # Git operations via simple-git
│   ├── email-poller.js   # IMAP polling and email processing
│   ├── telegram.js       # Telegram webhook handler
│   ├── reply.js          # Send email/Telegram responses
│   ├── memory.js         # Shared memory + conversation history
│   └── logger.js         # Winston logger
├── repos/                # Git repos cloned here
├── history/              # Per-channel conversation history (JSON)
├── memory.md             # Shared AI memory (edit this)
├── .env                  # Your config (never commit this)
├── .env.example          # Template
├── package.json
└── ai-gateway.service    # systemd service unit
```

---

## Supported AI CLIs

| AI | CLI Package | Subscription needed | Auth command |
|----|-------------|--------------------|----|
| Claude | `@anthropic-ai/claude-code` | Claude Max | `claude login` |
| Codex | `@openai/codex` | ChatGPT Plus/Pro | `codex login --device-auth` |
| Gemini | `@google/gemini-cli` | Google account | `gemini auth` |

You only need the ones you want to use. If a CLI isn't authenticated, requests to it will return an error message.

---

## Troubleshooting

**Telegram webhook not registering**
- Make sure `PUBLIC_URL` is set and publicly reachable over HTTPS
- Check logs: `journalctl -u ai-gateway -f`

**IMAP timeout / email not polling**
- Verify IMAP credentials in `.env`
- Check firewall — the server needs to reach your mail server on port 993
- Test: `openssl s_client -connect mail.example.com:993`

**AI CLI not found**
- Make sure the CLI is installed globally: `which claude`, `which codex`, `which gemini`
- Make sure it's authenticated: run the login command again

**Git push rejected**
- Make sure your SSH key is added to GitHub with write access to the repo
- Test: `ssh -i /opt/ai-gateway/.ssh/id_github_gateway -T git@github.com`

**Gemini: not running in a trusted directory**
- Make sure `GEMINI_CLI_TRUST_WORKSPACE=true` is in `.env`

---

## License

MIT

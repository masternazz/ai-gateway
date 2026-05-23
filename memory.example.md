# AI Gateway — Shared Memory
# All AIs (claude, codex, gemini) read this file on every request.
# Add facts via the bot: memory: <fact>
# Or edit this file directly.
#
# Lines starting with # are comments and will be included in the prompt —
# keep them or remove them as you prefer.

---

## About Me

- Name: Your Name
- Location: Your City
- GitHub: github.com/yourusername
- Role: (e.g. developer, student, sysadmin)
- Style preferences: (e.g. short answers, casual tone, always use Python 3)

---

## My Server / Homelab

- OS: (e.g. Debian 12)
- Server hostname: (e.g. myserver)
- Key services running: (e.g. nginx, docker, postgres)
- Network: (e.g. 192.168.1.0/24, gateway 192.168.1.1)

---

## Projects

- project-name: description and relevant context
- another-project: what it is, what stack, what stage

---

## Preferences

- Preferred shell: bash / zsh / fish
- Preferred language: Python / Node.js / Go / etc.
- Code style notes: (e.g. 2 spaces, single quotes, no semicolons)
- Things to avoid: (e.g. don't suggest Docker if I'm not using it)

---

## AI Gateway Info

- This service is running at: https://ai-gateway.example.com
- Git repos available: (list repo names configured in REPOS env var)
- CLIs authenticated: claude, gemini (codex pending)

# MNEMO — Install & troubleshooting

MNEMO is a **local-first desktop app**: the UI talks to a small API on your machine (`127.0.0.1:47831`) where API keys are stored **encrypted on disk**.

## Install

1. Download the installer for your OS from **[GitHub Releases](https://github.com/KumailQazi/MNEMO-AI-Memory-Engine/releases)**.
2. Install **Node.js 20+** and ensure `node` is on your PATH (`node -v` in Terminal or PowerShell).
3. Open MNEMO → **Settings** → pick provider → paste API key → **Save API key to server**.
4. Chat; use `/remember` and `/check` to manage memory (see [README](README.md)).

## Providers & keys

| Provider in app | Key shape | Notes |
|-----------------|-----------|--------|
| **Groq** | `gsk_…` | Not the same as Grok/xAI |
| **xAI (Grok)** | from [console.x.ai](https://console.x.ai) | Different from Groq |
| Anthropic, OpenAI, Google, Cerebras, OpenRouter | per vendor docs | Match provider to key |

If save fails with **Unauthorized**, quit MNEMO completely and reopen (refreshes session).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **MNEMO API is not running** (from Applications) | Install Node 20+; quit app and reopen. Ensure nothing else uses port **47831**. Use **v1.0.6+** (older builds had a broken bundled API). |
| **“Application is not supported on this Mac”** | Wrong DMG: Intel Mac needs `*_x64.dmg`, Apple Silicon needs `*_aarch64.dmg`. |
| Gatekeeper blocks open (macOS) | Right-click app → **Open** → confirm **Open**. |
| SmartScreen (Windows) | **More info → Run anyway** for unsigned builds. |
| Memory table stays empty after chat | Use `/remember last \| key-name` or `/remember key \| value`. Prefer **v1.0.9+**. |
| Groq key + “Grok” errors | Select **Groq** provider, not xAI. |
| Keys missing after reinstall | Keys live in OS app data (`MNEMO_DATA_DIR`); backup before wiping app data. |

## Privacy

API keys and memory stay on your machine. See [SECURITY.md](SECURITY.md).

## Source code

Application source is **not published** in this GitHub repository.

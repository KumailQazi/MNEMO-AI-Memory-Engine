# Security & Privacy

MNEMO is designed as a **local-first developer tool**. Read this before deploying or storing sensitive data.

## What stays on your device

- **Memory rows** and **chat history** — stored in browser **IndexedDB** (`mnemo` database).
- **Feature toggles** and **settings** — same IndexedDB store.
- **LLM API keys** (default mode) — stored **encrypted on disk** by the local MNEMO API server (`MNEMO_DATA_DIR`, AES-256-GCM). Keys are **not** kept in the browser when `VITE_MNEMO_BACKEND=true`.

Legacy browser-only mode (`npm run dev:browser`) stores keys in **localStorage** (`mnemo_api_keys`) — not recommended for production.

Nothing is sent to MNEMO servers (there are none). Export/copy actions use your clipboard locally.

## What leaves your device

When you send a chat message:

1. The React UI sends the request to the **local MNEMO API** (`127.0.0.1:47831` by default) with a session token.
2. The API loads the **provider API key from encrypted storage** and forwards the request to that provider (Anthropic, OpenAI, Google, xAI, Groq, Cerebras, or OpenRouter).
3. The assembled **system prompt includes your memory table** (filtered by pins, staleness, and smart retrieval settings).

The API server must bind to **localhost only** — do not expose port 47831 to the public internet without TLS and proper authentication.

## Local use only

The default setup is for **`npm run dev` or the Tauri desktop app on your machine**. Do **not** deploy this stack to a public URL without:

- Per-user authentication
- Server-side key vault (KMS)
- HTTPS and rate limiting

Hosting the stock build publicly exposes users to **API key theft** or **open proxy abuse**.

## API keys

- Use **restricted** or scoped keys where the provider allows it.
- Do not commit keys to git or share exported JSON that contains secrets.
- Back up `MNEMO_DATA_DIR` or set `MNEMO_ENCRYPTION_KEY` before reinstalling (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- Clear app data when using a shared computer.

## Session token

The local API issues a Bearer token (localhost-only `/api/v1/session` endpoint). The desktop/web UI stores it in **sessionStorage** for API calls. This is acceptable for a single-user local app; it is **not** multi-tenant security.

## Opt-in environment context (Séance mode)

When **enabled in Settings**, MNEMO may append battery level, time of day, and network quality hints to the **system prompt** sent to your LLM provider. Default is **off**.

## Experimental tools

`experimental/mnemos-sidecar.js` reads Claude Desktop local storage. It is **not** part of the main app, is **unsupported**, and may violate third-party terms of use. Do not run on work machines without explicit approval.

## Reporting issues

Open a GitHub issue for security concerns. Do not paste API keys or private memory exports in public tickets.

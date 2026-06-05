# MNEMO — GitHub Releases

Installers: [KumailQazi/MNEMO-AI-Memory-Engine/releases](https://github.com/KumailQazi/MNEMO-AI-Memory-Engine/releases)

## What each file is for

| OS | File | Use |
|----|------|-----|
| **macOS Apple Silicon** | `*_aarch64.dmg` | M1/M2/M3/M4 Macs |
| **macOS Intel** | `*_x64.dmg` | Core i5/i7/i9 Macs |
| **Windows** | `MNEMO_1.0.9_x64_en-US.msi` | Standard MSI installer |
| **Windows** | `MNEMO_1.0.9_x64-setup.exe` | EXE setup |
| **Linux** | `*_amd64.deb` | Debian/Ubuntu |
| **Linux** | `*_amd64.AppImage` | Portable AppImage |

Installers are **not cross-platform** — pick the file for your OS only.

## Requirements

- **Node.js 20+** on PATH at runtime (local MNEMO API)
- API keys from your chosen provider (BYOK)

## macOS architecture

Wrong DMG → *“application is not supported on this Mac”*. Check **Apple menu → About This Mac** for Intel vs Apple Silicon.

## Version history (high level)

| Tag | Notes |
|-----|--------|
| v1.0.9 | Memory commands, Groq/Cerebras, Windows installers, bundled API |
| v1.0.8 | API key auto-match (Groq vs Grok) |
| v1.0.7 | Groq + Cerebras providers |
| v1.0.6+ | Bundled local API in desktop app |
| v1.0.5+ | Intel + Apple Silicon DMGs |

## Source code

Application source is **not published** in this repository. This repo contains **documentation and release binaries** only.

GitHub auto-attaches **Source code (zip)** and **Source code (tar.gz)** to every release. Those archives contain **only** `README.md`, docs, and `public/` screenshots — **not** `src/`, `server/`, or `package.json`. Use the **installer assets** (`.dmg`, `.msi`, `.exe`, etc.) to install MNEMO.

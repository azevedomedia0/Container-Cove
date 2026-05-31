# The Loading Dock(r)

Run Docker containers as desktop apps — no terminal needed. Built with [Electrobun](https://electrobun.dev).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Podman](https://podman.io/docs/installation) (recommended; The Loading Dock(r) can open the install guide on first run and when the runtime is unavailable) or Docker Desktop / Docker Engine
- macOS (primary), Windows, or Linux

## Quick Start

```bash
bun install
bun start
```

## Quality Commands

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
```

## Build

```bash
bun run build:mac      # macOS .app
bun run build:win      # Windows
bun run build:linux    # Linux
```

---

## Features

| Feature | Details |
|---------|---------|
| **App launcher grid** | Search, drag-and-drop reorder, 72 px icon tiles with CDN images |
| **Recommended catalog** | 26+ curated self-hosted apps; one-click GET install with pre-filled env vars and volumes |
| **Docker lifecycle** | Launch / stop / restart containers; live log streaming; health badges; CPU/MEM metrics |
| **Compose import** | YAML → one app per service |
| **Embedded Web UI** | In-app iframe that auto-loads `openUrl` when container starts; or open in system browser |
| **Desktop shortcuts** | `.app` bundle created on `~/Desktop` on install; icon fetched from Dashboard Icons CDN |
| **System tray** | Per-app live status dots, click-to-launch, Stop All / Restart All |
| **Secrets** | OS keychain for sensitive env vars; masking in the detail view |
| **Dark / Light theme** | One-click sun/moon toggle; preference saved to `settings.json` |
| **Auto-updates** | One-click topbar chip; GitHub Releases stable/beta channels |
| **Open at Login** | macOS login item toggle in the settings footer |

---

## Registry & Settings

App definitions are stored in `apps.json` in the OS-native config directory:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/loading-dock/apps.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/loading-dock/apps.json` |
| Windows | `%APPDATA%/loading-dock/apps.json` |

Same folder also contains: `settings.json`, `metrics.json`, `errors.jsonl`.

App data volumes are stored under `~/.loading-dock/<app-name>/`.

---

## Release Channels

Use the **Channel** dropdown in the launcher footer (`stable` default, `beta` opt-in).

---

## Troubleshooting

- **Docker warning banner** — start Docker Desktop and reopen The Loading Dock(r).
- **Podman is unavailable** — open the install guide from the onboarding card or warning banner, install Podman, then click Retry.
- **Launch fails** — check the image name and host port conflicts (`host:container`, e.g. `8080:80`).
- **Web UI won't load** — ensure the container is **running** and `openUrl` matches your mapped port.
- **No health/metrics** — container must be running; Docker CLI must be reachable from Bun.
- **Reset apps** — delete `apps.json` from the path above and relaunch.
- **Desktop icon doesn't launch** — ensure The Loading Dock(r) is running; the shortcut connects via `localhost:42424`.

---

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md) | Versioned feature history |
| [docs/PROJECT_BOARD.md](docs/PROJECT_BOARD.md) | Milestones |
| [docs/QA_SIGNOFF.md](docs/QA_SIGNOFF.md) | Release sign-off checklist |
| [docs/RELEASE_OPERATIONS.md](docs/RELEASE_OPERATIONS.md) | Release process |
| [docs/CI.md](docs/CI.md) | CI & Windows E2E notes |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Performance targets |

---

## Project Structure

```
LoadingDock_R/
├── LICENSE
├── electrobun.config.ts
├── package.json
├── src/
│   ├── main/           Main process: windows, IPC, Docker, updater, tray
│   ├── renderer/
│   │   ├── launcher/   App grid, recommended catalog, settings footer
│   │   └── app-window/ Per-app Web UI iframe, logs, metrics, health
│   └── shared/         Types, validation
├── assets/icons/
└── docs/
```

---

## License

MIT © 2026 Steven Azevedo — see [LICENSE](LICENSE).

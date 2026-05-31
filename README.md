# Container Cove

Run Docker containers as desktop apps — no terminal needed. Built with [Electrobun](https://electrobun.dev).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- macOS (primary), Windows, or Linux
- **Podman is bundled with Container Cove** and auto-initializes on first launch (no manual setup required)
  - Alternatively, Docker Desktop or Docker Engine can be used if already installed

## Quick Start

```bash
bun install
bun start
```

On first launch, Container Cove shows a setup wizard to initialize Podman (one-time, ~2-3 minutes).

## Quality Commands

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
```

## Build

```bash
bun run build:dmg             # macOS .dmg (requires code signing)
bun run build:win-installer   # Windows .exe installer
bun run build:linux-appimage  # Linux AppImage
bun run build:linux-deb       # Linux .deb package
```

See [BUILD.md](docs/BUILD.md) for detailed build instructions and environment variables.

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
| macOS | `~/Library/Application Support/container-cove/apps.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/container-cove/apps.json` |
| Windows | `%APPDATA%/container-cove/apps.json` |

Same folder also contains: `settings.json`, `metrics.json`, `errors.jsonl`.

App data volumes are stored under `~/.container-cove/<app-name>/`.

---

## Release Channels

Use the **Channel** dropdown in the launcher footer (`stable` default, `beta` opt-in).

---

## Podman Distribution

Container Cove includes a bundled Podman binary for each platform. See [INSTALLATION.md](docs/INSTALLATION.md) for setup wizard details and platform-specific Podman initialization.

---

## Troubleshooting

- **Podman setup failed** — the setup wizard shows recovery options. Check [INSTALLATION.md](docs/INSTALLATION.md) troubleshooting section.
- **Docker warning banner** — start Docker Desktop and reopen Container Cove (Docker used as fallback if Podman unavailable).
- **Launch fails** — check the image name and host port conflicts (`host:container`, e.g. `8080:80`).
- **Web UI won't load** — ensure the container is **running** and `openUrl` matches your mapped port.
- **No health/metrics** — container must be running; Docker CLI or Podman must be reachable from Bun.
- **Reset apps** — delete `apps.json` from the path above and relaunch.
- **Desktop icon doesn't launch** — ensure Container Cove is running; the shortcut connects via `localhost:42424`.

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
ContainerCove/
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

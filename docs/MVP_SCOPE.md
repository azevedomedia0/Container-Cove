# Container Cove — Scope & Feature History

> Previously named **ElectroDocker**. Renamed to **Container Cove** in v1.1.

## Project Goal

Make common local Docker services feel like desktop apps that can be launched, stopped, and monitored without terminal commands.

---

## v0.1 — MVP (Initial Release)

The minimum feature set required to be useful:

- App launcher grid with service cards and runtime status badges
- Add / edit / remove app definitions
- Launch / stop containers and stream live logs
- Persist app registry across restarts (`apps.json`)
- Docker availability detection and onboarding guidance
- Docker Compose import (one app entry per service)

---

## v1.0 — Beta / Public Launch

Shipped beyond the original MVP scope:

- Embedded Web UI windows (iframe in app window) and system-browser fallback
- Search and status filters on the installed grid
- Resource metrics (CPU / MEM), health checks, auto-restart on unhealthy containers
- Auto-updates (stable / beta channels) via GitHub Releases
- Keychain secrets storage for sensitive env vars
- Recommended app catalogue (25+ curated self-hosted images)
- Local error log export (`errors.jsonl`)
- Drag-and-drop card reorder
- Virtual grid rendering for 500+ app lists

---

## v1.1 — UI & UX Overhaul

Full visual redesign:

- Renamed app to **Container Cove**; updated all identifiers to `container-cove`
- Cal Sans title font via Bunny Fonts CDN
- Custom app icon (whale + house) in topbar
- Custom Iconoir SVG buttons in toolbar (check updates, pull, push, add app)
- Docker Hub button moved to toolbar with label
- Section dropdowns with animated chevron arrows
- Installed apps redesigned as **vertical icon grid** — launch/stop by clicking the icon
- Recommended apps 2-column grid with live GET → installing animation (spinner, progress, ✓ Added)
- App icon images from Dashboard Icons CDN with gradient fallback
- Colored status indicators (Running / Offline / Error) with text + dot
- Settings gear per card (replaces Edit·Del); Delete moved to edit modal
- Stop and Restart buttons in the status row (running apps only)
- Transparent scrollbar styling
- IPC layer fixed for Electrobun ≥1.18.1 RPC envelope format
- App window: Web UI tab (iframe) + Logs tab with sidebar
- GitHub repository linked: https://github.com/azevedomedia0/container-cove
- MIT License added

---

## v1.2 — Settings, Integrations & Recommended Apps

- **Open at Login** toggle (macOS login item via osascript)
- **Dark / Light theme toggle** (sun/moon button, persisted in settings)
- **One-click topbar update chip** — replaces update banner with inline progress bar
- **Desktop shortcut icons** — `.app` bundles created on `~/Desktop` on install, icons fetched from CDN and converted to ICNS via `sips`
- **Tray menu** — live per-app colored dots (🟢/🟡/🔴), click-to-launch, Stop All / Restart All
- **Default env vars and volumes** for all 26 recommended apps (data persisted under `~/.container-cove/`)
- New recommended apps: Navidrome, Homebridge, Puter, Guacamole
- Tailscale moved to Self-hosted Essentials; all images pinned to `:latest`
- Registry loader hardened: missing `env`/`volumes`/`ports` in older `apps.json` default to safe empty values
- Accessibility: `aria-label` added to all interactive buttons

---

## Out Of Scope (all versions)

- Remote Docker hosts
- Kubernetes / container orchestration
- Team sync or cloud registry
- Remote crash telemetry (local `errors.jsonl` only)

---

## Success Criteria (original + updated)

- New users can launch at least one service in under 5 minutes
- Recommended apps install and start without any manual configuration
- Add/edit/remove actions are discoverable and validated
- Compose import works for typical development compose files
- Core quality gates pass: lint, format, typecheck, unit tests, build

## Target Platforms

- **macOS** (primary — arm64 and x86_64)
- Linux and Windows (supported)

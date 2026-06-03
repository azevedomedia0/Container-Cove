# Changelog — Container Cove

All notable changes are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> The project was originally named **ElectroDocker**; renamed to **Container Cove** in v1.1.0.

---

## [Unreleased]

---

## [1.2.0] — 2026-05-30

### Added
- **Dark / Light theme toggle** — sun/moon button in topbar; `theme` persisted in `settings.json`; `[data-theme="light"]` CSS overrides all design tokens.
- **One-click topbar update chip** — replaces the update banner; states: idle → checking → available (click to download) → downloading (inline progress bar + %) → ready (green "✓ Restart to apply").
- **Desktop shortcut icons** — `.app` bundle created on `~/Desktop` on app install; icon fetched from Dashboard Icons CDN and converted to ICNS via `sips`; removed on app delete.
- **Tray menu overhaul** — per-app colored dots (🟢/🟡/🔴), click-to-launch/open-window, Stop All, Restart All, Settings, Open Dashboard, Quit.
- **Default env vars and volumes** for all 26 recommended apps — data stored under `~/.container-cove/<app>`; media libraries map `~/Movies`, `~/Music`, `~/TV`, `~/Downloads`, `~/Pictures`.
- **Open at Login** toggle — macOS login item via `osascript`; persisted in `settings.json`.
- **New recommended apps** — Navidrome, Homebridge, Puter, Guacamole; all images pinned to `:latest`; Tailscale moved to Self-hosted Essentials.
- **`app:restart` IPC message** — stop + re-launch in a single action; used by Restart button and Restart All.
- **Stop button** in installed-app status row (running apps); settings gear uses custom SVG icon.
- **MIT License** — `LICENSE` file added (© 2026 Steven Azevedo).
- **Accessibility** — `aria-label` on every interactive button in the launcher.

### Changed
- `loadRegistry` defaults `env: {}`, `volumes: []`, `ports: []`, `tags: []` before spread — older `apps.json` entries without these fields no longer crash `Object.entries` / `for...of`.
- Update check button now shows "Checking…" chip state instead of a banner message.
- `broadcastSettingsState` includes `theme` field.

### Fixed
- `refreshGroupFilterOptions` was calling `getElementById("group-filter")` after the dropdown was removed — caused a null-reference crash in the `apps:list` IPC handler, silently preventing newly installed apps from appearing in the grid.
- Renderer → main IPC: switched from `webview.on("ipc-message", …)` (DOM event emitter, never fired for RPC messages) to `webview.rpc.addMessageListener("ipc-message", …)` (correct RPC dispatch path).

---

## [1.1.0] — 2026-05-25

### Added
- **App renamed** to **Container Cove**; all internal identifiers updated to `loading-dock`.
- **Custom app icon** (whale + house) in topbar; logo uses Cal Sans from Bunny Fonts.
- **Iconoir solid icon buttons** in toolbar (check for updates, pull, push, add app) with custom SVGs.
- **Docker Hub button** moved to toolbar with "Docker Hub" text label.
- **Recommended apps** — 2-column grid; live GET → installing animation (spinner + progress label + "✓ Added"); already-installed apps show "✓ Added" on load.
- **Direct GET install** — clicking GET on a recommended app fires `app:add` immediately without opening the Add modal.
- **Installed apps icon grid** — vertical card layout with 72 px icons from Dashboard Icons CDN; clicking the icon launches/stops the container.
- **Colored status indicators** — text label + dot for Running / Offline / Error / Starting / Stopping.
- **Settings gear** per installed-app card (replaces Edit + Del); Delete moved into the edit modal.
- **Restart button** in status row (running apps only).
- **Section dropdowns** with animated chevron arrows (collapse / expand Installed and Recommended Apps).
- **Transparent scrollbar** with semi-transparent thumb.
- **Sticky footer** — always visible while sections scroll.
- **`app:add` GET button** pre-fills env vars and volumes from the recommended-app definition.
- **App window Web UI tab** — primary view is an `<iframe>` that auto-loads `openUrl` when the container starts; Logs tab preserves existing sidebar + log panel.
- **GitHub repository** linked: https://github.com/Container-Cove/Container-Cove

### Changed
- Background colour updated to `#669bbc`; surface to `#02395a`.
- Status row settings button uses a custom orbital-ring SVG.
- `buildCardHTML` derives icon CDN slug from the image name; shows white `#fff` background instead of gradient.
- Recommended app cards are left-aligned with rounded hover animation.
- `statusFilter` hardcoded to `"all"` (dropdown removed); group filter dropdown removed.

### Fixed
- Renderer ↔ main IPC polyfill updated for Electrobun ≥ 1.18.1 — `ev.send` now wraps messages in `{type:"message", id, payload}` RPC envelope; `ev.on` unwraps incoming envelopes before dispatching.

---

## [1.0.0] — 2026-05-21

### Added
- **Embedded Web UI** — `BrowserWindow` for `openUrl`; "Open embedded" / "System browser" in app detail; "Web UI" button on launcher cards.
- **Launcher filters** — debounced search, status dropdown, group dropdown.
- **Release channel UI** — stable/beta dropdown in settings footer (persisted to `settings.json`).
- **Auto-restart on unhealthy** — after 3 consecutive unhealthy polls (~15 s), auto-restart (footer toggle).
- **Log level filter** — error / warn / info / system; download exports filtered view.
- **Local error reporting** — `errors.jsonl` in config directory; Export errors button; opt-out toggle.
- **Platform keychain integration** — `security` (macOS), DPAPI/PowerShell (Windows), `secret-tool`/libsecret (Linux); secrets resolved at launch, never written to `apps.json`.
- **Drag-and-drop reorder** — cards draggable; `app:reorder` persists `sortOrder`.
- **Env-var and Volume editors** in Add / Edit modals — dynamic key/value tables with per-row keychain toggle.
- **Update notification** — GitHub Releases check (24 h cooldown), progress bar, Install / Later buttons.
- **Native OS notifications** — unexpected errors/stops via `osascript` / `notify-send` / PowerShell toast.
- **Hub search cache** — in-memory `Map` deduplicates repeated queries.
- CI workflows: `.github/workflows/ci.yml` (lint → test → build matrix) and `release.yml` (tag-triggered artifact upload).

---

## [0.2.0] — 2026-05-21

### Added (since RC1)
- Keychain integration, `sortOrder` field, drag-and-drop reorder.
- Env-var and Volume editors in Add/Edit modals.
- Update notification banner with progress and Install/Later buttons.
- Auto-check on startup (24 h cooldown via `lastUpdateCheckAt`).
- Native OS notifications for unexpected container state changes.
- Hub search cache (`hubCache` Map).
- `renderer.ts` / `renderer.test.ts` for app-window pure logic (30 tests).
- CI and release workflow YAML.
- `scripts/release.sh` local helper; `RELEASE_NOTES.md`.

### Changed
- `CURRENT_VERSION` bumped to `0.2.0`.
- `launchApp` accepts optional `resolvedEnv` for keychain secrets.
- `broadcast` triggers real native notifications on error/stopped transitions.

---

## [0.2.0-rc.1] — 2026-05-21

### Added
- Update channel persistence (`releaseChannel`, `notificationsEnabled`, `secretsMaskingEnabled`, `keychainSecretsEnabled` in `settings.json`).
- Real updater: GitHub Releases API → download with progress → apply.
- Updater IPC messages (`update:check`, `update:available`, `update:not-available`, `update:download`, `update:download:progress`, `update:download:done`, `update:apply`, `update:state`).
- Virtual scroll for installed-app grid (> 80 apps → IntersectionObserver batch renderer).
- Extracted `filter.ts` and `metrics.ts` pure modules; 85 tests across 9 files.

### Fixed
- Group filter dropdown retained stale option list after all apps in a group were removed.

---

## [0.1.0] — 2026-05-01 — Initial Release

### Added
- Launcher window: app grid, search, status/group filters.
- App detail window: live logs, pull progress, health badge, metrics sparkline.
- Docker CLI integration: launch, stop, pull, health inspect, stats.
- App registry persisted to platform-appropriate config directory.
- Metrics history (7-day window, 5 000-point cap per app).
- Docker Compose import.
- Docker Hub browse and search with one-click install.
- Preset configurations for postgres, redis, minio.
- Secrets masking in the environment-variable list.
- Registry JSON export and import.
- System tray icon with Open/Quit menu.
- macOS Application menu.
- Release channel selector (stable / beta).

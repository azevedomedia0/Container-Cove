# Project Board And Milestones

## MVP Milestone

- [x] Core launcher UI and status badges
- [x] Docker launch/stop bridge
- [x] Registry persistence
- [x] First-run onboarding and Docker guidance
- [x] App management (add/edit/remove/search/filter)
- [x] Compose import

## Beta Milestone

- [x] Better health checks and restart policies (auto-restart after unhealthy streak; settings toggle)
- [x] Resource usage telemetry (CPU/mem history, sparklines, persisted metrics)
- [x] Improved logs UX (search, level filter, export filtered logs)
- [x] Error analytics and crash reporting (local `errors.jsonl`, export, process handlers; opt-out toggle)
- [x] More integration tests (health-recovery, error-report, ipc-integration, log level tests)

## v1.0 Milestone

- [x] Embedded app webviews (sandboxed `BrowserWindow` for `openUrl`; launcher + detail actions)
- [x] Auto-update strategy and release channels (GitHub Releases, stable/beta footer dropdown)
- [x] Performance tuning for large app sets (virtual scroll, debounced search, filter toolbar, documented QA targets)
- [x] Full docs and release checklist (`README`, `RELEASE_OPERATIONS`, `QA_SIGNOFF`, `CI`, `PERFORMANCE`)

## v1.1 — UI & UX Overhaul (shipped)

- [x] Renamed app to **Container Cove**
- [x] Cal Sans title font via Bunny Fonts
- [x] Custom app icon (whale + house) in topbar
- [x] Iconoir icon buttons in toolbar
- [x] Docker Hub button moved to toolbar with label
- [x] Section dropdowns with animated chevron arrows
- [x] Installed apps redesigned as vertical icon grid (launch/stop on icon click)
- [x] Recommended apps 2-column grid with live GET → installing animation
- [x] App icon images from Dashboard Icons CDN with gradient fallback
- [x] Colored status indicators (Running/Offline/Error)
- [x] Settings gear per card (replaces Edit·Del); Delete moved to edit modal
- [x] Restart button in status row (running apps only)
- [x] Scrollbar styled transparent
- [x] IPC layer fixed for Electrobun ≥1.18.1 RPC envelope format

## v1.2 — Settings & Recommended Apps (shipped)

- [x] Open at Login checkbox (macOS login item via osascript)
- [x] Auto check for updates toggle
- [x] Removed Local Error Log from footer
- [x] Added Navidrome, Homebridge, Puter, Guacamole to recommended apps
- [x] All recommended apps pinned to `:latest`
- [x] Tailscale moved to Self-hosted Essentials
- [x] Linked to GitHub — https://github.com/Container-Cove/Container-Cove

## v1.3 — Polish & Update Flow (shipped)

- [x] MIT license added to repository
- [x] Dark/light theme toggle
- [x] One-click update flow with progress in topbar

## v1.4 — UI Hardening & Consistency (shipped)

- [x] Harden Windows notification — Base64-encode PowerShell args to prevent injection via app names
- [x] Polish Podman install guidance — platform-aware hints for first-run vs. unavailable-runtime states
- [x] Redesign general settings — dark/light theme-aware, iOS-style toggles, cleaner layout
- [x] Update Tailscale and Nextcloud recommended-app icons to official URLs
- [x] Desktop shortcut creation progress popup — "Creating Desktop App | Please Wait…" while icon artwork is fetched
- [x] Installed Apps panel min-height — shows space for one card even when empty
- [x] Installed/desktop icons now match recommended app counterparts via `iconSlug` + `iconUrl`
- [x] App restart confirmation / undo toast — 3-second grace period with Undo button
- [x] App card density audit — tighter padding, smaller icons, fixed rec-card hover reflow
- [x] Onboarding modal density audit — tighter padding, smaller logo, cleaner step cards
- [x] Recommended apps panel max-height capped so it doesn't compress installed apps

## Up Next

## Next Steps

- [ ] Review launcher layouts on narrow screens after the recent section sizing changes
- [ ] Validate Windows notification Base64 flow on a real Windows build
- [x] Test desktop shortcut icon fetch + `.icns` generation end-to-end on a clean macOS install
- [ ] Consider onboarding video or animated GIF for first-run Podman setup
- [ ] Fix General Settings UI Design

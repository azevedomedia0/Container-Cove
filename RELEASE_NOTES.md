# Container Cove v0.2.0

## Highlights

- **Real auto-updater** — checks GitHub Releases on launch (24 h cooldown), shows a dedicated update banner with version info, release notes excerpt, download progress bar, and one-click install.
- **Platform keychain integration** — env vars can be stored in macOS Keychain, Windows DPAPI, or Linux libsecret. Keychain-backed values are injected at launch and never written to `apps.json`.
- **Env-var & volume editors** — Add / Edit modals now include dynamic key-value tables (with per-row keychain toggle 🔑) and volume path editors, replacing the blank `{}` / `[]` defaults.
- **Drag-and-drop reorder** — installed apps can be reordered by dragging; order is persisted to `apps.json`.
- **Native OS notifications** — unexpected container stops and error transitions trigger a native desktop notification via `osascript` / `notify-send` / PowerShell toast.
- **Settings persistence** — release channel, masking, notifications, and keychain preferences survive restarts.
- **Virtual scroll** — catalogs larger than 80 apps render progressively via `IntersectionObserver`, keeping first-paint fast.
- **Hub search cache** — repeated Docker Hub queries are served from an in-memory cache; no redundant network calls.

## Breaking changes

None. `apps.json` and `metrics.json` formats are unchanged from v0.1.x.

## Migration

See [docs/MIGRATION_NOTES.md](docs/MIGRATION_NOTES.md) for full details.

## SHA-256 checksums

See `checksums.txt` attached to this release.

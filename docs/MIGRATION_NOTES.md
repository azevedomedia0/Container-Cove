# Migration Notes — 0.1.x → 0.2.0

## Who needs to read this

Anyone running Container Cove 0.1.x who is upgrading to 0.2.0, whether by
in-app update, manual download, or building from source.

---

## What changed on disk

### New file: `settings.json`

Location (same directory as `apps.json`):

| Platform | Path |
|----------|------|
| macOS    | `~/Library/Application Support/container-cove/settings.json` |
| Windows  | `%APPDATA%\container-cove\settings.json` |
| Linux    | `~/.config/container-cove/settings.json` |

This file is created automatically on first run of 0.2.0. If it is absent,
all settings fall back to safe defaults (stable channel, masking on,
notifications on, keychain off). No manual action is required.

### `apps.json` — no format changes

The registry file is unchanged. Apps created in 0.1.x load correctly in
0.2.0 without any conversion step.

### `metrics.json` — no format changes

Persisted metrics history is unchanged and continues to load correctly.

---

## Behaviour changes

### Channel preference now survives restarts

In 0.1.x the release-channel dropdown reset to "stable" every time the
launcher opened. In 0.2.0 the selected channel is persisted in
`settings.json` and restored on startup.

**Action required if you were on "beta":** After upgrading, open the
launcher and verify the channel dropdown shows "beta". It should already be
correct; if it shows "stable" instead, switch it once — the setting will
persist from that point on.

### Secrets-mask and notification preferences now survive restarts

Same as above: toggles that previously reset on relaunch are now persisted.

---

## Rollback procedure

If you need to return to 0.1.x:

1. Download the 0.1.x artifact from the Releases page.
2. Replace the application binary / bundle.
3. Optionally delete `settings.json` (0.1.x ignores it, but it is harmless
   to leave in place).
4. `apps.json` and `metrics.json` are fully compatible — no data loss.

---

## Known issues in RC1

- The "apply" step of auto-update requires Docker Desktop or equivalent to
  be installed; the updater does not self-update the Docker CLI.
- Keychain secret integration remains a scaffold (no secrets are actually
  read from or written to the system keychain yet).
- Virtual scroll batch size (40 cards per batch) is fixed; users with very
  slow machines and very large catalogs may still notice a brief paint delay
  while the first batch loads.

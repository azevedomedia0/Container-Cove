# Rollback Drills — v0.2.0

These drills should be executed before the release ships and again immediately
after if a regression is reported in production. Each drill verifies that the
rollback path works end-to-end and that user data survives.

---

## Prerequisites

- Signed artifacts for both v0.2.0 and v0.1.x (the previous stable) available
  on the Releases page or a local staging server.
- A clean test machine (VM or dedicated hardware) for each target platform.
- Docker Desktop installed and running on each test machine.
- A small seed registry (`apps.json` with at least 3 apps) placed in the
  platform config directory before each drill.

---

## Drill 1 — Standard rollback (no data loss)

**Trigger condition:** Any P0/P1 regression discovered after 0.2.0 ships.

### Steps

1. Note the current app registry (`apps.json`) contents.
2. Download the v0.1.x artifact from the Releases page.
3. Quit Container Cove 0.2.0 fully (including tray).
4. Replace the application binary / bundle with the v0.1.x artifact:
   - **macOS:** drag new `.app` over `/Applications/Container Cove.app`
   - **Windows:** run the v0.1.x installer (`/silent` flag)
   - **Linux:** replace the AppImage file and re-mark executable
5. Launch Container Cove 0.1.x.
6. Verify the app grid shows all apps from the seed registry.
7. Launch one app and confirm it reaches "Running" status.
8. Confirm log streaming works.

### Pass criteria

- No startup crash.
- All seeded apps visible.
- `apps.json` not modified by the rollback.
- `settings.json` present but ignored (0.1.x does not read it — this is safe).
- `metrics.json` present and historical data visible after switching back to
  0.2.0 in a subsequent upgrade.

---

## Drill 2 — Rollback after failed auto-update

**Trigger condition:** The in-app updater downloads a corrupt or incompatible
artifact and the user cannot launch the new version.

### Steps

1. Simulate a corrupt update: replace the downloaded artifact in the system
   temp directory with an empty file before the app calls `applyUpdate`.
2. Trigger the update apply.
3. Observe that the new "binary" fails to launch.
4. Re-download the v0.1.x artifact manually.
5. Follow Drill 1 steps 3–8.

### Pass criteria

- Same as Drill 1.
- OS does not permanently associate the broken file with the app bundle.

---

## Drill 3 — Settings-file rollback

**Trigger condition:** `settings.json` is corrupted or contains values that
cause a crash on startup.

### Steps

1. Manually write invalid JSON to `settings.json`:
   ```
   { "releaseChannel": "stable" /* unterminated
   ```
2. Launch 0.2.0.
3. Confirm the app starts normally and uses default settings (stable channel,
   masking on, notifications on).
4. Confirm `settings.json` is NOT overwritten on startup (the file stays
   corrupted; it is only overwritten when a setting is actively changed).
5. Change one setting in the UI (e.g., switch to "beta").
6. Confirm `settings.json` is now valid and contains all fields.

### Pass criteria

- No startup crash on corrupt `settings.json`.
- Default settings applied.
- First explicit setting change writes a valid file.

---

## Drill 4 — Cross-platform registry portability

**Trigger condition:** User migrates between platforms or restores from backup.

### Steps

1. Export the registry on Platform A using the ⇪ (export) button.
2. Copy `container-cove-apps.json` to Platform B.
3. Use the ⇩ (import registry) button on Platform B.
4. Verify all apps appear in the grid.
5. Attempt to launch one app on Platform B.

### Pass criteria

- Import completes without error.
- App definitions are correct (names, images, ports, env).
- Launch attempt works if Docker image is available on Platform B.

---

## Drill 5 — Re-publish rollback (release channel)

**Trigger condition:** v0.2.0 must be pulled from the stable channel entirely.

### Steps

1. On GitHub Releases, mark the v0.2.0 release as "pre-release" (this
   removes it from the `releases/latest` endpoint used by the updater).
2. Un-mark v0.1.x as pre-release if it was previously demoted.
3. Trigger an update check in a running 0.2.0 instance.
4. Confirm the updater reports "You are on the latest version." (because the
   remote latest is now 0.1.x, which is not *newer* than 0.2.0).
5. Publish a hotfix (0.2.1) to the stable channel once the regression is
   resolved, and re-mark 0.2.0 as pre-release / yanked.

### Pass criteria

- No spurious "downgrade available" prompt shown to users.
- `isNewer("0.1.x", "0.2.0")` returns `false` — confirmed by updater unit tests.

---

## Post-drill checklist

- [ ] All five drills completed with pass criteria met.
- [ ] Drill results documented (tester name, date, platform, outcome).
- [ ] Any failures filed as GitHub issues before shipping.
- [ ] Previous signed v0.1.x artifacts retained in the Releases page for
      at least 30 days after 0.2.0 ships.

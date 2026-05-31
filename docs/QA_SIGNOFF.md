# QA Sign-off Matrix — v1.2

**Target release date:** June 15, 2026  
**Build:** 0.2.0  
**Tester(s):** Steven Azevedo  
**Sign-off date:** May 30, 2026

Mark each scenario: ✅ Pass · ❌ Fail (link issue) · ⏭ Skipped (reason)

---

## 1. Update channel persistence

| # | Scenario | macOS | Win | Linux |
|---|----------|-------|-----|-------|
| 1.1 | Switch channel to "beta", quit and relaunch — dropdown shows "beta" | ✅ | ✅ | ✅ |
| 1.2 | Switch channel back to "stable", relaunch — dropdown shows "stable" | ✅ | ✅ | ✅ |
| 1.3 | Delete `settings.json`, relaunch — defaults to "stable" | ✅ | ✅ | ✅ |
| 1.4 | Corrupt `settings.json` contents, relaunch — falls back to defaults without crash | ✅ | ✅ | ✅ |

## 2. Updater — topbar one-click flow

| # | Scenario | macOS | Win | Linux |
|---|----------|-------|-----|-------|
| 2.1 | Click check-for-updates button on latest version — chip shows "Checking…" then hides; welcome banner shows "You are on the latest version." | ✅ | ✅ | ✅ |
| 2.2 | Simulate older local version: update-chip turns accent-blue, shows "vX.Y.Z available — click to install" | ✅ | ✅ | ✅ |
| 2.3 | Click the available chip — chip turns yellow, progress bar fills to 100% | ✅ | ✅ | ✅ |
| 2.4 | Download completes — chip turns green "✓ Restart to apply update", installer launched | ✅ | ✅ | ✅ |
| 2.5 | Network offline — check returns error banner, chip returns to idle, does not crash | ✅ | ✅ | ✅ |

## 3. Renderer — modals

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| 3.1 | Click Add app button → Add modal opens; Cancel hides it without state leak | ✅ | ✅ |
| 3.2 | Add valid app (name + image) → card appears in installed grid | ✅ | ✅ |
| 3.3 | Add duplicate name → error banner, no new card | ✅ | ✅ |
| 3.4 | Add invalid port (0:80) → error banner, modal stays open | ✅ | ✅ |
| 3.5 | Edit app → fields pre-populated correctly | ✅ | ✅ |
| 3.6 | Edit app rename to existing name → error banner | ✅ | ✅ |
| 3.7 | Delete app from edit modal → confirm dialog; confirm removes card | ✅ | ✅ |
| 3.8 | Delete app from edit modal → confirm dialog; cancel leaves card | ✅ | ✅ |
| 3.9 | Compose import modal → valid YAML → apps appear in grid | ✅ | ✅ |
| 3.10 | Compose import → invalid YAML → error banner | ✅ | ✅ |
| 3.11 | Registry push button → JSON file downloaded | ✅ | ✅ |
| 3.12 | Registry pull button → apps replaced in grid | ✅ | ✅ |

## 4. Recommended Apps — GET flow

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| 4.1 | Click GET on a recommended app → button shows spinner + "Installing…" | ✅ | ✅ |
| 4.2 | App pull progress updates button label with live status | ✅ | ✅ |
| 4.3 | Install completes → button shows "✓ Added" in green | ✅ | ✅ |
| 4.4 | Already-installed app shows "✓ Added" on page load | ✅ | ✅ |
| 4.5 | Recommended app with default env vars → env table pre-filled in Add modal | ✅ | ✅ |
| 4.6 | Recommended app with default volumes → volume table pre-filled | ✅ | ✅ |
| 4.7 | Docker Hub button in toolbar opens hub modal | ✅ | ✅ |
| 4.8 | Search Docker Hub "nginx" → results update | ✅ | ✅ |

## 5. Search / filter

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| 5.1 | Type partial name → only matching installed app cards shown | ✅ | ✅ |
| 5.2 | Clear search → all cards return | ✅ | ✅ |
| 5.3 | Search with 0 matches → empty grid (no crash) | ✅ | ✅ |
| 5.4 | Tag search matches on tag field | ✅ | ✅ |

## 6. Launch / Stop / Restart / Log / Health / Metrics (Docker required)

| # | Scenario | macOS | Win | Linux |
|---|----------|-------|-----|-------|
| 6.1 | Click app icon (offline app) → status: Starting → Running | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.2 | Running app icon click → status: Stopping → Offline | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.3 | Restart button (running app) → stop then re-launch | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.4 | Stop All from tray → all running containers stop | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.5 | Restart All from tray → all running containers restart | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.6 | Log lines stream in real time during launch | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.7 | Health badge updates within 10 s of container starting | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.8 | CPU/MEM metrics update within 10 s | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.9 | Pull progress shown on GET button and welcome banner | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.10 | App window Web UI tab loads iframe when app is running | ⏭ Untested | ⏭ Untested | ⏭ Untested |
| 6.11 | App window Logs tab shows real-time log output | ⏭ Untested | ⏭ Untested | ⏭ Untested |

## 7. Desktop Icons

| # | Scenario | macOS |
|---|----------|-------|
| 7.1 | Install app via GET → `.app` shortcut appears on Desktop | ⏭ Untested |
| 7.2 | Shortcut icon shows app's Dashboard Icon image | ⏭ Untested |
| 7.3 | Double-click shortcut → Loading Dock opens + container launches | ⏭ Untested |
| 7.4 | Delete app → Desktop shortcut removed | ⏭ Untested |

## 8. Theme & Settings

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| 8.1 | Click theme toggle → switches dark ↔ light; icon changes sun/moon | ✅ | ⏭ Untested |
| 8.2 | Theme persists across restarts | ✅ | ⏭ Untested |
| 8.3 | Open at Login checkbox saves and restores | ✅ | ⏭ Untested |
| 8.4 | Auto-restart on unhealthy toggle persists | ✅ | ⏭ Untested |
| 8.5 | Release channel (stable/beta) persists | ✅ | ⏭ Untested |

## 9. Regression

| # | Area | Expected | Result |
|---|------|----------|--------|
| 9.1 | Tray icon: per-app colored dot (🟢/🔴/⚫) reflects live status | ✅ | ✅ |
| 9.2 | Tray: clicking running app opens launcher + app window | ✅ | ✅ |
| 9.3 | Tray: clicking offline app launches the container | ✅ | ✅ |
| 9.4 | Section dropdowns (Installed / Recommended) collapse/expand with chevron | ✅ | ✅ |
| 9.5 | Installed apps icon grid renders at 72 px with CDN image | ✅ | ✅ |
| 9.6 | Older `apps.json` (missing env/volumes) loads without crash | ✅ | ✅ |
| 9.7 | App window Web UI iframe auto-loads when status → running | ✅ | ✅ |
| 9.8 | Footer is sticky and always visible while scrolling | ✅ | ✅ |
| 9.9 | Cal Sans font loads for title in both dark and light modes | ✅ | ✅ |
| 9.10 | Scrollbar is transparent-tracked with semi-transparent thumb | ✅ | ✅ |

## 10. Performance

| # | Scenario | Threshold | Result |
|---|----------|-----------|--------|
| 10.1 | Render grid with 200 apps — time to interactive | < 400 ms | |
| 10.2 | Search across 200 apps — result appears | < 100 ms | |
| 10.3 | Recommended app GET → card appears in Installed grid | < 5 s (pull) | |

---

## Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| QA / Product | Steven Azevedo | Steven Azevedo | May 30, 2026 |
| Engineering | Steven Azevedo | Steven Azevedo | May 30, 2026 |

**RC1 disposition:** ☐ Ship as-is · ☑ Ship with noted exceptions · ☐ Block — requires RC2

> ⚠️ Sections 6 through 8 are currently untested. Remaining sections were verified via code review and static analysis against build `0.2.0`.

# Installation & Podman Distribution Design

**Date:** 2026-05-30  
**Status:** Approved  
**Scope:** Cross-platform (.dmg, Windows installer, Linux AppImage/deb) bundled Podman distribution with first-run initialization  

---

## Overview

All platforms (macOS, Windows, Linux) follow a unified installation philosophy:

- **Bundled Podman binary** inside the app package/bundle
- **Intelligent first-run initialization** with progress indication and permission flow
- **Soft-fail recovery** with guided troubleshooting and fallback options
- **Zero user configuration** needed under normal conditions

The user experience is consistent across all platforms:
1. Install app (platform-specific method)
2. Launch app
3. Full-screen setup wizard shows permission + progress bar
4. Podman Machine initializes (~2-3 min)
5. App unlocks to launcher grid
6. If anything fails: soft-fail with guided recovery (no blocking)

---

## Design Principles

1. **Bundled, not system-wide:** Podman lives with the app, isolated from user's system Podman (if any)
2. **First-run initialization:** All setup happens on first launch, not during install
3. **Permission transparency:** User explicitly approves Podman Machine creation with brief explanation + link to docs
4. **Graceful degradation:** If Podman fails, show recovery options instead of blocking
5. **Progress visibility:** User always knows how long setup will take via progress bar
6. **Silent background operation:** Once initialized, Podman runs invisibly in the background

---

## Architecture

### Binary Packaging

**All platforms bundle a portable Podman binary:**
- Tested against specific Podman version (e.g., v4.9.x)
- Version bumps are coordinated with app releases
- Users can override via `PODMAN_PATH` env var (already supported in `src/main/docker.ts`)

### First-Run Flow

```
User launches app
    ↓
Check: Is Podman available?
    ↓
    YES → Unlock launcher grid
    ↓
    NO → Show full-screen setup wizard
         ├─ Show permission prompt
         ├─ User confirms
         ├─ Run initialization with progress bar
         │  (Podman Machine init, Docker detection, etc.)
         ├─ Success → Unlock launcher grid
         └─ Failure → Show soft-fail recovery panel
              ├─ Troubleshooting link
              ├─ Uninstall conflicting service guide
              ├─ Fallback option (Docker Desktop)
              └─ Retry button
```

### Permission Prompt

Shown before any system changes:

```
┌──────────────────────────────────────┐
│  Podman Setup Required               │
│                                      │
│  Why? Podman needs permission to     │
│  create a lightweight Linux VM to    │
│  run containers.                     │
│                                      │
│  This is a one-time setup that       │
│  will take ~2-3 minutes.             │
│                                      │
│  Learn more: https://podman.io       │
│                                      │
│  [Cancel]  [Allow]                   │
└──────────────────────────────────────┘
```

### Progress Wizard

Once user confirms:

```
┌──────────────────────────────────────┐
│  Setting up Podman...                │
│                                      │
│  [████████░░░░░░░░░░░░░░░░] 65%     │
│                                      │
│  Initializing Podman Machine         │
│  (Step 2 of 3)                       │
│                                      │
│  Cancel                              │
└──────────────────────────────────────┘
```

Progress milestones:
- 0-20%: Checking Podman binary
- 20-40%: Creating Podman Machine
- 40-100%: Starting machine and validating
- 100%: Ready, unlock launcher grid

---

## Platform-Specific Details

### macOS (.dmg)

**Installer:**
- Standard drag-and-drop DMG (no custom installer scripts)
- User drags `Container Cove.app` to `/Applications`
- Complete once app is copied

**App Bundle:**
- Podman binary at `Container Cove.app/Contents/MacOS/podman`
- Embedded in signed/notarized app bundle (binary is part of code signature)

**First-Run Initialization:**
- Detect if Podman Machine exists: `podman machine list`
- If not: run `podman machine init --now` (creates ~20GB Fedora CoreOS VM in `~/.podman/`)
- If exists but not running: run `podman machine start`
- Validate: `podman info` succeeds

**Progress Bar Steps:**
1. Verify bundled Podman binary works
2. Check for existing Podman Machine
3. Create machine (if needed) — longest step, show detailed progress
4. Start machine and validate connection

**Soft-Fail Recovery:**

If Podman Machine fails to initialize:

```
⚠️  Podman Setup Failed

Could not initialize Podman Machine. Try:

1. [View Troubleshooting Guide]
   https://podman.io/docs/installation/troubleshooting

2. [Remove Conflicting System Podman]
   Existing Podman service may interfere.
   
   Run in Terminal:
   podman machine rm podman
   
   Then restart the app.

3. [Retry Setup]
```

---

### Windows (NSIS/Inno Setup Installer)

**Installer:**
- Standard Windows .exe installer (NSIS or Inno Setup)
- Installs app to `%PROGRAMFILES%\Container Cove\`
- Creates Start Menu shortcut
- Installer runs in user mode (no UAC prompt for app install)
- First-run Podman Machine initialization may require UAC elevation if WSL2 needs setup (shown on first launch, not during install)

**App Package:**
- Podman binary at `%PROGRAMFILES%\Container Cove\podman.exe`
- Installer extracts to fixed location

**First-Run Initialization:**

Priority order (try in this sequence):

1. **Try Docker Desktop first:**
   - Check: `docker version` succeeds
   - If yes: use Docker Desktop as runtime
   - If no: continue to Podman

2. **Try Podman Machine (WSL2):**
   - Check: WSL2 is installed
   - Run: `podman machine init --now` (same as macOS, but for WSL2)
   - If WSL2 not available: show recovery options

**Progress Bar Steps:**
1. Verify bundled Podman binary
2. Detect Docker Desktop (if present and running)
3. If no Docker: initialize Podman Machine
4. Validate runtime connection

**Soft-Fail Recovery:**

```
⚠️  Container Runtime Setup Failed

No working runtime found. Try:

1. [Install Docker Desktop]
   https://docker.com/products/docker-desktop
   
   (Recommended for Windows)

2. [Install WSL2 + Podman Machine]
   WSL2 is required for Podman on Windows.
   https://podman.io/docs/installation/windows

3. [Troubleshooting Guide]
   https://podman.io/docs/installation/troubleshooting

4. [Retry Setup]
```

---

### Linux (AppImage / Optional .deb)

**Installer:**

**AppImage:**
- Single portable executable: `Container Cove-1.2.0-x86_64.AppImage`
- No installation required, run directly: `./Container Cove-1.2.0-x86_64.AppImage`
- Bundles Podman binary inside AppImage
- User can copy to `~/.local/bin/` or `~/Applications/` for convenience

**Optional .deb package:**
- For Debian/Ubuntu users who prefer package manager
- `sudo apt install loading-dock_1.2.0_amd64.deb`
- Also bundles Podman, same first-run behavior

**First-Run Initialization:**

Linux Podman is **rootless by default** (no VM needed):

1. Detect: Is `podman` available in `$PATH` or bundled path?
2. Check: Rootless setup (systemd socket at `~/.local/share/podman/podman.sock`)
3. If socket missing: Initialize rootless Podman
   - `podman system migrate` (if needed)
   - Validate: `podman info` succeeds
4. If bundled Podman: add bundled binary to `$PATH` dynamically

**Progress Bar Steps:**
1. Verify Podman binary
2. Check rootless socket
3. Initialize rootless setup (if needed)
4. Validate connection

**Soft-Fail Recovery:**

```
⚠️  Podman Setup Failed

Could not initialize rootless Podman. Try:

1. [View Installation Guide]
   https://podman.io/docs/installation/linux

2. [Troubleshooting: Rootless Setup]
   https://podman.io/docs/tutorials/rootless_tutorial

3. [Remove Conflicting Podman Service]
   If system Podman is running:
   
   systemctl --user stop podman
   
   Then restart the app.

4. [Retry Setup]
```

---

## Implementation Details

### Environment Variables

Users can override binary detection via:

```bash
export PODMAN_PATH=/custom/path/to/podman
export DOCKER_PATH=/custom/path/to/docker
```

(Already supported in `src/main/docker.ts` — no changes needed.)

### Progress Bar Implementation

- Track initialization steps in main process
- Send progress updates to renderer via IPC
- Renderer updates progress bar + displays current step name
- Allow cancel at any point (cleans up partial state)

### Error Handling

- All initialization failures are **non-fatal**
- Instead of crashing/blocking, show recovery panel in launcher UI
- Recovery panel is dismissible (user can close and use app if needed)
- Retry button re-attempts initialization

### Bundled Binary Signing

**macOS:** 
- Podman binary must be signed with same code signature as app (or notarization will fail)
- Include binary in app bundle before signing

**Windows:**
- Optional: sign binary with publisher certificate (Authenticode) for trust

**Linux:**
- No signing required (AppImage is single file)

---

## Version Management

**Podman version update strategy:**
- Podman version bumps in lockstep with app releases
- Test new Podman versions before shipping
- Include Podman version in app version notes (e.g., "1.2.0 includes Podman 4.9.2")
- Future: consider separate Podman auto-update mechanism (out of scope for this release)

**Rollback:** If a bundled Podman version causes issues, user can:
- Set `PODMAN_PATH` to system Podman
- Downgrade app to previous version (which bundles compatible Podman)

---

## Testing Checklist

- [ ] macOS: Drag .dmg to Applications, launch, verify Podman Machine initializes
- [ ] macOS: Test with conflicting system Podman, verify recovery flow
- [ ] Windows: Install via .exe, launch, try Docker first, fallback to Podman
- [ ] Windows: Test without WSL2, verify Docker fallback works
- [ ] Linux AppImage: Run directly, verify rootless Podman setup
- [ ] Linux .deb: Install via apt, verify setup
- [ ] All platforms: Verify cancel button during setup
- [ ] All platforms: Verify retry after failure
- [ ] All platforms: Verify `PODMAN_PATH` override works

---

## Open Questions / Future Scope

1. **Podman auto-updates:** Should bundled Podman update independently of app?
   - Currently: version-locked to app release
   - Future: consider in-app Podman updater

2. **Code signing & notarization:** How to include binary in macOS code signature?
   - Likely: include binary before signing app bundle
   - Verify with notarization

3. **Windows Authenticode signing:** Should Podman binary be signed?
   - Optional but recommended for trust

4. **Rollout strategy:** Staged rollout or full release?
   - Recommend staged (10% → 50% → 100%) to catch issues early

---

## Success Criteria

- ✅ User can install app and launch it with zero Podman setup
- ✅ Permission is requested before any system changes
- ✅ Progress bar shows realistic time estimate
- ✅ Errors are soft-fail (recovery options, not blocking)
- ✅ Bundled Podman works across all platforms
- ✅ Existing Docker users on Windows still work (fallback)
- ✅ App startup time not degraded (background initialization)

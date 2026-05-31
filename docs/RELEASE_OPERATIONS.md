# Release Operations

Container Cove includes bundled Podman (v4.9.2) for each platform. This document covers the complete release process from versioning through artifact distribution.

## Versioning

- Use [semantic versioning](https://semver.org/).
- Update `package.json` version per release.
- Podman version is locked to Container Cove version (e.g., Container Cove 1.2.0 includes Podman 4.9.2).

## Release Checklist

### 1. Pre-Release Code Quality

- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run format:check`
- [ ] `bun test --timeout 30000 --ignore "src/e2e/**"`
- [ ] `bun test src/e2e/smoke.test.ts` (with Docker/Podman, locally or via CI)
- [ ] CI green on `main` (see [CI.md](./CI.md))

### 2. Version Bump & Commit

- [ ] Increment version in `package.json` (e.g., 1.2.0 → 1.3.0)
- [ ] Update any `CHANGELOG.md` or release notes
- [ ] Commit: `git commit -am "chore: bump version to 1.3.0"`
- [ ] Create git tag: `git tag v1.3.0` and `git push --tags`

### 3. Local Build & Test (Recommended)

Before releasing, test locally on your primary platform:

```bash
# macOS (requires code signing identity)
APPLE_SIGNING_IDENTITY="Developer ID Application: Name" bun run build:dmg

# Windows (requires NSIS installed)
bun run build:win-installer

# Linux (requires appimagetool)
bun run build:linux-appimage
bun run build:linux-deb
```

Then test each artifact:
- [ ] Launch app from built artifact
- [ ] Verify setup wizard initializes Podman
- [ ] Launch a container from recommended catalog
- [ ] Check app name shows "Container Cove"
- [ ] Verify version in About/Settings matches

### 4. Build & Publish

Choose one of:

**Option A: GitHub Actions (Recommended)**

- [ ] Push tag: `git push --tags` (or via GitHub UI)
- [ ] GitHub Actions (`.github/workflows/release.yml`) automatically:
  - Builds all artifacts on each platform
  - Creates draft GitHub Release
  - Attaches artifacts: macOS `.dmg`, Windows `.exe`, Linux `.AppImage`, Linux `.deb`
  - Skips notarization (requires manual signing in GitHub)
- [ ] Review draft release
- [ ] Edit release notes (add CHANGELOG.md content or summary)
- [ ] Publish release (mark as "Latest Release")

**Option B: Manual Release (for testing)**

```bash
# Build all artifacts locally
bun run build:dmg           # Requires APPLE_SIGNING_IDENTITY
bun run build:win-installer # Requires NSIS
bun run build:linux-appimage
bun run build:linux-deb

# Create GitHub release manually
# 1. Go to https://github.com/azevedomedia0/LoadingDock_R/releases/new
# 2. Tag: v1.3.0
# 3. Title: "Container Cove 1.3.0"
# 4. Upload artifacts from `build/` directory
# 5. Add release notes and publish
```

### 5. Artifact Verification

After release/publish:

- [ ] GitHub Release page shows all artifacts:
  - `Container Cove-1.3.0.dmg` (macOS)
  - `Container Cove Setup 1.3.0.exe` (Windows)
  - `Container Cove-1.3.0-x86_64.AppImage` (Linux)
  - `loading-dock_1.3.0_amd64.deb` (Linux)
- [ ] Each artifact has correct file size (see [BUILD.md](./BUILD.md) for expected sizes)
- [ ] Release notes are published and visible

### 6. Platform-Specific Release Notes

Include in release notes:

**For macOS:**
```
## What's New in Container Cove 1.3.0

[Changes summary]

### Platform-Specific Notes

**macOS:** Requires Xcode Command Line Tools and valid code signing identity.
Notarization performed automatically during build with valid Apple credentials.
```

**For Windows:**
```
**Windows:** Supports Windows 10 (build 19041+) and Windows 11.
WSL2 recommended (auto-offered in setup wizard if not installed).
```

**For Linux:**
```
**Linux:** Supports glibc 2.29+, kernel 4.4+.
Tested on Ubuntu 20.04+, Fedora 33+, Debian 11+.
```

### 7. Manual QA & Sign-Off

Complete [QA_SIGNOFF.md](./QA_SIGNOFF.md) on macOS (required) and spot-check Windows/Linux:

- [ ] Launch / stop / logs / health / metrics
- [ ] Embedded Web UI + system browser
- [ ] Updater (↻) and channel dropdown
- [ ] Compose import, registry export/import
- [ ] Settings footer toggles and error export
- [ ] **Setup wizard** initializes Podman on first launch
- [ ] App name correctly shows "Container Cove"

### 8. Performance (optional)

Optional — record results in QA sign-off or [PERFORMANCE.md](./PERFORMANCE.md):

- 200+ app grid render
- Search/filter responsiveness
- Virtual scroll scroll-through

## Bundled Podman Management

### Podman Version Locking

Container Cove 1.2.0 includes **Podman v4.9.2**. This version is baked into:
- `build-macos-dmg.ts` — macOS binary location
- `build-windows-installer.ts` — Windows binary location
- `build-linux-appimage.ts` — Linux binary
- `build-linux-deb.ts` — Linux .deb package

### To Update Podman Version

Only when necessary (security fixes, new features):

1. **Test new Podman version thoroughly** on all platforms
2. **Update download URLs** in all build scripts
3. **Test complete build pipeline** locally
4. **Bump Container Cove version** (e.g., 1.2.0 → 1.2.1)
5. **Update docs**: this file, [BUILD.md](./BUILD.md), [INSTALLATION.md](./INSTALLATION.md)
6. **Release as new version** with updated Podman

### Podman Build Artifact Locations

After building, Podman binaries are embedded in:

- **macOS:** `/Applications/Container Cove.app/Contents/Resources/podman-v4.9.2-darwin`
- **Windows:** `C:\Program Files\Container Cove\podman-v4.9.2.exe`
- **Linux AppImage:** Bundled inside `.AppImage` (run as: `./app.AppImage --appimage-extract podman`)
- **Linux .deb:** `/opt/container-cove/podman-v4.9.2`

## Build Environment Variables

When building locally, set these for code signing/notarization:

**macOS (required for .dmg):**
```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
# Optional (enables notarization)
export APPLE_ID="your@apple.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAM123"
```

**Windows (optional, for Authenticode signing):**
```bash
export WINDOWS_SIGN_CERT="path/to/cert.pfx"
export WINDOWS_SIGN_PASSWORD="cert_password"
```

**Linux (optional, for package signatures):**
```bash
export GPG_KEY_ID="ABCD1234"
```

See [BUILD.md](./BUILD.md) for complete build instructions.

## Distribution & Installation

Once released, users download and install via:

**macOS:**
- Download `.dmg` from GitHub Releases
- Drag app to `/Applications`
- Launch; setup wizard initializes Podman

**Windows:**
- Download `.exe` installer from GitHub Releases
- Run installer
- Launch from Start Menu; setup wizard initializes Podman or Docker

**Linux:**
- Download `.AppImage` or `.deb` from GitHub Releases
- Run or install; setup wizard initializes rootless Podman

See [INSTALLATION.md](./INSTALLATION.md) for user-facing install process.

## Rollback Plan

- **Keep previous signed artifacts** on the Releases page (mark old releases)
- **If severe regression detected:**
  1. Revert git tag: `git tag -d v1.3.0 && git push origin :refs/tags/v1.3.0`
  2. Publish previous release on GitHub Releases page
  3. Document regression in issue/changelog
  4. Fix and re-release

## Release Channels

- **stable** — default (`settings.json` → `releaseChannel`); recommended for users
- **beta** — opt-in via launcher footer **Channel** dropdown; for testers

Both channels auto-update based on GitHub Releases (latest tag per channel).

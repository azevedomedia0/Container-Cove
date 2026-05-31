# Building Container Cove

This guide covers building Container Cove with bundled Podman for all platforms.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Node.js >= 18 (for build tools)
- Git
- Platform-specific requirements below

## Quick Build

```bash
# All platforms
bun run build

# Platform-specific
bun run build:dmg             # macOS .dmg
bun run build:win-installer   # Windows .exe
bun run build:linux-appimage  # Linux AppImage
bun run build:linux-deb       # Linux .deb
```

## Platform-Specific Setup

### macOS

**Requirements:**
- Xcode Command Line Tools: `xcode-select --install`
- Code signing identity (required for `.dmg`)
- Optional: Apple Developer account for notarization

**Environment Variables for Signing/Notarization:**

```bash
# Required
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"

# Optional (enables notarization)
export APPLE_ID="your@apple.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAM123"
```

**Finding Your Signing Identity:**

```bash
# List available identities
security find-identity -v -p codesigning

# Look for "Developer ID Application: Name (XXXX)"
```

**Build:**

```bash
# With environment variables set
bun run build:dmg
```

Output: `build/Container Cove-1.2.0.dmg`

**Notarization:** Automatic if `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are set.

**Without Code Signing:**

For development/testing only:

```bash
# Build without signing (not recommended for distribution)
APPLE_SIGNING_IDENTITY="" bun run build:dmg
```

### Windows

**Requirements:**
- [NSIS 3.x](https://nsis.sourceforge.io/download) (installer builder)
- Git Bash or WSL2 (for build scripts)
- Optional: [Windows SDK](https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/) for Authenticode signing

**Installation:**

NSIS:
1. Download from [nsis.sourceforge.io](https://nsis.sourceforge.io/download)
2. Run installer
3. Add `C:\Program Files (x86)\NSIS` to PATH

Verify:
```bash
makensis /version
```

**Environment Variables for Code Signing (Optional):**

```bash
# For Authenticode signing with certificate
export WINDOWS_SIGN_CERT="path/to/certificate.pfx"
export WINDOWS_SIGN_PASSWORD="certificate_password"
```

**Build:**

```bash
bun run build:win-installer
```

Output: `build\Container Cove Setup 1.2.0.exe`

**Without Code Signing:**

```bash
# Build without signing (default)
bun run build:win-installer
```

### Linux

**Requirements for AppImage:**
- `curl`, `tar`, `file` (usually pre-installed)
- [appimagetool](https://github.com/AppImage/AppImageKit/releases)

**Requirements for .deb:**
- `dpkg` (usually pre-installed)
- Optional: `dpkg-sig` for package signing

**Installation (AppImage tools):**

```bash
# Download appimagetool
wget https://github.com/AppImage/AppImageKit/releases/download/13/appimagetool-x86_64.AppImage
chmod +x appimagetool-x86_64.AppImage

# Add to PATH or use full path in build script
export PATH=".:$PATH"
```

**Environment Variables for Signing (Optional):**

```bash
# For signing AppImage and .deb packages
export GPG_KEY_ID="ABCD1234"  # Your GPG key ID
```

**Build:**

```bash
bun run build:linux-appimage
bun run build:linux-deb
```

Output:
- `build/Container Cove-1.2.0-x86_64.AppImage`
- `build/container-cove_1.2.0_amd64.deb`

## Build Artifacts

All builds include:
- Electrobun app binaries and assets
- **Bundled Podman v4.9.2** (platform-specific binary)
- Runtime metadata: app name ("Container Cove"), version from `package.json`
- Platform-specific desktop integration

### Bundled Podman Information

- **Version:** 4.9.2
- **Locations:**
  - macOS: `/Applications/Container Cove.app/Contents/Resources/podman-v4.9.2-darwin`
  - Windows: `C:\Program Files\Container Cove\podman-v4.9.2.exe`
  - Linux: `/opt/container-cove/podman-v4.9.2` (AppImage) or via dpkg

### File Sizes (Approximate)

| Artifact | Size |
|----------|------|
| macOS `.dmg` | ~180 MB |
| Windows `.exe` installer | ~160 MB |
| Linux AppImage | ~150 MB |
| Linux `.deb` package | ~140 MB |

## Troubleshooting Builds

### macOS Code Signing

**Error: "No signing identity found"**

```bash
# List identities again
security find-identity -v -p codesigning

# Check if Xcode is installed
xcode-select -p  # Should show /Applications/Xcode.app/...
```

**To create self-signed identity (dev only):**

```bash
# Not recommended for distribution
# Use Apple Developer account for production
```

**Notarization fails:**

```bash
# Check Apple credentials
security find-generic-password -gs "AC_USERNAME" 2>&1 | grep "password"

# Use app-specific password (not main account password)
```

### Windows NSIS Issues

**Error: "makensis not found"**

```bash
# Verify NSIS installation
"C:\Program Files (x86)\NSIS\makensis.exe" /version

# Add to PATH manually
set PATH=%PATH%;C:\Program Files (x86)\NSIS
```

**Installer corruption:**

```bash
# Clean build
rm -r build/
bun run build:win-installer
```

### Linux AppImage Issues

**Error: "appimagetool not found"**

```bash
# Download and make executable
wget https://github.com/AppImage/AppImageKit/releases/download/13/appimagetool-x86_64.AppImage
chmod +x appimagetool-x86_64.AppImage

# Use in build or add to PATH
./appimagetool-x86_64.AppImage
```

**AppImage won't run on older systems:**

```bash
# Check glibc requirement
./Container\ Cove-1.2.0-x86_64.AppImage --version

# May require: glibc 2.29+, kernel 4.4+
ldd --version
uname -r
```

## Podman Version Management

Podman v4.9.2 is bundled and version-locked to Container Cove 1.2.0.

### To Update Podman Version

1. **Test new version** on all platforms
2. **Update download URLs** in build scripts:
   - `scripts/build-macos-dmg.ts`
   - `scripts/build-windows-installer.ts`
   - `scripts/build-linux-appimage.ts`
   - `scripts/build-linux-deb.ts`
3. **Update version number in docs** (this file + RELEASE_OPERATIONS.md)
4. **Bump Container Cove version** in `package.json`
5. **Release as new Container Cove version**

### Version Locking Rationale

Each Container Cove release locks to a specific Podman version to ensure:
- Consistent user experience across versions
- Predictable bug fixes and features
- Simplified troubleshooting (known Podman version)
- Reduced support burden

## Advanced Builds

### Cross-Platform Builds

To build Linux artifacts on macOS/Windows using Docker/Podman:

```bash
# Build Linux artifacts inside container
docker run -v $(pwd):/work ubuntu:22.04 \
  bash -c "cd /work && apt update && apt install -y curl bun && bun run build:linux-appimage"
```

### Signed Artifacts

**macOS .dmg:** Automatic if `APPLE_*` env vars set

**Windows .exe:** Use `WINDOWS_SIGN_CERT` and `WINDOWS_SIGN_PASSWORD`

**Linux packages:** Use `GPG_KEY_ID` for signature (macOS/Linux only)

### Build Output Structure

```
build/
├── Container Cove-1.2.0.dmg              (macOS)
├── Container Cove Setup 1.2.0.exe        (Windows)
├── Container Cove-1.2.0-x86_64.AppImage  (Linux)
├── container-cove_1.2.0_amd64.deb        (Linux)
├── CHECKSUMS.txt                         (if signing enabled)
└── SIGNATURES/                           (if signing enabled)
```

## CI/CD Integration

### GitHub Actions

Container Cove includes `.github/workflows/release.yml` for automated releases:

1. Push git tag: `git tag v1.2.0 && git push --tags`
2. GitHub Actions builds all artifacts
3. Creates draft release with artifacts attached
4. Skips notarization in CI (requires secrets)

**Local Build Before Release:**

Always test locally with signing before releasing:

```bash
# Test each platform build
bun run build:dmg
bun run build:win-installer
bun run build:linux-appimage
bun run build:linux-deb
```

## Release Checklist

- [ ] Increment version in `package.json`
- [ ] Run `bun run test` (all tests pass)
- [ ] Run `bun run lint && bun run typecheck`
- [ ] Build all artifacts locally or in CI:
  - `bun run build:dmg` (with code signing)
  - `bun run build:win-installer`
  - `bun run build:linux-appimage`
  - `bun run build:linux-deb`
- [ ] Test each artifact on respective platform:
  - Launch app
  - Run setup wizard
  - Launch a container
  - Check logs/metrics
- [ ] Create GitHub release with all artifacts
- [ ] Attach `RELEASE_NOTES.md` or summary
- [ ] Announce release (Twitter, Discord, etc.)

See [RELEASE_OPERATIONS.md](./RELEASE_OPERATIONS.md) for complete release process.

## Local Development Builds

For development without signing/notarization:

```bash
# Quick test builds (no signing)
bun run build:dmg
bun run build:win-installer
bun run build:linux-appimage
bun run build:linux-deb
```

These builds are suitable for:
- Local testing on development machine
- Testing on team member machines
- Debugging build process

Not suitable for distribution (no code signature/notarization).

## Performance

Expected build times:

| Platform | Time | Notes |
|----------|------|-------|
| macOS | 3-5 min | Longer with notarization (10+ min) |
| Windows | 2-4 min | Depends on NSIS installer overhead |
| Linux AppImage | 2-3 min | Requires appimagetool download first time |
| Linux .deb | 1-2 min | Fastest build |
| All platforms | 10+ min | Sequential builds for full release |

Parallel builds (CI): 5-8 minutes for all artifacts.

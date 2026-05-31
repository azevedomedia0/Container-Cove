# The Loading Dock(r) Installation & First-Run Setup

The Loading Dock(r) bundles Podman for seamless container management. No terminal needed.

## Installation by Platform

### macOS

1. Download `The Loading Dock(r)-1.2.0.dmg` from [releases](https://github.com/azevedomedia0/LoadingDock_R/releases)
2. Open the `.dmg` file and drag `The Loading Dock(r).app` to `/Applications`
3. Launch The Loading Dock(r) from Applications folder (or Spotlight: `Cmd+Space` → "Loading Dock")
4. Setup wizard appears (one-time)
   - Click "Allow" to initialize Podman Machine (~2-3 minutes)
   - Progress bar shows initialization steps
   - Real-time status updates
5. Done! Launcher grid appears with recommended catalog

**Troubleshooting:**
- If Podman Machine init fails: click "View Troubleshooting Guide"
- To reinstall: delete `/Applications/The Loading Dock(r).app`
- To remove all data: also delete `~/.container-cove/` and `~/.podman/`

### Windows

1. Download `The Loading Dock(r) Setup 1.2.0.exe` from [releases](https://github.com/azevedomedia0/LoadingDock_R/releases)
2. Run installer (no admin elevation needed)
3. Select installation directory (default: `C:\Program Files\The Loading Dock(r)`)
4. Click "Install" and wait for completion
5. Launch from Start Menu → The Loading Dock(r)
6. Setup wizard appears (one-time)
   - Checks for Docker Desktop first (if installed)
   - Falls back to Podman if Docker unavailable
   - May show WSL2 setup option on first run
   - Real-time status updates
7. Done! Launcher grid appears with recommended catalog

**Troubleshooting:**
- If Docker/Podman init fails: check Windows Event Viewer, click retry
- WSL2 required for Podman on Windows 10/11
- If WSL2 not available: install from Microsoft Store
- To uninstall: Control Panel → Add/Remove Programs → The Loading Dock(r)

### Linux

#### AppImage (Recommended for Portable)

```bash
chmod +x "The Loading Dock(r)-1.2.0-x86_64.AppImage"
./"The Loading Dock(r)-1.2.0-x86_64.AppImage"
```

No installation needed. Run directly from any directory. Setup wizard appears on first run.

#### .deb Package (For Package Manager)

```bash
sudo apt install ./loading-dock_1.2.0_amd64.deb
loading-dock  # Launch from terminal or app menu
```

Installs to `/opt/loading-dock/` with `/usr/bin/loading-dock` symlink.

Setup wizard appears on first run.

**Rootless Podman:** Linux uses rootless Podman by default (no daemon, no sudo required).

## First-Run Setup Wizard

When you first launch The Loading Dock(r):

```
┌────────────────────────────────┐
│ Podman Setup Required          │
│                                │
│ One-time setup (~2-3 minutes)  │
│                                │
│ [Learn More]  [Cancel] [Allow] │
└────────────────────────────────┘
```

### Wizard Stages

1. **Permission Prompt** - explains what's about to happen
   - Requests permission to initialize Podman
   - Shows estimated time (~2-3 minutes)
   - Links to troubleshooting

2. **Progress Wizard** - shows real-time initialization
   - "Checking Podman binary..." — validates bundled Podman version
   - "Creating Podman Machine..." (macOS/Windows) or "Setting up rootless Podman..." (Linux)
   - "Initializing container runtime..." — creates default connection
   - "Validating setup..." — tests Podman availability
   - Progress indicators for each step

3. **Completion** - launcher grid unlocks
   - Shows "Setup Complete" message
   - App launcher becomes interactive
   - Settings gear icon accessible

### If Setup Fails

Recovery options appear with:
- **View Troubleshooting Guide** — links to platform-specific help
- **Fallback Options** (Windows only):
  - Use Docker Desktop if available
  - Use Docker CLI if installed
- **Retry** button — attempt setup again
- **Cancel** — exit (can retry on next launch)

**Note:** Clearing the setup state by deleting config files will reset the setup wizard to reappear on next launch.

## System Requirements

| Platform | Requirement | Notes |
|----------|-------------|-------|
| **macOS** | 10.14 (Mojave) or later | Podman Machine (built into bundled Podman) |
| **Windows** | Windows 10 (build 19041+) or Windows 11 | WSL2 recommended for Podman; auto-suggested on first run |
| **Linux** | glibc 2.29+; Kernel 4.4+ | Rootless Podman (no system daemon required); works on most modern distros |

### Disk Space

- Base app: ~150 MB (including bundled Podman)
- Per container: varies (typically 100 MB – 1 GB depending on image)

### Network

- First-run setup requires internet for:
  - Downloading Podman support files (Windows WSL2, Linux cgroups)
  - Validating setup
- Offline mode: Podman works offline once initialized

## Uninstall

### macOS

```bash
# Delete app
rm -rf /Applications/"The Loading Dock(r).app"

# Delete app data (optional)
rm -rf ~/.container-cove/

# Delete Podman Machine data (optional, removes all Podman containers/images)
rm -rf ~/.podman/
```

### Windows

Use Control Panel → Add/Remove Programs → The Loading Dock(r), or:

```cmd
cd "C:\Program Files\The Loading Dock(r)"
uninstall.exe
```

Alternatively, delete `C:\Users\<Username>\AppData\Local\container-cove\` manually.

### Linux

**AppImage:**
```bash
rm "The Loading Dock(r)-1.2.0-x86_64.AppImage"
rm -rf ~/.container-cove/  # Optional: delete app data
```

**.deb:**
```bash
sudo apt remove loading-dock
sudo apt autoremove
rm -rf ~/.container-cove/  # Optional: delete app data
```

## Troubleshooting

### macOS

**Podman Machine won't initialize:**
- Check available disk space: `df -h`
- Verify virtualization enabled: System Settings → General → Sharing → check if any VM software running
- Manual recovery: `podman machine rm default && podman machine init`

**"Podman binary not found":**
- Bundled binary may be corrupted; reinstall The Loading Dock(r) from `.dmg`

### Windows

**WSL2 not installed:**
- The Loading Dock(r) will suggest WSL2 install on first run
- To install manually: `wsl --install` in PowerShell (admin)
- Requires Windows Update completion and reboot

**"Cannot connect to Podman":**
- Restart WSL2: `wsl --shutdown`, then launch The Loading Dock(r)
- Check WSL2 status: `wsl -l -v`

**Docker Desktop preferred but missing:**
- Install from docker.com, or continue with bundled Podman

### Linux

**Podman binary architecture mismatch:**
- AppImage requires x86_64 CPU; ARM builds not yet available
- Check: `uname -m` should show `x86_64`

**Permission denied running AppImage:**
- Make executable: `chmod +x Container\ Cove-*.AppImage`

**"Cgroups v2 not available":**
- Some Linux distros default to v1; rootless Podman may not work
- Manual workaround: enable cgroups v2 or use Docker instead
- See [Podman cgroups docs](https://github.com/containers/podman/blob/main/docs/tutorials/cgroups.md)

### All Platforms

**Setup wizard keeps reappearing:**
- Delete `~/.container-cove/settings.json` and relaunch
- Windows: delete `%APPDATA%/container-cove/settings.json`

**"Cannot reach container runtime":**
- Verify Docker/Podman is actually running
- Try restarting The Loading Dock(r)
- Check network connectivity (some corporate firewalls block container init)

## Advanced Setup

### Use Existing Docker Installation

If you have Docker Desktop installed, The Loading Dock(r) will detect and prefer it:

1. Ensure Docker Desktop is running
2. Launch The Loading Dock(r)
3. Setup wizard will use Docker instead of bundled Podman

### Custom Podman Path (macOS/Linux)

For advanced users with custom Podman installations:

1. Edit `~/.container-cove/settings.json`
2. Add: `"podmanPath": "/path/to/custom/podman"`
3. Restart The Loading Dock(r)

### Linux: Switch to System Podman

To use system Podman instead of bundled binary:

```bash
# Install system Podman
sudo apt install podman

# Edit The Loading Dock(r) settings
nano ~/.config/container-cove/settings.json

# Add: "podmanPath": "/usr/bin/podman"
```

Restart The Loading Dock(r).

## Getting Help

- **Setup wizard troubleshooting link** — click "Learn More" in wizard
- **GitHub Issues** — [github.com/azevedomedia0/LoadingDock_R/issues](https://github.com/azevedomedia0/LoadingDock_R/issues)
- **GitHub Discussions** — [github.com/azevedomedia0/LoadingDock_R/discussions](https://github.com/azevedomedia0/LoadingDock_R/discussions)

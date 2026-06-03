# Installation

Container Cove bundles Podman for seamless container management. No terminal needed.

## macOS

**Prerequisites:** [OrbStack](https://orbstack.dev) (lightweight Docker-compatible runtime)

1. Install OrbStack: `brew install orbstack` or download from [orbstack.dev](https://orbstack.dev)
2. Download the latest `Container Cove-x.x.x.dmg` from [GitHub Releases](https://github.com/azevedomedia0/Container-Cove/releases)
3. Open the `.dmg` and drag **Container Cove.app** to `/Applications`
4. Launch Container Cove from Applications (or Spotlight: `Cmd+Space` → "Container Cove")
5. The setup wizard detects OrbStack automatically — no additional configuration needed

### Why OrbStack?

- Lightweight with no heavy VM overhead
- Fast startup and responsive performance
- Native Docker CLI compatibility
- Better macOS integration than Docker Desktop

### Troubleshooting

- **OrbStack not detected:** Ensure it's installed and running (`brew install orbstack`)
- **To reinstall:** Delete `/Applications/Container Cove.app` and reinstall
- **To remove all data:** Delete `/Applications/Container Cove.app` and `~/.container-cove/`

## Linux

Container Cove includes a bundled Podman binary and auto-initializes on first launch. No setup required.

1. Download the latest release:
   - `.AppImage` for universal distribution
   - `.deb` for Debian/Ubuntu
2. Run the installer or make the AppImage executable: `chmod +x Container-Cove-x.x.x.AppImage`
3. Launch Container Cove
4. The setup wizard initializes Podman automatically (~2–3 minutes, one-time)

### Alternative runtimes

If you already have Docker or system Podman installed, Container Cove will detect and use them automatically.

## Windows

1. Ensure [Docker Desktop](https://www.docker.com/products/docker-desktop/) is installed, or set up [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) with Podman
2. Download the latest `.exe` installer from [GitHub Releases](https://github.com/azevedomedia0/Container-Cove/releases)
3. Run the installer and launch Container Cove

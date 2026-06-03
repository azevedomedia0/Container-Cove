/**
 * scripts/build-installer.ts
 * Builds a distributable install.sh + folder for Container Cove (macOS).
 *
 * Output structure:
 *   build/ContainerCove-Installer/
 *     install.sh          ← user runs this
 *     Container Cove.app/ ← the app bundle
 *
 * The install.sh:
 *   1. Checks for / installs OrbStack (prerequisite — provides Docker runtime)
 *   2. Installs Container Cove → /Applications
 *   3. Fixes Docker credential config (docker-credential-desktop bug)
 *   4. Cleans up stale pkgutil receipts, refreshes Dock icon
 *
 * Usage:
 *   bun scripts/build-installer.ts
 */

import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
  cpSync,
} from "fs";
import { resolve, join } from "path";

// ── Logging ──────────────────────────────────────────────────────

const log = (msg: string) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${msg}`);
};

// ── Shell helper ─────────────────────────────────────────────────

interface ChildResult { code: number; stdout: string; stderr: string }

async function run(
  cmd: string,
  args: string[],
  opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ChildResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: opts.env ?? process.env,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ code: 124, stdout, stderr: "Timed out" });
    }, opts.timeout ?? 120_000);
    proc.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    proc.on("error", (err) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: err.message }); });
  });
}

// ── Build installer folder ────────────────────────────────────────

function buildInstallerFolder(outDir: string, appSrcPath: string, version: string): void {
  log("Building installer folder…");
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // Container Cove.app
  cpSync(appSrcPath, join(outDir, "Container Cove.app"), { recursive: true });
  log("Staged Container Cove.app");

  // install.sh
  const scriptPath = join(outDir, "install.sh");
  writeFileSync(scriptPath, buildInstallScript(version));
  chmodSync(scriptPath, 0o755);
  log("Wrote install.sh");
}

// ── install.sh content ────────────────────────────────────────────

function buildInstallScript(version: string): string {
  return `#!/bin/bash
# =============================================================================
#  Container Cove ${version} — macOS Installer
#  Run with:  bash install.sh
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\\033[0;31m'; GREEN='\\033[0;32m'; YELLOW='\\033[1;33m'; CYAN='\\033[0;36m'; BOLD='\\033[1m'; NC='\\033[0m'
info()    { echo -e "\${CYAN}[Container Cove]\${NC} \$1"; }
success() { echo -e "\${GREEN}[Container Cove]\${NC} ✓ \$1"; }
warn()    { echo -e "\${YELLOW}[Container Cove]\${NC} ⚠ \$1"; }
error()   { echo -e "\${RED}[Container Cove]\${NC} ✗ \$1"; exit 1; }
step()    { echo -e "\\n\${BOLD}\$1\${NC}"; }

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║   Container Cove ${version} — macOS Installer      ║"
echo "  ╚════════════════════════════════════════════════╝"
echo ""

# ── Step 1: OrbStack (prerequisite) ──────────────────────────────────────────
step "Step 1/4 — Container runtime (OrbStack)"

ORBSTACK_INSTALLED=false
DOCKER_AVAILABLE=false

# Check if Docker is already available (OrbStack or Docker Desktop)
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  DOCKER_AVAILABLE=true
  RUNTIME="\$(docker info --format '{{.OperatingSystem}}' 2>/dev/null || echo 'Docker')"
  success "Container runtime already running: \$RUNTIME"
elif command -v docker >/dev/null 2>&1; then
  # Docker CLI found but daemon not running — try to start it
  info "Docker found but not running — attempting to start…"
  open -a OrbStack 2>/dev/null || open -a Docker 2>/dev/null || true
  for i in \$(seq 1 15); do
    if docker info >/dev/null 2>&1; then
      DOCKER_AVAILABLE=true
      success "Container runtime started"
      break
    fi
    sleep 2
  done
fi

if [ "\$DOCKER_AVAILABLE" = "false" ]; then
  info "OrbStack not found. Installing via Homebrew…"
  echo ""

  # Ensure Homebrew is available
  if ! command -v brew >/dev/null 2>&1; then
    info "Homebrew not found — installing Homebrew first…"
    /bin/bash -c "\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add Homebrew to PATH for Apple Silicon
    if [ -f "/opt/homebrew/bin/brew" ]; then
      eval "\$(/opt/homebrew/bin/brew shellenv)"
    fi

    if ! command -v brew >/dev/null 2>&1; then
      error "Homebrew installation failed. Please install manually from https://brew.sh then re-run this installer."
    fi
    success "Homebrew installed"
  fi

  # Install OrbStack
  info "Installing OrbStack (this may take a moment)…"
  if brew install orbstack; then
    ORBSTACK_INSTALLED=true

    # OrbStack needs to be opened once to complete setup
    open -a OrbStack 2>/dev/null || true
    info "Waiting for OrbStack to start…"
    for i in \$(seq 1 20); do
      if docker info >/dev/null 2>&1; then
        DOCKER_AVAILABLE=true
        success "OrbStack installed and running"
        break
      fi
      sleep 3
    done

    if [ "\$DOCKER_AVAILABLE" = "false" ]; then
      warn "OrbStack installed but not yet ready. It will be available when you first launch Container Cove."
      warn "If prompted, open OrbStack from your Applications folder to complete setup."
    fi
  else
    warn "OrbStack installation via Homebrew failed."
    warn "Attempting Docker Desktop as fallback…"
    echo ""

    if brew install --cask docker; then
      open -a Docker 2>/dev/null || true
      info "Waiting for Docker Desktop to start…"
      for i in \$(seq 1 20); do
        if docker info >/dev/null 2>&1; then
          DOCKER_AVAILABLE=true
          success "Docker Desktop installed and running"
          break
        fi
        sleep 3
      done
      if [ "\$DOCKER_AVAILABLE" = "false" ]; then
        warn "Docker Desktop installed but not yet ready."
        warn "Open Docker Desktop from your Applications folder before launching Container Cove."
      fi
    else
      error "Both OrbStack and Docker Desktop installation failed.\\nPlease install OrbStack manually from https://orbstack.dev then re-run this installer."
    fi
  fi
fi

# ── Step 2: Install Container Cove ────────────────────────────────────────────
step "Step 2/4 — Installing Container Cove.app"

APP_SRC="\$SCRIPT_DIR/Container Cove.app"
APP_DST="/Applications/Container Cove.app"

if [ ! -d "\$APP_SRC" ]; then
  error "Container Cove.app not found at '\$APP_SRC'.\\nMake sure you are running install.sh from inside the installer folder."
fi

# Quit app if already running
if pgrep -x "Container Cove" >/dev/null 2>&1; then
  info "Quitting running Container Cove instance…"
  pkill -x "Container Cove" 2>/dev/null || true
  sleep 1
fi

# Remove previous install
if [ -d "\$APP_DST" ]; then
  warn "Removing previous installation…"
  /bin/rm -rf "\$APP_DST"
fi

/bin/cp -R "\$APP_SRC" "\$APP_DST"
/bin/chmod -R 755 "\$APP_DST"

# Fix ownership so the app belongs to the installing user, not root
REAL_USER="\${SUDO_USER:-}"
if [ -z "\$REAL_USER" ] || [ "\$REAL_USER" = "root" ]; then
  REAL_USER="\$(stat -f '%Su' /dev/console 2>/dev/null || echo '')"
fi
if [ -n "\$REAL_USER" ] && [ "\$REAL_USER" != "root" ]; then
  /usr/sbin/chown -R "\$REAL_USER":staff "\$APP_DST" 2>/dev/null || true
fi

success "Container Cove installed → \$APP_DST"

# ── Step 3: Fix Docker credential config ─────────────────────────────────────
step "Step 3/4 — Configuring Docker credentials"

# If Docker Desktop was ever installed, ~/.docker/config.json may contain
# "credsStore": "desktop" which causes image-pull failures with OrbStack.
# Fix A: create Container Cove's own clean config directory.
# Fix B: remove the broken credsStore key from the user's ~/.docker/config.json.

REAL_USER="\${SUDO_USER:-}"
if [ -z "\$REAL_USER" ] || [ "\$REAL_USER" = "root" ]; then
  REAL_USER="\$(stat -f '%Su' /dev/console 2>/dev/null || echo '')"
fi

if [ -n "\$REAL_USER" ] && [ "\$REAL_USER" != "root" ]; then
  USER_HOME="\$(eval echo ~\$REAL_USER)"

  # Fix A — Container Cove's own clean Docker config (no credsStore)
  CC_DOCKER_DIR="\$USER_HOME/.config/container-cove/docker"
  CC_DOCKER_CFG="\$CC_DOCKER_DIR/config.json"
  /bin/mkdir -p "\$CC_DOCKER_DIR"
  if [ ! -f "\$CC_DOCKER_CFG" ]; then
    echo '{ "auths": {} }' > "\$CC_DOCKER_CFG"
  fi
  /usr/sbin/chown -R "\$REAL_USER":staff "\$USER_HOME/.config/container-cove" 2>/dev/null || true
  success "Clean Docker config created → \$CC_DOCKER_CFG"

  # Fix B — patch ~/.docker/config.json if credsStore is set to 'desktop'
  DOCKER_CFG="\$USER_HOME/.docker/config.json"
  if [ -f "\$DOCKER_CFG" ] && grep -q '"credsStore"' "\$DOCKER_CFG" 2>/dev/null; then
    /bin/cp "\$DOCKER_CFG" "\$DOCKER_CFG.bak"
    python3 -c "
import json
with open('\$DOCKER_CFG', 'r') as f:
    cfg = json.load(f)
cfg.pop('credsStore', None)
cfg.pop('credStore', None)
with open('\$DOCKER_CFG', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null \
      && success "Removed stale credsStore from \$DOCKER_CFG (backup saved)" \
      || warn "Could not auto-patch \$DOCKER_CFG — Container Cove uses its own config so this won't affect functionality."
  fi
fi

# ── Step 4: Finalise ──────────────────────────────────────────────────────────
step "Step 4/4 — Finalising"

# Clear previous app list so the user starts fresh
REAL_USER="\${SUDO_USER:-}"
if [ -z "\$REAL_USER" ] || [ "\$REAL_USER" = "root" ]; then
  REAL_USER="\$(stat -f '%Su' /dev/console 2>/dev/null || echo '')"
fi
if [ -n "\$REAL_USER" ] && [ "\$REAL_USER" != "root" ]; then
  USER_HOME="\$(eval echo ~\$REAL_USER)"
  APPS_JSON="\$USER_HOME/Library/Application Support/container-cove/apps.json"
  if [ -f "\$APPS_JSON" ]; then
    /bin/rm -f "\$APPS_JSON"
    info "Cleared previous app list — fresh start"
  fi
fi

# Forget stale pkgutil receipts from old installs
for receipt in com.stevenazevedodesign.containercove com.azevedomedia.containercove; do
  if /usr/sbin/pkgutil --pkg-info "\$receipt" >/dev/null 2>&1; then
    /usr/sbin/pkgutil --forget "\$receipt" >/dev/null 2>&1 || true
    info "Cleared old receipt: \$receipt"
  fi
done

# Verify app exists
if [ ! -d "\$APP_DST" ]; then
  error "Installation may have failed — \$APP_DST not found."
fi
success "Container Cove verified at \$APP_DST"

# Refresh macOS icon cache so new icon appears in Dock / Finder immediately
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
  -f "\$APP_DST" 2>/dev/null || true
/usr/bin/touch "\$APP_DST"
/usr/bin/killall Dock 2>/dev/null || true
success "Dock icon refreshed"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║  ✓  Installation complete!                     ║"
echo "  ║                                                ║"
echo "  ║  Open Launchpad or Spotlight and search for    ║"
echo "  ║  'Container Cove' to launch.                   ║"
if [ "\$DOCKER_AVAILABLE" = "false" ]; then
echo "  ║                                                ║"
echo "  ║  ⚠  Open OrbStack from Applications first     ║"
echo "  ║     to complete container runtime setup.       ║"
fi
echo "  ╚════════════════════════════════════════════════╝"
echo ""
`;
}

// ── Zip the installer folder ──────────────────────────────────────

async function zipFolder(folderPath: string, zipPath: string): Promise<void> {
  log("Zipping installer folder…");
  // ditto preserves macOS metadata and resource forks correctly
  const r = await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", folderPath, zipPath], { timeout: 120_000 });
  if (r.code !== 0) throw new Error(`ditto zip failed: ${r.stderr}`);
  log(`Zip → ${zipPath}`);
}

// ── Main ──────────────────────────────────────────────────────────

if (import.meta.main) {
  (async () => {
    try {
      const root = resolve(import.meta.dir, "..");
      const buildDir = join(root, "build");

      // Read version
      let version = "1.2.0";
      try {
        const pkg = JSON.parse(await Bun.file(join(root, "package.json")).text());
        if (pkg.version) version = pkg.version;
      } catch { /* fallback */ }

      // Locate .app bundle
      const appPath = (() => {
        const prod = join(buildDir, "Container Cove.app");
        if (existsSync(prod)) return prod;
        const dev = join(buildDir, "dev-macos-arm64", "Container Cove-dev.app");
        if (existsSync(dev)) return dev;
        throw new Error("No .app bundle found. Run `bun run build:mac` first.");
      })();

      const outDir = join(buildDir, "ContainerCove-Installer");
      const zipPath = join(buildDir, `ContainerCove-${version}-Installer.zip`);

      log("=== Container Cove Installer Builder ===");
      log(`Version: ${version}`);
      log(`App:     ${appPath}`);
      log(`Output:  ${outDir}`);
      log("");

      // Build installer folder (no Podman download needed)
      buildInstallerFolder(outDir, appPath, version);

      // Zip it
      if (existsSync(zipPath)) rmSync(zipPath);
      await zipFolder(outDir, zipPath);

      const folderSizeMb = (() => {
        try {
          const { execFileSync } = require("child_process") as typeof import("child_process");
          return execFileSync("du", ["-sm", outDir]).toString().split("\t")[0] + " MB";
        } catch { return "?"; }
      })();

      log("");
      log(`✓ Installer folder: ${outDir}  (${folderSizeMb})`);
      log(`✓ Zip archive:      ${zipPath}`);
      log("");
      log("To install:  bash \"" + join(outDir, "install.sh") + "\"");

    } catch (err) {
      console.error("\n[ERROR]", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  })();
}

/**
 * scripts/build-installer.ts
 * Builds a distributable install.sh + folder for Container Cove.
 *
 * Output structure:
 *   build/ContainerCove-Installer/
 *     install.sh                  ← user runs this (or double-clicks via Finder)
 *     Container Cove.app/         ← the app bundle
 *     bin/
 *       podman                    ← Podman v4.9.2 (prerequisite, installed first)
 *       podman-mac-helper
 *
 * The install.sh:
 *   1. Installs Podman → /usr/local/bin   (prerequisite)
 *   2. Installs Container Cove → /Applications
 *   3. Verifies both are working
 *   4. Cleans up stale pkgutil receipts from previous installs
 *
 * Usage:
 *   bun scripts/build-installer.ts
 */

import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  chmodSync,
  cpSync,
  statSync,
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
      resolve({ code: 124, stdout, stderr: `Timed out` });
    }, opts.timeout ?? 120_000);
    proc.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    proc.on("error", (err) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: err.message }); });
  });
}

// ── Download Podman ───────────────────────────────────────────────

async function downloadPodman(buildDir: string): Promise<{ podman: string; helper: string }> {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const zipName = `podman-remote-release-darwin_${arch}.zip`;
  const url = `https://github.com/containers/podman/releases/download/v4.9.2/${zipName}`;
  const zipPath = join(buildDir, zipName);
  const extractDir = join(buildDir, "podman-extract");
  const binaryPath = join(extractDir, "podman-4.9.2", "usr", "bin", "podman");
  const helperPath = join(extractDir, "podman-4.9.2", "usr", "bin", "podman-mac-helper");

  if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true });

  if (existsSync(binaryPath)) {
    log("Using cached Podman binaries");
    return { podman: binaryPath, helper: helperPath };
  }

  log(`Downloading Podman v4.9.2 (${arch})…`);
  const dl = await run("curl", ["-L", "--progress-bar", "-o", zipPath, url], { timeout: 300_000 });
  if (dl.code !== 0) throw new Error(`Podman download failed: ${dl.stderr}`);

  log("Extracting Podman…");
  mkdirSync(extractDir, { recursive: true });
  const unzip = await run("unzip", ["-o", zipPath, "-d", extractDir], { timeout: 60_000 });
  if (unzip.code !== 0) throw new Error(`Unzip failed: ${unzip.stderr}`);

  if (!existsSync(binaryPath)) throw new Error(`Podman binary not found at ${binaryPath}`);
  chmodSync(binaryPath, 0o755);
  if (existsSync(helperPath)) chmodSync(helperPath, 0o755);

  log("Podman binaries ready");
  return { podman: binaryPath, helper: helperPath };
}

// ── Build installer folder ────────────────────────────────────────

function buildInstallerFolder(
  outDir: string,
  appSrcPath: string,
  podmanBinary: string,
  helperBinary: string,
  version: string,
): void {
  log("Building installer folder…");
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // bin/
  const binDir = join(outDir, "bin");
  mkdirSync(binDir, { recursive: true });
  copyFileSync(podmanBinary, join(binDir, "podman"));
  chmodSync(join(binDir, "podman"), 0o755);
  if (existsSync(helperBinary)) {
    copyFileSync(helperBinary, join(binDir, "podman-mac-helper"));
    chmodSync(join(binDir, "podman-mac-helper"), 0o755);
  }
  log("Staged Podman binaries → bin/");

  // Container Cove.app
  cpSync(appSrcPath, join(outDir, "Container Cove.app"), { recursive: true });
  log("Staged Container Cove.app");

  // install.sh
  const script = buildInstallScript(version);
  const scriptPath = join(outDir, "install.sh");
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
  log("Wrote install.sh");
}

// ── install.sh content ────────────────────────────────────────────

function buildInstallScript(version: string): string {
  return `#!/bin/bash
# =============================================================================
#  Container Cove ${version} — Installer
#  Run with:  sudo bash install.sh
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\\033[0;31m'; GREEN='\\033[0;32m'; YELLOW='\\033[1;33m'; CYAN='\\033[0;36m'; NC='\\033[0m'
info()    { echo -e "\${CYAN}[Container Cove]\${NC} \$1"; }
success() { echo -e "\${GREEN}[Container Cove]\${NC} \$1"; }
warn()    { echo -e "\${YELLOW}[Container Cove]\${NC} \$1"; }
error()   { echo -e "\${RED}[Container Cove]\${NC} \$1"; exit 1; }

# ── Must run as root ──────────────────────────────────────────────────────────
if [ "\$(id -u)" -ne 0 ]; then
  echo ""
  warn "This installer needs admin privileges. Re-running with sudo…"
  exec sudo bash "\$0" "\$@"
fi

# ── Locate script directory (works from any CWD) ──────────────────────────────
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║    Container Cove ${version} — Installer      ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Install Podman (prerequisite) ─────────────────────────────────────
info "Step 1/4 — Installing Podman v4.9.2 (prerequisite)…"

PODMAN_SRC="\$SCRIPT_DIR/bin/podman"
HELPER_SRC="\$SCRIPT_DIR/bin/podman-mac-helper"
PODMAN_DST="/usr/local/bin/podman"
HELPER_DST="/usr/local/bin/podman-mac-helper"

if [ ! -f "\$PODMAN_SRC" ]; then
  error "Podman binary not found at \$PODMAN_SRC. Make sure you are running install.sh from inside the installer folder."
fi

/bin/mkdir -p /usr/local/bin
/bin/cp -f "\$PODMAN_SRC" "\$PODMAN_DST"
/bin/chmod 755 "\$PODMAN_DST"
success "Podman installed → \$PODMAN_DST"

if [ -f "\$HELPER_SRC" ]; then
  /bin/cp -f "\$HELPER_SRC" "\$HELPER_DST"
  /bin/chmod 755 "\$HELPER_DST"
  success "podman-mac-helper installed → \$HELPER_DST"
fi

# Verify Podman works
if "\$PODMAN_DST" --version >/dev/null 2>&1; then
  PODMAN_VER="\$("\$PODMAN_DST" --version 2>&1 | head -1)"
  success "Podman verified: \$PODMAN_VER"
else
  error "Podman binary installed but failed to run. The system may need a restart."
fi

# ── Step 2: Install Container Cove ────────────────────────────────────────────
info "Step 2/4 — Installing Container Cove.app…"

APP_SRC="\$SCRIPT_DIR/Container Cove.app"
APP_DST="/Applications/Container Cove.app"

if [ ! -d "\$APP_SRC" ]; then
  error "Container Cove.app not found at '\$APP_SRC'. Make sure you are running install.sh from inside the installer folder."
fi

# Remove previous install if present
if [ -d "\$APP_DST" ]; then
  warn "Removing previous installation…"
  /bin/rm -rf "\$APP_DST"
fi

/bin/cp -R "\$APP_SRC" "\$APP_DST"
/bin/chmod -R 755 "\$APP_DST"

# Fix ownership so the app belongs to the installing user
REAL_USER="\${SUDO_USER:-}"
if [ -z "\$REAL_USER" ] || [ "\$REAL_USER" = "root" ]; then
  REAL_USER="\$(stat -f '%Su' /dev/console 2>/dev/null || echo '')"
fi
if [ -n "\$REAL_USER" ] && [ "\$REAL_USER" != "root" ]; then
  /usr/sbin/chown -R "\$REAL_USER":staff "\$APP_DST"
fi

success "Container Cove installed → \$APP_DST"

# ── Step 3: Fix Docker credential store (docker-credential-desktop bug) ────────
info "Step 3/4 — Fixing Docker credential configuration…"

# Problem: if Docker Desktop was ever installed, ~/.docker/config.json contains
#   "credsStore": "desktop"
# which makes Podman (and any Docker-compatible CLI) fail with:
#   "error getting credentials - err: exec: docker-credential-desktop:
#    executable file not found in \$PATH"
# when pulling ANY image — including all recommended apps.
#
# Fix A: create Container Cove's own clean config (used at runtime by the app).
# Fix B: remove the broken credsStore from ~/.docker/config.json if present.

# Determine the home directory of the real (non-root) user
REAL_USER="\${SUDO_USER:-}"
if [ -z "\$REAL_USER" ] || [ "\$REAL_USER" = "root" ]; then
  REAL_USER="\$(stat -f '%Su' /dev/console 2>/dev/null || echo '')"
fi

if [ -n "\$REAL_USER" ] && [ "\$REAL_USER" != "root" ]; then
  USER_HOME="\$(eval echo ~\$REAL_USER)"

  # Fix A — pre-create Container Cove's clean Docker config
  CC_DOCKER_DIR="\$USER_HOME/.config/container-cove/docker"
  CC_DOCKER_CFG="\$CC_DOCKER_DIR/config.json"
  /bin/mkdir -p "\$CC_DOCKER_DIR"
  if [ ! -f "\$CC_DOCKER_CFG" ]; then
    echo '{ "auths": {} }' > "\$CC_DOCKER_CFG"
  fi
  /usr/sbin/chown -R "\$REAL_USER":staff "\$USER_HOME/.config/container-cove"
  success "Clean Docker config created → \$CC_DOCKER_CFG"

  # Fix B — patch ~/.docker/config.json if credsStore is set to 'desktop'
  DOCKER_CFG="\$USER_HOME/.docker/config.json"
  if [ -f "\$DOCKER_CFG" ]; then
    if grep -q '"credsStore"' "\$DOCKER_CFG" 2>/dev/null; then
      # Back up first, then strip the credsStore key with Python (available on all macOS)
      /bin/cp "\$DOCKER_CFG" "\$DOCKER_CFG.bak"
      python3 -c "
import json, sys
with open('\$DOCKER_CFG', 'r') as f:
    cfg = json.load(f)
cfg.pop('credsStore', None)
cfg.pop('credStore', None)
with open('\$DOCKER_CFG', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null && warn "Removed broken credsStore from \$DOCKER_CFG (backup: \$DOCKER_CFG.bak)" \
             || warn "Could not auto-patch \$DOCKER_CFG — Container Cove uses its own config, so images will still work."
    fi
  fi
fi

# ── Step 4: Clean up old receipts & verify ────────────────────────────────────
info "Step 4/4 — Finalising…"

# Forget stale pkgutil receipts so future installs don't hit 'upgrade failed'
for receipt in com.stevenazevedodesign.containercove com.azevedomedia.containercove; do
  if /usr/sbin/pkgutil --pkg-info "\$receipt" >/dev/null 2>&1; then
    /usr/sbin/pkgutil --forget "\$receipt" >/dev/null 2>&1 || true
    info "Cleared old receipt: \$receipt"
  fi
done

# Verify app exists
if [ -d "\$APP_DST" ]; then
  success "Container Cove verified at \$APP_DST"
else
  error "Installation may have failed — \$APP_DST not found."
fi

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  ✓  Installation complete!               ║"
echo "  ║                                          ║"
echo "  ║  Open Launchpad or Spotlight and         ║"
echo "  ║  search for 'Container Cove' to launch.  ║"
echo "  ╚══════════════════════════════════════════╝"
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

      // Locate .app
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

      // 1. Download/cache Podman
      const { podman, helper } = await downloadPodman(buildDir);

      // 2. Build installer folder
      buildInstallerFolder(outDir, appPath, podman, helper, version);

      // 3. Zip it
      if (existsSync(zipPath)) rmSync(zipPath);
      await zipFolder(outDir, zipPath);

      // Summary
      const folderSizeMb = (() => {
        try {
          const { execFileSync } = require("child_process");
          const r = execFileSync("du", ["-sm", outDir]).toString();
          return r.split("\t")[0] + " MB";
        } catch { return "?"; }
      })();

      log("");
      log(`✓ Installer folder: ${outDir}  (${folderSizeMb})`);
      log(`✓ Zip archive:      ${zipPath}`);
      log("");
      log("To install:");
      log("  cd \"" + outDir + "\"");
      log("  sudo bash install.sh");

    } catch (err) {
      console.error("\n[ERROR]", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  })();
}

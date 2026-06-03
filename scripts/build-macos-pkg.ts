/**
 * scripts/build-macos-pkg.ts
 * Builds a distributable macOS .pkg installer for Container Cove.
 *
 * The package:
 *   1. Installs Container Cove.app → /Applications/
 *   2. Installs OrbStack.app → /Applications/ (bundled)
 *   3. Fixes Docker credential conflicts if Docker Desktop was installed
 *   4. Refreshes the Dock icon
 *
 * Usage:
 *   bun scripts/build-macos-pkg.ts
 *   APPLE_INSTALLER_IDENTITY="Developer ID Installer: ..." bun scripts/build-macos-pkg.ts
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

// ── Types ────────────────────────────────────────────────────────

interface ChildResult { code: number; stdout: string; stderr: string }

// ── Logging ──────────────────────────────────────────────────────

const log = (msg: string) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${msg}`);
};

// ── Shell helper ─────────────────────────────────────────────────

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
      resolve({ code: 124, stdout, stderr: `Timed out after ${opts.timeout}ms` });
    }, opts.timeout ?? 120_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

// ── Download + extract OrbStack ───────────────────────────────────

async function fetchOrbStack(orbCacheDir: string): Promise<string> {
  // Prefer a locally installed copy — no download needed
  if (existsSync("/Applications/OrbStack.app")) {
    log("OrbStack.app found in /Applications — using local copy");
    return "/Applications/OrbStack.app";
  }

  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const dmgCached = join(orbCacheDir, `OrbStack-stable-${arch}.dmg`);
  const extractedApp = join(orbCacheDir, "OrbStack.app");

  // Re-use a previously extracted copy to skip the slow ditto step
  if (existsSync(extractedApp)) {
    log(`Using cached OrbStack.app: ${extractedApp}`);
    return extractedApp;
  }

  // Download DMG if not already cached
  if (!existsSync(dmgCached)) {
    const orbUrl = `https://orbstack.dev/download/stable/${arch}/dmg`;
    log(`Downloading OrbStack (${arch}) from ${orbUrl} …`);
    const r = await run(
      "curl",
      ["-L", "--progress-bar", "-o", dmgCached, orbUrl],
      { timeout: 600_000 },
    );
    if (r.code !== 0) throw new Error(`OrbStack download failed:\n${r.stderr}`);
    log("OrbStack download complete");
  } else {
    log(`Using cached OrbStack DMG: ${dmgCached}`);
  }

  // Mount → ditto → unmount
  const mountPoint = join(orbCacheDir, "dmg-mount");
  mkdirSync(mountPoint, { recursive: true });

  // Detach stale mount if any
  await run("hdiutil", ["detach", mountPoint, "-quiet", "-force"], { timeout: 30_000 });

  log("Mounting OrbStack DMG…");
  const mountR = await run(
    "hdiutil",
    ["attach", dmgCached, "-nobrowse", "-quiet", "-mountpoint", mountPoint],
    { timeout: 120_000 },
  );
  if (mountR.code !== 0) throw new Error(`DMG mount failed:\n${mountR.stderr}`);

  try {
    const appInDmg = join(mountPoint, "OrbStack.app");
    if (!existsSync(appInDmg))
      throw new Error(`OrbStack.app not found in mounted DMG at ${appInDmg}`);

    log("Extracting OrbStack.app (this may take a minute)…");
    // ditto preserves HFS+ metadata / symlinks better than cpSync
    const dittoR = await run(
      "ditto",
      [appInDmg, extractedApp],
      { timeout: 300_000 },
    );
    if (dittoR.code !== 0) throw new Error(`ditto failed:\n${dittoR.stderr}`);
    log("OrbStack.app extracted");
  } finally {
    await run("hdiutil", ["detach", mountPoint, "-quiet", "-force"], { timeout: 60_000 });
  }

  return extractedApp;
}

// ── Stage root payload ────────────────────────────────────────────

function stagePayload(
  stageDir: string,
  appSrcPath: string,
  orbStackPath: string,
): void {
  log("Staging installer payload…");
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true });

  const appsDir = join(stageDir, "Applications");
  mkdirSync(appsDir, { recursive: true });

  // Container Cove.app
  const appDest = join(appsDir, "Container Cove.app");
  cpSync(appSrcPath, appDest, { recursive: true });
  log(`Staged Container Cove.app → ${appDest}`);

  // OrbStack.app
  const orbDest = join(appsDir, "OrbStack.app");
  cpSync(orbStackPath, orbDest, { recursive: true });
  log(`Staged OrbStack.app → ${orbDest}`);
}

// ── Scripts (pre/post install) ────────────────────────────────────

function writeScripts(scriptsDir: string): void {
  mkdirSync(scriptsDir, { recursive: true });

  // preinstall: disk space check only (OrbStack is bundled)
  const preinstall = `#!/bin/bash
set -euo pipefail

info() { echo "[Container Cove] $1"; }
warn() { echo "[Container Cove] ⚠ $1"; }

# Require at least 1 GB free on the target volume
FREE_KB=$(df -k / | awk 'NR==2{print $4}')
MIN_KB=$((1024 * 1024))
if [ "\${FREE_KB}" -lt "\${MIN_KB}" ]; then
  warn "Less than 1 GB free on /. Please free up disk space and retry."
  exit 1
fi

info "Disk space OK ($(( FREE_KB / 1024 )) MB free)"
exit 0
`;

  // postinstall: ownership, credential fix, OrbStack first-launch, Dock refresh
  const postinstall = `#!/bin/bash
set -euo pipefail

CC_APP="/Applications/Container Cove.app"
ORB_APP="/Applications/OrbStack.app"

info()    { echo "[Container Cove] $1"; }
success() { echo "[Container Cove] ✓ $1"; }
warn()    { echo "[Container Cove] ⚠ $1"; }

# Determine the real (non-root) user running the install
REAL_USER="\${SUDO_USER:-}"
if [ -z "\${REAL_USER}" ] || [ "\${REAL_USER}" = "root" ]; then
  REAL_USER="$(stat -f '%Su' /dev/console 2>/dev/null || echo '')"
fi

# ── 1. Fix app ownership ─────────────────────────────────────────────────────
if [ -n "\${REAL_USER}" ] && [ "\${REAL_USER}" != "root" ]; then
  /usr/sbin/chown -R "\${REAL_USER}":staff "\${CC_APP}"
  /usr/sbin/chown -R "\${REAL_USER}":staff "\${ORB_APP}"
  success "App ownership set to \${REAL_USER}"
fi

# ── 2. Fix Docker credential store (docker-credential-desktop bug) ───────────
if [ -n "\${REAL_USER}" ] && [ "\${REAL_USER}" != "root" ]; then
  USER_HOME="$(eval echo ~\${REAL_USER})"

  CC_DOCKER_DIR="\${USER_HOME}/.config/container-cove/docker"
  CC_DOCKER_CFG="\${CC_DOCKER_DIR}/config.json"
  /bin/mkdir -p "\${CC_DOCKER_DIR}"
  if [ ! -f "\${CC_DOCKER_CFG}" ]; then
    echo '{ "auths": {} }' > "\${CC_DOCKER_CFG}"
  fi
  /usr/sbin/chown -R "\${REAL_USER}":staff "\${USER_HOME}/.config/container-cove"
  success "Clean Docker config created → \${CC_DOCKER_CFG}"

  DOCKER_CFG="\${USER_HOME}/.docker/config.json"
  if [ -f "\${DOCKER_CFG}" ]; then
    if grep -q '"credsStore"' "\${DOCKER_CFG}" 2>/dev/null; then
      /bin/cp "\${DOCKER_CFG}" "\${DOCKER_CFG}.bak"
      python3 -c "
import json
with open('\${DOCKER_CFG}', 'r') as f:
    cfg = json.load(f)
cfg.pop('credsStore', None)
cfg.pop('credStore', None)
with open('\${DOCKER_CFG}', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null && warn "Removed broken credsStore from \${DOCKER_CFG} (backup: \${DOCKER_CFG}.bak)" || true
    fi
  fi
fi

# ── 3. Clean up old receipts & app list ──────────────────────────────────────
if [ -n "\${REAL_USER}" ] && [ "\${REAL_USER}" != "root" ]; then
  USER_HOME="$(eval echo ~\${REAL_USER})"
  APPS_JSON="\${USER_HOME}/Library/Application Support/container-cove/apps.json"
  if [ -f "\${APPS_JSON}" ]; then
    /bin/rm -f "\${APPS_JSON}"
    info "Cleared previous app list → fresh start"
  fi
fi

for receipt in com.stevenazevedodesign.containercove com.azevedomedia.containercove; do
  if /usr/sbin/pkgutil --pkg-info "\${receipt}" >/dev/null 2>&1; then
    /usr/sbin/pkgutil --forget "\${receipt}" >/dev/null 2>&1 || true
    info "Cleared old receipt: \${receipt}"
  fi
done

# ── 4. Launch OrbStack so it can initialize its VM on first run ──────────────
if [ -n "\${REAL_USER}" ] && [ "\${REAL_USER}" != "root" ]; then
  info "Launching OrbStack to complete initial setup…"
  /bin/launchctl asuser "$(id -u "\${REAL_USER}")" \
    /usr/bin/open -a "\${ORB_APP}" 2>/dev/null || true
  success "OrbStack launch requested"
fi

# ── 5. Refresh macOS icon cache ──────────────────────────────────────────────
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "\${CC_APP}" 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "\${ORB_APP}" 2>/dev/null || true
/usr/bin/touch "\${CC_APP}"
/usr/bin/killall Dock 2>/dev/null || true
success "Dock icons refreshed"

success "Installation complete! Open Container Cove from your Applications folder."
exit 0
`;

  writeFileSync(join(scriptsDir, "preinstall"), preinstall);
  chmodSync(join(scriptsDir, "preinstall"), 0o755);

  writeFileSync(join(scriptsDir, "postinstall"), postinstall);
  chmodSync(join(scriptsDir, "postinstall"), 0o755);

  log("Wrote preinstall + postinstall scripts");
}

// ── Build component .pkg ──────────────────────────────────────────

async function buildComponentPkg(
  stageDir: string,
  scriptsDir: string,
  outputDir: string,
  identifier: string,
  version: string,
): Promise<string> {
  const componentPkg = join(outputDir, "ContainerCove-component.pkg");
  log("Building component package…");
  const r = await run("pkgbuild", [
    "--root", stageDir,
    "--identifier", identifier,
    "--version", version,
    "--scripts", scriptsDir,
    "--install-location", "/",
    componentPkg,
  ], { timeout: 180_000 });
  if (r.code !== 0) throw new Error(`pkgbuild failed: ${r.stderr || r.stdout}`);
  log(`Component pkg → ${componentPkg}`);
  return componentPkg;
}

// ── Write distribution XML ────────────────────────────────────────

function writeDistribution(
  xmlPath: string,
  componentPkg: string,
  version: string,
  hasBackground: boolean,
): void {
  const bgLine = hasBackground
    ? `  <background file="background.png" scaling="proportional" alignment="bottomleft" mime-type="image/png"/>\n`
    : "";
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Container Cove ${version}</title>
  <welcome file="welcome.html" mime-type="text/html"/>
  <organization>com.stevenazevedodesign</organization>
  <domains enable_localSystem="true" enable_userHome="false"/>
  <options customize="never" require-scripts="true" allow-external-scripts="yes" rootVolumeOnly="true"/>
${bgLine}  <pkg-ref id="com.stevenazevedodesign.containercove"/>
  <choices-outline>
    <line choice="default">
      <line choice="com.stevenazevedodesign.containercove"/>
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="com.stevenazevedodesign.containercove" visible="false">
    <pkg-ref id="com.stevenazevedodesign.containercove"/>
  </choice>
  <pkg-ref id="com.stevenazevedodesign.containercove" version="${version}" onConclusion="none" auth="root">${componentPkg.split("/").pop()}</pkg-ref>
</installer-gui-script>
`;
  writeFileSync(xmlPath, xml);
}

// ── Write welcome HTML ────────────────────────────────────────────

function writeWelcome(resourcesDir: string, version: string): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
    font-size: 13px;
    line-height: 1.6;
    color: #1d1d1f;
    padding: 20px 24px;
    margin: 0;
  }
  h2 {
    font-size: 17px;
    font-weight: 600;
    margin: 0 0 10px;
    color: #000;
  }
  p { margin: 0 0 10px; }
  ul { margin: 0 0 12px; padding-left: 20px; }
  li { margin-bottom: 4px; }
  .included {
    background: #f0faf0;
    border: 1px solid #6abf6a;
    border-radius: 6px;
    padding: 10px 14px;
    margin-top: 14px;
  }
  .included strong { color: #2a6e2a; }
  code {
    font-family: "SF Mono", Menlo, monospace;
    font-size: 12px;
    background: #f2f2f7;
    padding: 1px 5px;
    border-radius: 3px;
  }
</style>
</head>
<body>
  <h2>Container Cove ${version}</h2>
  <p>Run Docker containers as desktop apps — no terminal needed.</p>
  <p>This installer will:</p>
  <ul>
    <li>Install <strong>Container Cove.app</strong> to <code>/Applications</code></li>
    <li>Install <strong>OrbStack.app</strong> to <code>/Applications</code> (container engine)</li>
    <li>Configure Docker credentials for clean image pulls</li>
    <li>Refresh the Dock icons immediately</li>
  </ul>
  <div class="included">
    <strong>✓ OrbStack Included</strong><br>
    OrbStack is bundled in this installer — no separate download required.
    It will launch automatically after installation to complete its initial setup.
  </div>
</body>
</html>`;
  writeFileSync(join(resourcesDir, "welcome.html"), html);
}

// ── productbuild final .pkg ───────────────────────────────────────

async function buildProductPkg(
  distributionXml: string,
  componentPkg: string,
  resourcesDir: string,
  outputPkg: string,
  signIdentity?: string,
): Promise<void> {
  log("Building product package…");
  const args = [
    "--distribution", distributionXml,
    "--package-path", resolve(componentPkg, ".."),
    "--resources", resourcesDir,
  ];
  if (signIdentity) {
    args.push("--sign", signIdentity);
    log(`Signing with: ${signIdentity}`);
  }
  args.push(outputPkg);

  const r = await run("productbuild", args, { timeout: 300_000 });
  if (r.code !== 0) throw new Error(`productbuild failed: ${r.stderr || r.stdout}`);
  log(`Product pkg → ${outputPkg}`);
}

// ── Main ──────────────────────────────────────────────────────────

if (import.meta.main) {
  (async () => {
    try {
      const root = resolve(import.meta.dir, "..");
      const buildDir = join(root, "build");
      const orbCacheDir = join(buildDir, "orb-cache");
      const pkgWorkDir = join(buildDir, "pkg-work");
      const stageDir = join(pkgWorkDir, "stage");
      const scriptsDir = join(pkgWorkDir, "scripts");
      const resourcesDir = join(pkgWorkDir, "resources");

      // Read version from package.json
      let version = "1.2.1";
      try {
        const pkg = JSON.parse(await Bun.file(join(root, "package.json")).text());
        if (pkg.version) version = pkg.version;
      } catch { /* fallback */ }

      // Locate Container Cove .app (prefer production, fall back to dev build)
      const appPath = (() => {
        const prod = join(buildDir, "Container Cove.app");
        if (existsSync(prod)) return prod;
        const dev = join(buildDir, "dev-macos-arm64", "Container Cove-dev.app");
        if (existsSync(dev)) return dev;
        throw new Error("No .app bundle found. Run `bun run build:mac` first.");
      })();

      const outputPkg = join(buildDir, `Container Cove-${version}.pkg`);
      const signIdentity = process.env.APPLE_INSTALLER_IDENTITY;

      log("=== Container Cove macOS PKG Builder ===");
      log(`Version:  ${version}`);
      log(`App:      ${appPath}`);
      log(`Output:   ${outputPkg}`);
      log(`Signing:  ${signIdentity ?? "disabled (set APPLE_INSTALLER_IDENTITY)"}`);
      log("");

      // 1. Fetch OrbStack (download if needed, cache in build/orb-cache/)
      mkdirSync(orbCacheDir, { recursive: true });
      mkdirSync(pkgWorkDir, { recursive: true });
      const orbStackPath = await fetchOrbStack(orbCacheDir);

      // 2. Stage payload (Container Cove + OrbStack)
      stagePayload(stageDir, appPath, orbStackPath);

      // 3. Write installer scripts
      writeScripts(scriptsDir);

      // 4. Write welcome page + optional background image
      mkdirSync(resourcesDir, { recursive: true });
      writeWelcome(resourcesDir, version);

      let hasBackground = false;
      const iconSrc = join(root, "assets", "App_Icon.png");
      const bgPath = join(resourcesDir, "background.png");
      if (existsSync(iconSrc)) {
        const makeBackground = await run("python3", ["-c", `
import subprocess, os
icon = "${iconSrc}"
out  = "${bgPath}"
tmp  = out + ".icon128.png"
subprocess.run(["sips", "-z", "128", "128", icon, "--out", tmp], check=True, capture_output=True)
try:
    from AppKit import NSImage, NSGraphicsContext, NSColor, NSRect, NSSize
    import Quartz
    bg = NSImage.alloc().initWithSize_(NSSize(600, 400))
    bg.lockFocus()
    NSColor.whiteColor().setFill()
    from AppKit import NSRectFill
    NSRectFill(((0,0),(600,400)))
    icon_img = NSImage.alloc().initWithContentsOfFile_(tmp)
    if icon_img:
        x = (600 - 128) / 2
        y = (400 - 128) / 2
        icon_img.drawInRect_(((x, y), (128, 128)))
    bg.unlockFocus()
    data = bg.TIFFRepresentation()
    from AppKit import NSBitmapImageRep, NSPNGFileType
    rep = NSBitmapImageRep.imageRepWithData_(data)
    png = rep.representationUsingType_properties_(NSPNGFileType, None)
    png.writeToFile_atomically_(out, True)
    os.unlink(tmp)
except Exception:
    import shutil; shutil.copy(tmp, out); os.unlink(tmp)
`]);
        hasBackground = makeBackground.code === 0 && existsSync(bgPath);
        if (hasBackground) log("Generated background.png for installer");
        else log("Background image generation skipped — continuing without it");
      }

      // 5. Component pkg
      const componentPkg = await buildComponentPkg(
        stageDir, scriptsDir, pkgWorkDir,
        "com.stevenazevedodesign.containercove", version,
      );

      // 6. Distribution XML
      const distributionXml = join(pkgWorkDir, "distribution.xml");
      writeDistribution(distributionXml, componentPkg, version, hasBackground);

      // 7. Final product pkg
      await buildProductPkg(distributionXml, componentPkg, resourcesDir, outputPkg, signIdentity);

      // 8. Size report
      const stat = Bun.file(outputPkg);
      const mb = ((await stat.arrayBuffer()).byteLength / 1_048_576).toFixed(1);
      log("");
      log(`✓ PKG ready: ${outputPkg} (${mb} MB)`);
      process.exit(0);
    } catch (err) {
      console.error("PKG build failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  })();
}

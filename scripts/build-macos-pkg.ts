/**
 * scripts/build-macos-pkg.ts
 * Builds a distributable macOS .pkg installer for Container Cove.
 *
 * The package:
 *   1. Installs Container Cove.app → /Applications/
 *   2. Installs podman + podman-mac-helper → /usr/local/bin/
 *   3. postinstall script initialises the Podman machine on first run
 *
 * Usage:
 *   bun scripts/build-macos-pkg.ts
 *   APPLE_SIGNING_IDENTITY="..." bun scripts/build-macos-pkg.ts
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

// ── Download Podman binaries ──────────────────────────────────────

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
  const dl = await run("curl", ["-L", "--max-time", "120", "-o", zipPath, url]);
  if (dl.code !== 0) throw new Error(`Podman download failed: ${dl.stderr}`);

  if (existsSync(extractDir)) rmSync(extractDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  log("Extracting Podman archive…");
  const ex = await run("unzip", [
    "-o", zipPath,
    "podman-4.9.2/usr/bin/podman",
    "podman-4.9.2/usr/bin/podman-mac-helper",
    "-d", extractDir,
  ]);
  if (ex.code !== 0) throw new Error(`Extraction failed: ${ex.stderr}`);
  if (!existsSync(binaryPath)) throw new Error("Podman binary not found after extraction");

  chmodSync(binaryPath, 0o755);
  if (existsSync(helperPath)) chmodSync(helperPath, 0o755);

  log("Podman binaries ready");
  return { podman: binaryPath, helper: helperPath };
}

// ── Stage root payload ────────────────────────────────────────────
// Strategy: bundle Podman INSIDE the .app (Contents/MacOS/podman).
// The postinstall script then copies it from the app to /usr/local/bin.
// This avoids any separate payload to /usr/local/bin that macOS can block.

function stagePayload(
  stageDir: string,
  appSrcPath: string,
  podmanBinary: string,
  helperBinary: string,
): void {
  log("Staging installer payload…");
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true });

  // /Applications/Container Cove.app
  const appsDir = join(stageDir, "Applications");
  mkdirSync(appsDir, { recursive: true });
  const appDest = join(appsDir, "Container Cove.app");
  cpSync(appSrcPath, appDest, { recursive: true });
  log(`Staged app → ${appDest}`);

  // Embed Podman binaries inside the app bundle (Contents/MacOS/)
  // postinstall will copy them to /usr/local/bin after the app is installed
  const macosDir = join(appDest, "Contents", "MacOS");
  mkdirSync(macosDir, { recursive: true });

  copyFileSync(podmanBinary, join(macosDir, "podman"));
  chmodSync(join(macosDir, "podman"), 0o755);
  log("Bundled podman → app bundle Contents/MacOS/podman");

  if (existsSync(helperBinary)) {
    copyFileSync(helperBinary, join(macosDir, "podman-mac-helper"));
    chmodSync(join(macosDir, "podman-mac-helper"), 0o755);
    log("Bundled podman-mac-helper → app bundle Contents/MacOS/podman-mac-helper");
  }
}

// ── Scripts (pre/post install) ────────────────────────────────────

function writeScripts(scriptsDir: string): void {
  mkdirSync(scriptsDir, { recursive: true });

  // preinstall: ensure /usr/local/bin exists
  const preinstall = `#!/bin/bash
/bin/mkdir -p /usr/local/bin
/bin/chmod 755 /usr/local/bin
exit 0
`;

  // postinstall: copy Podman from inside the app bundle to /usr/local/bin
  const postinstall = `#!/bin/bash
APP="/Applications/Container Cove.app"
SRC_PODMAN="$APP/Contents/MacOS/podman"
SRC_HELPER="$APP/Contents/MacOS/podman-mac-helper"
DST="/usr/local/bin"

echo "[Container Cove] Installing Podman to $DST..."

/bin/mkdir -p "$DST"

if [ ! -f "$SRC_PODMAN" ]; then
  echo "[Container Cove] ERROR: podman not found inside app bundle at $SRC_PODMAN"
  exit 1
fi

/bin/cp -f "$SRC_PODMAN" "$DST/podman"
/bin/chmod 755 "$DST/podman"
echo "[Container Cove] Installed podman → $DST/podman"

if [ -f "$SRC_HELPER" ]; then
  /bin/cp -f "$SRC_HELPER" "$DST/podman-mac-helper"
  /bin/chmod 755 "$DST/podman-mac-helper"
  echo "[Container Cove] Installed podman-mac-helper → $DST/podman-mac-helper"
fi

echo "[Container Cove] Podman installation complete"
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
  ], { timeout: 120_000 });
  if (r.code !== 0) throw new Error(`pkgbuild failed: ${r.stderr || r.stdout}`);
  log(`Component pkg → ${componentPkg}`);
  return componentPkg;
}

// ── Write distribution XML ────────────────────────────────────────

function writeDistribution(xmlPath: string, componentPkg: string, version: string): void {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Container Cove ${version}</title>
  <welcome file="welcome.html" mime-type="text/html"/>
  <organization>com.stevenazevedodesign</organization>
  <domains enable_localSystem="true" enable_userHome="false"/>
  <options customize="never" require-scripts="false" rootVolumeOnly="true"/>
  <background file="background.png" scaling="proportional" alignment="bottomleft"/>
  <pkg-ref id="com.stevenazevedodesign.containercove"/>
  <choices-outline>
    <line choice="default">
      <line choice="com.stevenazevedodesign.containercove"/>
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="com.stevenazevedodesign.containercove" visible="false">
    <pkg-ref id="com.stevenazevedodesign.containercove"/>
  </choice>
  <pkg-ref id="com.stevenazevedodesign.containercove" version="${version}" onConclusion="none">${componentPkg.split("/").pop()}</pkg-ref>
</installer-gui-script>
`;
  writeFileSync(xmlPath, xml);
}

// ── Write welcome HTML ────────────────────────────────────────────

function writeWelcome(resourcesDir: string, version: string): void {
  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,sans-serif;padding:20px">
<h2>Container Cove ${version}</h2>
<p>This installer will:</p>
<ul>
  <li>Install <strong>Container Cove</strong> to <code>/Applications</code></li>
  <li>Install <strong>Podman v4.9.2</strong> to <code>/usr/local/bin</code></li>
  <li>Initialise the Podman machine on first run</li>
</ul>
<p>No Docker daemon or background service required.</p>
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

  const r = await run("productbuild", args, { timeout: 180_000 });
  if (r.code !== 0) throw new Error(`productbuild failed: ${r.stderr || r.stdout}`);
  log(`Product pkg → ${outputPkg}`);
}

// ── Main ──────────────────────────────────────────────────────────

if (import.meta.main) {
  (async () => {
    try {
      const root = resolve(import.meta.dir, "..");
      const buildDir = join(root, "build");
      const pkgWorkDir = join(buildDir, "pkg-work");
      const stageDir = join(pkgWorkDir, "stage");
      const scriptsDir = join(pkgWorkDir, "scripts");
      const resourcesDir = join(pkgWorkDir, "resources");

      // Read version from package.json
      let version = "1.2.0";
      try {
        const pkg = JSON.parse(await Bun.file(join(root, "package.json")).text());
        if (pkg.version) version = pkg.version;
      } catch { /* fallback */ }

      // Locate .app (prefer production, fall back to dev build)
      const appPath = (() => {
        const prod = join(buildDir, "Container Cove.app");
        if (existsSync(prod)) return prod;
        const dev = join(buildDir, "dev-macos-arm64", "Container Cove-dev.app");
        if (existsSync(dev)) return dev;
        throw new Error("No .app bundle found. Run `bun run build:mac` first.");
      })();

      const outputPkg = join(buildDir, `Container Cove-${version}.pkg`);
      const signIdentity = process.env.APPLE_INSTALLER_IDENTITY; // "Developer ID Installer: ..."

      log("=== Container Cove macOS PKG Builder ===");
      log(`Version:  ${version}`);
      log(`App:      ${appPath}`);
      log(`Output:   ${outputPkg}`);
      log(`Signing:  ${signIdentity ?? "disabled (set APPLE_INSTALLER_IDENTITY)"}`);
      log("");

      // 1. Download Podman
      const { podman, helper } = await downloadPodman(buildDir);

      // 2. Stage payload
      mkdirSync(pkgWorkDir, { recursive: true });
      stagePayload(stageDir, appPath, podman, helper);

      // 3. Write installer scripts
      writeScripts(scriptsDir);

      // 4. Write welcome page
      mkdirSync(resourcesDir, { recursive: true });
      writeWelcome(resourcesDir, version);

      // 5. Component pkg
      const componentPkg = await buildComponentPkg(
        stageDir, scriptsDir, pkgWorkDir,
        "com.stevenazevedodesign.containercove", version,
      );

      // 6. Distribution XML
      const distributionXml = join(pkgWorkDir, "distribution.xml");
      writeDistribution(distributionXml, componentPkg, version);

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

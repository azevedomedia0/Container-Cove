import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  rmSync,
} from "fs";
import { resolve, join } from "path";
import * as fs from "fs";

const log = (msg: string) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${msg}`);
};

interface BuildOptions {
  appPath: string; // Path to built .app bundle
  outputDir: string; // Output directory for .dmg
  version: string; // App version from package.json
  signIdentity?: string; // Code signing identity (optional)
  notarize?: boolean; // Enable notarization
}

interface ChildProcessOptions {
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * Execute a shell command and return result
 */
async function executeCommand(
  cmd: string,
  args: string[],
  opts: ChildProcessOptions = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const timeout = opts.timeout || 60000;
    const childProcess = spawn(cmd, args, {
      env: { ...process.env, ...opts.env },
      timeout,
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    childProcess.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      childProcess.kill();
      resolve({
        code: 124,
        stdout,
        stderr: `Timeout after ${timeout}ms`,
      });
    }, timeout);

    childProcess.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code || 0,
        stdout,
        stderr,
      });
    });

    childProcess.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: 1,
        stdout,
        stderr: err.message,
      });
    });
  });
}

/**
 * Download and extract Podman binaries from GitHub releases (macOS arm64).
 * Returns the path to the extracted podman binary.
 */
async function downloadPodman(outputDir: string): Promise<string> {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const zipName = `podman-remote-release-darwin_${arch}.zip`;
  const downloadUrl = `https://github.com/containers/podman/releases/download/v4.9.2/${zipName}`;
  const zipPath = join(outputDir, zipName);
  const extractDir = join(outputDir, "podman-extract");
  const binaryPath = join(extractDir, "podman-4.9.2", "usr", "bin", "podman");
  const helperPath = join(extractDir, "podman-4.9.2", "usr", "bin", "podman-mac-helper");

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // Re-use cached extraction if already done
  if (existsSync(binaryPath)) {
    log(`Using cached Podman binary at ${binaryPath}`);
    return binaryPath;
  }

  log(`Downloading Podman v4.9.2 (${arch})...`);
  const dl = await executeCommand("curl", ["-L", "--max-time", "120", "-o", zipPath, downloadUrl]);
  if (dl.code !== 0) throw new Error(`Failed to download Podman: ${dl.stderr || dl.stdout}`);
  log(`Downloaded to ${zipPath}`);

  if (existsSync(extractDir)) rmSync(extractDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  log("Extracting Podman archive...");
  const ex = await executeCommand("unzip", ["-o", zipPath, "podman-4.9.2/usr/bin/podman", "podman-4.9.2/usr/bin/podman-mac-helper", "-d", extractDir]);
  if (ex.code !== 0) throw new Error(`Failed to extract Podman: ${ex.stderr || ex.stdout}`);

  if (!existsSync(binaryPath)) throw new Error(`Podman binary not found after extraction: ${binaryPath}`);

  // Make both binaries executable
  chmodSync(binaryPath, 0o755);
  if (existsSync(helperPath)) chmodSync(helperPath, 0o755);

  log(`Podman binary ready at ${binaryPath}`);
  return binaryPath;
}

/**
 * Bundle Podman binary inside .app bundle
 */
async function bundlePodmanBinary(
  appPath: string,
  podmanBinary: string
): Promise<void> {
  log("Bundling Podman binary into .app bundle...");

  if (!existsSync(appPath)) {
    throw new Error(`App bundle not found at ${appPath}`);
  }

  if (!existsSync(podmanBinary)) {
    throw new Error(`Podman binary not found at ${podmanBinary}`);
  }

  const contentsPath = join(appPath, "Contents");
  const macosPath = join(contentsPath, "MacOS");

  // Create MacOS directory if it doesn't exist
  if (!existsSync(macosPath)) {
    mkdirSync(macosPath, { recursive: true });
    log(`Created ${macosPath}`);
  }

  const targetPath = join(macosPath, "podman");
  const helperSrc = join(podmanBinary, "..", "podman-mac-helper");
  const helperDst = join(macosPath, "podman-mac-helper");

  // Copy podman binary
  copyFileSync(podmanBinary, targetPath);
  chmodSync(targetPath, 0o755);
  log(`Bundled podman → ${targetPath}`);

  // Copy podman-mac-helper if present
  if (existsSync(helperSrc)) {
    copyFileSync(helperSrc, helperDst);
    chmodSync(helperDst, 0o755);
    log(`Bundled podman-mac-helper → ${helperDst}`);
  }

  const verifyResult = await executeCommand("file", [targetPath]);
  if (verifyResult.code === 0) log(`Verified: ${verifyResult.stdout.trim()}`);
}

/**
 * Code sign the .app bundle
 */
async function signApp(appPath: string, signIdentity: string): Promise<void> {
  log(`Code signing app bundle with identity: ${signIdentity}`);

  if (!existsSync(appPath)) {
    throw new Error(`App bundle not found at ${appPath}`);
  }

  const signResult = await executeCommand("codesign", [
    "--deep",
    "--force",
    "--verbose",
    "--sign",
    signIdentity,
    appPath,
  ]);

  if (signResult.code !== 0) {
    throw new Error(
      `Code signing failed: ${signResult.stderr || signResult.stdout}`
    );
  }

  log("Code signing complete");

  // Verify signature
  log("Verifying signature...");
  const verifyResult = await executeCommand("codesign", ["-v", appPath]);

  if (verifyResult.code !== 0) {
    throw new Error(
      `Signature verification failed: ${verifyResult.stderr || verifyResult.stdout}`
    );
  }

  log("Signature verified successfully");
}

/**
 * Create DMG installer file
 */
async function createDMG(
  appPath: string,
  outputDir: string,
  version: string
): Promise<string> {
  log("Creating DMG installer...");

  if (!existsSync(appPath)) {
    throw new Error(`App bundle not found at ${appPath}`);
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const dmgPath = join(outputDir, `Container Cove-${version}.dmg`);

  // Remove existing DMG if it exists
  if (existsSync(dmgPath)) {
    rmSync(dmgPath);
    log(`Removed existing DMG at ${dmgPath}`);
  }

  const hdiutilResult = await executeCommand("hdiutil", [
    "create",
    "-volname",
    "Container Cove",
    "-srcfolder",
    appPath,
    "-ov",
    "-format",
    "UDZO",
    "-imagekey",
    "zlib-level=9",
    dmgPath,
  ], { timeout: 600000 });

  if (hdiutilResult.code !== 0) {
    throw new Error(
      `DMG creation failed: ${hdiutilResult.stderr || hdiutilResult.stdout}`
    );
  }

  if (!existsSync(dmgPath)) {
    throw new Error(`DMG file was not created at ${dmgPath}`);
  }

  log(`DMG created successfully at ${dmgPath}`);
  return dmgPath;
}

/**
 * Notarize DMG (optional, requires Apple credentials)
 */
async function notarizeDMG(dmgPath: string): Promise<void> {
  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_PASSWORD;
  const appleTeamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !applePassword || !appleTeamId) {
    log(
      "Notarization skipped: APPLE_ID, APPLE_PASSWORD, and/or APPLE_TEAM_ID not set"
    );
    return;
  }

  log("Notarizing DMG...");

  if (!existsSync(dmgPath)) {
    throw new Error(`DMG file not found at ${dmgPath}`);
  }

  // Use xcrun notarytool (newer approach, requires macOS 12+)
  const notarizeResult = await executeCommand("xcrun", [
    "notarytool",
    "submit",
    dmgPath,
    "--apple-id",
    appleId,
    "--password",
    applePassword,
    "--team-id",
    appleTeamId,
    "--wait",
  ], { timeout: 1800000 });

  if (notarizeResult.code !== 0) {
    // Try older altool approach if notarytool fails
    log("notarytool failed, attempting with altool...");
    const altoolResult = await executeCommand("xcrun", [
      "altool",
      "--notarize-app",
      "-f",
      dmgPath,
      "-t",
      "osx",
      "-u",
      appleId,
      "-p",
      applePassword,
    ], { timeout: 1800000 });

    if (altoolResult.code !== 0) {
      throw new Error(
        `Notarization failed: ${altoolResult.stderr || altoolResult.stdout}`
      );
    }
  }

  log("Notarization complete");
}

/**
 * Main orchestrator function
 */
export async function buildMacOSDMG(options: BuildOptions): Promise<void> {
  try {
    log("Starting macOS DMG build process...");

    // Step 1: Download Podman and bundle into .app
    const podmanBinary = await downloadPodman(options.outputDir);
    await bundlePodmanBinary(options.appPath, podmanBinary);

    // Step 2: Code sign (if identity provided)
    if (options.signIdentity) {
      await signApp(options.appPath, options.signIdentity);
    } else {
      log("Skipping code signing: APPLE_SIGNING_IDENTITY not provided");
    }

    // Step 4: Create DMG
    const dmgPath = await createDMG(
      options.appPath,
      options.outputDir,
      options.version
    );

    // Step 5: Notarize (if credentials provided and enabled)
    if (options.notarize !== false) {
      await notarizeDMG(dmgPath);
    }

    log("macOS DMG build completed successfully!");
    log(`DMG file: ${dmgPath}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`ERROR: ${errorMsg}`);
    process.exit(1);
  }
}

/**
 * CLI entry point
 */
if (import.meta.main) {
  (async () => {
    try {
      // Get app version from package.json
      const packageJsonPath = resolve(import.meta.dir, "..", "package.json");

      let appVersion: string;
      try {
        const content = fs.readFileSync(packageJsonPath, "utf-8");
        const packageJson = JSON.parse(content) as { version?: string };

        if (!packageJson.version) {
          throw new Error("package.json missing 'version' field");
        }
        appVersion = packageJson.version;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to read package.json: ${errorMsg}`);
        process.exit(1);
      }

      // Determine app path (from build output or default)
      // Electrobun builds to build/ directory
      const appName = "Container Cove";
      // Try production path first, then dev build path
      const appPath = (() => {
        const prodPath = resolve(import.meta.dir, "..", "build", `${appName}.app`);
        if (existsSync(prodPath)) return prodPath;
        const devPath = resolve(import.meta.dir, "..", "build", "dev-macos-arm64", `${appName}-dev.app`);
        if (existsSync(devPath)) return devPath;
        return prodPath; // will fail below with clear error
      })();
      const outputDir = resolve(import.meta.dir, "..", "build");

      // Validate required paths exist
      if (!existsSync(appPath)) {
        console.error(`Error: App bundle not found at ${appPath}`);
        process.exit(1);
      }

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Validate required tools are available
      // hdiutil uses 'info' not '--version'; curl/tar use '--version'
      const toolChecks: Record<string, string[]> = {
        curl: ["--version"],
        tar: ["--version"],
        hdiutil: ["info"],
      };
      for (const [tool, args] of Object.entries(toolChecks)) {
        const check = await executeCommand(tool, args);
        if (check.code !== 0 && check.code !== 1) {
          console.error(`Error: Required tool '${tool}' not found in PATH`);
          process.exit(1);
        }
      }

      // Get signing identity from env var
      const signIdentity = process.env.APPLE_SIGNING_IDENTITY;

      // Get notarization flag (default: true if credentials present)
      const shouldNotarize =
        process.env.APPLE_ID &&
        process.env.APPLE_PASSWORD &&
        process.env.APPLE_TEAM_ID;

      const options: BuildOptions = {
        appPath,
        outputDir,
        version: appVersion,
        signIdentity,
        notarize: shouldNotarize ? true : false,
      };

      log("macOS DMG Build Script");
      log(`App version: ${appVersion}`);
      log(`App path: ${appPath}`);
      log(`Output directory: ${outputDir}`);
      log(`Code signing: ${signIdentity ? "enabled" : "disabled"}`);
      log(`Notarization: ${shouldNotarize ? "enabled" : "disabled"}`);
      log("");

      await buildMacOSDMG(options).catch((err) => {
        console.error("Build failed:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      });

      console.log("✓ macOS DMG build completed successfully");
      process.exit(0);
    } catch (err) {
      console.error("Unexpected error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  })();
}

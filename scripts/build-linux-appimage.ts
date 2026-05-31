import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  rmSync,
  readdirSync,
  statSync,
  symlinkSync,
} from "fs";
import { resolve, join } from "path";
import * as fs from "fs";

const log = (msg: string) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${msg}`);
};

interface BuildOptions {
  appPath: string; // Path to built Linux app directory
  outputDir: string; // Output directory for .AppImage
  version: string; // App version from package.json
  gpgKeyId?: string; // GPG key ID for signing (optional)
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
 * Download Podman binary from GitHub releases for Linux
 */
async function downloadPodmanLinux(outputDir: string): Promise<string> {
  log("Downloading Podman v4.9.2 for Linux...");

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const downloadUrl =
    "https://github.com/containers/podman/releases/download/v4.9.2/podman-4.9.2-linux-amd64.tar.gz";
  const tarPath = join(outputDir, "podman-4.9.2-linux-amd64.tar.gz");
  const extractDir = join(outputDir, "podman-extract");

  // Clean up previous extraction if exists
  if (existsSync(extractDir)) {
    rmSync(extractDir, { recursive: true });
  }
  mkdirSync(extractDir, { recursive: true });

  // Download using curl with timeout (60 seconds)
  const downloadResult = await executeCommand("curl", [
    "-L",
    "--max-time",
    "60",
    "--progress-bar",
    "-o",
    tarPath,
    downloadUrl,
  ]);

  if (downloadResult.code !== 0) {
    throw new Error(
      `Failed to download Podman: ${downloadResult.stderr || downloadResult.stdout}`
    );
  }

  if (!existsSync(tarPath)) {
    throw new Error(`Downloaded file not found at ${tarPath}`);
  }

  log(`Downloaded Podman to ${tarPath}`);

  // Extract tar.gz
  log("Extracting Podman archive...");
  const extractResult = await executeCommand("tar", [
    "-xzf",
    tarPath,
    "-C",
    extractDir,
  ]);

  if (extractResult.code !== 0) {
    throw new Error(
      `Failed to extract Podman: ${extractResult.stderr || extractResult.stdout}`
    );
  }

  // Find the podman binary
  const possiblePaths = [
    join(extractDir, "podman-4.9.2-linux-amd64", "podman"),
    join(extractDir, "podman"),
  ];

  let binaryPath: string | null = null;
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      binaryPath = path;
      break;
    }
  }

  if (!binaryPath) {
    // List contents to help debug
    const listResult = await executeCommand("find", [extractDir, "-name", "podman"]);
    throw new Error(
      `Podman binary not found in extracted archive.\n${listResult.stdout}`
    );
  }

  log(`Found Podman binary at ${binaryPath}`);
  return binaryPath;
}

/**
 * Recursively copy directory structure
 */
function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);

    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Prepare AppImage directory structure
 */
async function prepareAppDir(
  appPath: string,
  appDirPath: string,
  templateDir: string,
  version: string
): Promise<void> {
  log("Preparing AppImage directory structure...");

  if (!existsSync(appPath)) {
    throw new Error(`App path not found at ${appPath}`);
  }

  // Clean up previous AppDir if exists
  if (existsSync(appDirPath)) {
    rmSync(appDirPath, { recursive: true });
  }

  mkdirSync(appDirPath, { recursive: true });
  log(`Created AppDir at ${appDirPath}`);

  // Create directory structure
  const usrDir = join(appDirPath, "usr");
  const binDir = join(usrDir, "bin");
  const libDir = join(usrDir, "lib");
  const shareDir = join(usrDir, "share");
  const iconsDir = join(shareDir, "icons");

  for (const dir of [binDir, libDir, iconsDir]) {
    mkdirSync(dir, { recursive: true });
  }

  log("Created directory structure");

  // Copy AppRun script
  const appRunSrc = join(templateDir, "AppRun");
  const appRunDest = join(appDirPath, "AppRun");
  if (existsSync(appRunSrc)) {
    copyFileSync(appRunSrc, appRunDest);
    chmodSync(appRunDest, 0o755);
    log("Copied AppRun script");
  } else {
    log("WARNING: AppRun template not found, creating minimal one");
    fs.writeFileSync(
      appRunDest,
      `#!/bin/bash\nAPPDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nexport LD_LIBRARY_PATH="${APPDIR}/usr/lib:${LD_LIBRARY_PATH}"\nexec "${APPDIR}/usr/bin/container-cove" "$@"\n`
    );
    chmodSync(appRunDest, 0o755);
  }

  // Copy .desktop file
  const desktopSrc = join(templateDir, "container-cove.desktop");
  const desktopDest = join(appDirPath, "container-cove.desktop");
  if (existsSync(desktopSrc)) {
    copyFileSync(desktopSrc, desktopDest);
    log("Copied .desktop file");
  } else {
    log("WARNING: .desktop template not found, creating minimal one");
    fs.writeFileSync(
      desktopDest,
      `[Desktop Entry]
Type=Application
Name=Container Cove
Comment=Run containers as desktop apps — no terminal needed.
Exec=container-cove %F
Icon=AppIcon
Categories=Utility;
Terminal=false
`
    );
  }

  // Copy app files from build directory to usr/lib
  log("Copying application files...");
  const appLibDir = join(libDir, "electron");
  copyDirRecursive(appPath, appLibDir);
  log(`Copied app files to ${appLibDir}`);

  // Create symlink from bin to the electron executable
  const electronBinary = join(appLibDir, "container-cove");
  const binSymlink = join(binDir, "container-cove");

  if (existsSync(electronBinary)) {
    // Remove existing symlink if present
    if (existsSync(binSymlink)) {
      rmSync(binSymlink);
    }
    symlinkSync(electronBinary, binSymlink);
    log(`Created symlink from ${binSymlink} to ${electronBinary}`);
  } else {
    log(
      `WARNING: Electron executable not found at ${electronBinary}, skipping symlink`
    );
  }
}

/**
 * Bundle Podman binary into AppImage directory
 */
async function bundlePodmanBinary(
  appDirPath: string,
  podmanBinary: string
): Promise<void> {
  log("Bundling Podman binary into AppDir...");

  if (!existsSync(appDirPath)) {
    throw new Error(`AppDir not found at ${appDirPath}`);
  }

  if (!existsSync(podmanBinary)) {
    throw new Error(`Podman binary not found at ${podmanBinary}`);
  }

  const libDir = join(appDirPath, "usr", "lib");
  mkdirSync(libDir, { recursive: true });

  const targetPath = join(libDir, "podman");

  // Copy binary
  copyFileSync(podmanBinary, targetPath);
  log(`Copied Podman to ${targetPath}`);

  // Make executable
  chmodSync(targetPath, 0o755);
  log("Set executable permissions on podman binary");

  // Verify
  const verifyResult = await executeCommand("file", [targetPath]);
  if (verifyResult.code === 0) {
    log(`Verification: ${verifyResult.stdout.trim()}`);
  }
}

/**
 * Create AppImage using appimagetool
 */
async function createAppImage(
  appDirPath: string,
  outputDir: string,
  version: string
): Promise<string> {
  log("Creating AppImage...");

  if (!existsSync(appDirPath)) {
    throw new Error(`AppDir not found at ${appDirPath}`);
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const appImagePath = join(outputDir, `Container Cove-${version}-x86_64.AppImage`);

  // Remove existing AppImage if it exists
  if (existsSync(appImagePath)) {
    rmSync(appImagePath);
    log(`Removed existing AppImage at ${appImagePath}`);
  }

  // Check if appimagetool is available
  const checkAppimagetool = await executeCommand("which", ["appimagetool"]);
  if (checkAppimagetool.code !== 0) {
    throw new Error(
      "appimagetool not found. Install with: sudo apt-get install appimagetool (on Debian/Ubuntu)"
    );
  }

  log("Found appimagetool, creating AppImage...");

  // Run appimagetool
  const appimagetoolResult = await executeCommand("appimagetool", [
    appDirPath,
    appImagePath,
  ], { timeout: 300000 });

  if (appimagetoolResult.code !== 0) {
    throw new Error(
      `AppImage creation failed: ${appimagetoolResult.stderr || appimagetoolResult.stdout}`
    );
  }

  if (!existsSync(appImagePath)) {
    throw new Error(`AppImage was not created at ${appImagePath}`);
  }

  // Make AppImage executable
  chmodSync(appImagePath, 0o755);
  log(`AppImage created and made executable: ${appImagePath}`);

  return appImagePath;
}

/**
 * Sign AppImage with GPG (optional)
 */
async function signAppImage(
  appImagePath: string,
  gpgKeyId: string
): Promise<void> {
  log(`Signing AppImage with GPG key: ${gpgKeyId}`);

  if (!existsSync(appImagePath)) {
    throw new Error(`AppImage not found at ${appImagePath}`);
  }

  const signResult = await executeCommand("gpg", [
    "--detach-sign",
    "--armor",
    "-u",
    gpgKeyId,
    appImagePath,
  ]);

  if (signResult.code !== 0) {
    throw new Error(
      `GPG signing failed: ${signResult.stderr || signResult.stdout}`
    );
  }

  const signatureFile = `${appImagePath}.asc`;
  if (existsSync(signatureFile)) {
    log(`GPG signature created: ${signatureFile}`);
  }
}

/**
 * Main orchestrator function
 */
export async function buildLinuxAppImage(options: BuildOptions): Promise<void> {
  try {
    log("Starting Linux AppImage build process...");

    // Step 1: Download Podman
    const podmanBinary = await downloadPodmanLinux(options.outputDir);

    // Step 2: Prepare AppImage directory structure
    const templateDir = resolve(import.meta.dir, "appimage-template");
    const appDirPath = join(options.outputDir, "container-cove.AppDir");

    await prepareAppDir(
      options.appPath,
      appDirPath,
      templateDir,
      options.version
    );

    // Step 3: Bundle Podman into AppDir
    await bundlePodmanBinary(appDirPath, podmanBinary);

    // Step 4: Create AppImage
    const appImagePath = await createAppImage(
      appDirPath,
      options.outputDir,
      options.version
    );

    // Step 5: Sign AppImage (if GPG key provided)
    if (options.gpgKeyId) {
      await signAppImage(appImagePath, options.gpgKeyId);
    } else {
      log("Skipping GPG signing: GPG_KEY_ID not provided");
    }

    log("Linux AppImage build completed successfully!");
    log(`AppImage file: ${appImagePath}`);
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
      // Electrobun builds to build/linux directory for Linux apps
      const appPath = resolve(
        import.meta.dir,
        "..",
        "build",
        "linux"
      );
      const outputDir = resolve(import.meta.dir, "..", "build");

      // Validate required paths exist
      if (!existsSync(appPath)) {
        console.error(`Error: App directory not found at ${appPath}`);
        console.error("Make sure to run 'bun run build:linux' first");
        process.exit(1);
      }

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Validate required tools are available
      const requiredTools = ["curl", "tar", "file"];
      for (const tool of requiredTools) {
        const check = await executeCommand(tool, ["--version"]);
        if (check.code !== 0) {
          console.error(`Error: Required tool '${tool}' not found in PATH`);
          process.exit(1);
        }
      }

      // Get GPG key ID from env var (optional)
      const gpgKeyId = process.env.GPG_KEY_ID;

      const options: BuildOptions = {
        appPath,
        outputDir,
        version: appVersion,
        gpgKeyId,
      };

      log("Linux AppImage Build Script");
      log(`App version: ${appVersion}`);
      log(`App path: ${appPath}`);
      log(`Output directory: ${outputDir}`);
      log(`GPG signing: ${gpgKeyId ? "enabled" : "disabled"}`);
      log("");

      await buildLinuxAppImage(options).catch((err) => {
        console.error("Build failed:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      });

      console.log("✓ Linux AppImage build completed successfully");
      process.exit(0);
    } catch (err) {
      console.error("Unexpected error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  })();
}

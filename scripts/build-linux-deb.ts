import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  rmSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { resolve, join } from "path";
import * as fs from "fs";

const log = (msg: string) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${msg}`);
};

interface BuildOptions {
  appPath: string; // Path to built Linux app directory
  outputDir: string; // Output directory for .deb
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
 * Create Debian control file
 */
function createDebianControl(version: string): string {
  return `Package: container-cove
Version: ${version}
Architecture: amd64
Maintainer: Steven Azevedo <me@stevenazevedo.com>
Homepage: https://github.com/stevenazevedo/container-cove
Description: Run containers as desktop apps — no terminal needed.
Installed-Size: 250000
Depends: libgtk-3-0, libayatana-appindicator3-1
`;
}

/**
 * Create postinstall script
 */
function createPostinstScript(): string {
  return `#!/bin/bash
set -e

# Create symlink for easy command-line access
ln -sf /opt/container-cove/container-cove /usr/bin/container-cove

# Update desktop database if available
if command -v update-desktop-database &> /dev/null; then
  update-desktop-database /usr/share/applications
fi
`;
}

/**
 * Create postrm script
 */
function createPostrmScript(): string {
  return `#!/bin/bash

# Remove symlink
rm -f /usr/bin/container-cove

# Update desktop database if available
if command -v update-desktop-database &> /dev/null; then
  update-desktop-database /usr/share/applications
fi
`;
}

/**
 * Prepare Debian package directory structure
 */
async function prepareDebianPackage(
  appPath: string,
  debPkgPath: string,
  version: string
): Promise<void> {
  log("Preparing Debian package structure...");

  if (!existsSync(appPath)) {
    throw new Error(`App path not found at ${appPath}`);
  }

  // Clean up previous package if exists
  if (existsSync(debPkgPath)) {
    rmSync(debPkgPath, { recursive: true });
  }

  mkdirSync(debPkgPath, { recursive: true });
  log(`Created package directory at ${debPkgPath}`);

  // Create directory structure
  const debianDir = join(debPkgPath, "DEBIAN");
  const optDir = join(debPkgPath, "opt", "container-cove");

  mkdirSync(debianDir, { recursive: true });
  mkdirSync(optDir, { recursive: true });

  log("Created directory structure");

  // Create DEBIAN/control
  const controlContent = createDebianControl(version);
  writeFileSync(join(debianDir, "control"), controlContent);
  log("Created DEBIAN/control");

  // Create DEBIAN/postinst
  const postinstContent = createPostinstScript();
  const postinstPath = join(debianDir, "postinst");
  writeFileSync(postinstPath, postinstContent);
  chmodSync(postinstPath, 0o755);
  log("Created DEBIAN/postinst");

  // Create DEBIAN/postrm
  const postrmContent = createPostrmScript();
  const postrmPath = join(debianDir, "postrm");
  writeFileSync(postrmPath, postrmContent);
  chmodSync(postrmPath, 0o755);
  log("Created DEBIAN/postrm");

  // Copy app files to opt/container-cove
  log("Copying application files to opt/container-cove...");
  copyDirRecursive(appPath, optDir);
  log("Application files copied");

  // Ensure main binary is executable
  const mainBinary = join(optDir, "container-cove");
  if (existsSync(mainBinary)) {
    chmodSync(mainBinary, 0o755);
    log("Ensured main binary is executable");
  }
}

/**
 * Bundle Podman binary into Debian package
 */
async function bundlePodmanBinaryDeb(
  debPkgPath: string,
  podmanBinary: string
): Promise<void> {
  log("Bundling Podman binary into Debian package...");

  if (!existsSync(debPkgPath)) {
    throw new Error(`Debian package directory not found at ${debPkgPath}`);
  }

  if (!existsSync(podmanBinary)) {
    throw new Error(`Podman binary not found at ${podmanBinary}`);
  }

  const optDir = join(debPkgPath, "opt", "container-cove");
  const targetPath = join(optDir, "podman");

  // Copy binary
  copyFileSync(podmanBinary, targetPath);
  log(`Copied Podman to ${targetPath}`);

  // Make executable
  chmodSync(targetPath, 0o755);
  log("Set executable permissions on podman binary");
}

/**
 * Create .deb package using dpkg-deb
 */
async function createDebianPackage(
  debPkgPath: string,
  outputDir: string,
  version: string
): Promise<string> {
  log("Creating Debian package...");

  if (!existsSync(debPkgPath)) {
    throw new Error(`Debian package directory not found at ${debPkgPath}`);
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const debPath = join(outputDir, `container-cove_${version}_amd64.deb`);

  // Remove existing .deb if it exists
  if (existsSync(debPath)) {
    rmSync(debPath);
    log(`Removed existing .deb at ${debPath}`);
  }

  // Check if dpkg-deb is available
  const checkDpkgDeb = await executeCommand("which", ["dpkg-deb"]);
  if (checkDpkgDeb.code !== 0) {
    throw new Error(
      "dpkg-deb not found. Install with: sudo apt-get install dpkg (on Debian/Ubuntu)"
    );
  }

  log("Found dpkg-deb, creating .deb package...");

  // Run dpkg-deb
  const dpkgDebResult = await executeCommand("dpkg-deb", [
    "--build",
    "--root-owner-group",
    debPkgPath,
    debPath,
  ]);

  if (dpkgDebResult.code !== 0) {
    throw new Error(
      `.deb creation failed: ${dpkgDebResult.stderr || dpkgDebResult.stdout}`
    );
  }

  if (!existsSync(debPath)) {
    throw new Error(`.deb was not created at ${debPath}`);
  }

  log(`.deb package created: ${debPath}`);
  return debPath;
}

/**
 * Sign .deb with GPG (optional)
 */
async function signDebPackage(
  debPath: string,
  gpgKeyId: string
): Promise<void> {
  log(`Signing .deb with GPG key: ${gpgKeyId}`);

  if (!existsSync(debPath)) {
    throw new Error(`.deb not found at ${debPath}`);
  }

  // Check if dpkg-sig is available
  const checkDpkgSig = await executeCommand("which", ["dpkg-sig"]);
  if (checkDpkgSig.code !== 0) {
    log("WARNING: dpkg-sig not found, skipping .deb signing");
    return;
  }

  const signResult = await executeCommand("dpkg-sig", [
    "-k",
    gpgKeyId,
    "-s",
    "builder",
    debPath,
  ]);

  if (signResult.code !== 0) {
    throw new Error(
      `GPG signing failed: ${signResult.stderr || signResult.stdout}`
    );
  }

  log("GPG signature created for .deb");
}

/**
 * Main orchestrator function
 */
export async function buildLinuxDeb(options: BuildOptions): Promise<void> {
  try {
    log("Starting Linux .deb build process...");

    // Step 1: Download Podman
    const podmanBinary = await downloadPodmanLinux(options.outputDir);

    // Step 2: Prepare Debian package structure
    const debPkgPath = join(options.outputDir, "container-cove-deb");

    await prepareDebianPackage(
      options.appPath,
      debPkgPath,
      options.version
    );

    // Step 3: Bundle Podman into Debian package
    await bundlePodmanBinaryDeb(debPkgPath, podmanBinary);

    // Step 4: Create .deb package
    const debPath = await createDebianPackage(
      debPkgPath,
      options.outputDir,
      options.version
    );

    // Step 5: Sign .deb (if GPG key provided)
    if (options.gpgKeyId) {
      await signDebPackage(debPath, options.gpgKeyId);
    } else {
      log("Skipping GPG signing: GPG_KEY_ID not provided");
    }

    log("Linux .deb build completed successfully!");
    log(`Debian package file: ${debPath}`);
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

      log("Linux .deb Build Script");
      log(`App version: ${appVersion}`);
      log(`App path: ${appPath}`);
      log(`Output directory: ${outputDir}`);
      log(`GPG signing: ${gpgKeyId ? "enabled" : "disabled"}`);
      log("");

      await buildLinuxDeb(options).catch((err) => {
        console.error("Build failed:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      });

      console.log("✓ Linux .deb build completed successfully");
      process.exit(0);
    } catch (err) {
      console.error("Unexpected error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  })();
}

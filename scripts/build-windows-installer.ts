import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from "fs";
import { resolve, join } from "path";
import * as fs from "fs";

const log = (msg: string) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${msg}`);
};

interface BuildOptions {
  appPath: string; // Path to built app executable
  outputDir: string; // Output directory for .exe installer
  version: string; // App version from package.json
  signCert?: string; // Code signing certificate path (optional)
  signPassword?: string; // Certificate password (optional)
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
      shell: true, // Required for Windows commands like makensis
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
 * Download Podman binary for Windows from GitHub releases
 */
async function downloadPodmanWindows(outputDir: string): Promise<string> {
  log("Downloading Podman v4.9.2 for Windows...");

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const downloadUrl =
    "https://github.com/containers/podman/releases/download/v4.9.2/podman-4.9.2-windows-amd64.zip";
  const zipPath = join(outputDir, "podman-4.9.2-windows-amd64.zip");
  const extractDir = join(outputDir, "podman-extract");

  // Clean up previous extraction if exists
  if (existsSync(extractDir)) {
    rmSync(extractDir, { recursive: true });
  }
  mkdirSync(extractDir, { recursive: true });

  // Download using curl with timeout (120 seconds for larger Windows binary)
  const downloadResult = await executeCommand("curl", [
    "-L",
    "--max-time",
    "120",
    "--progress-bar",
    "-o",
    zipPath,
    downloadUrl,
  ]);

  if (downloadResult.code !== 0) {
    throw new Error(
      `Failed to download Podman: ${downloadResult.stderr || downloadResult.stdout}`
    );
  }

  if (!existsSync(zipPath)) {
    throw new Error(`Downloaded file not found at ${zipPath}`);
  }

  log(`Downloaded Podman to ${zipPath}`);

  // Extract zip file
  log("Extracting Podman archive...");

  // Use PowerShell to extract zip on Windows, fallback to unzip on Unix-like systems
  let extractResult;
  if (process.platform === "win32") {
    extractResult = await executeCommand("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`,
    ], { timeout: 300000 });
  } else {
    // For macOS/Linux CI environments, use unzip if available
    extractResult = await executeCommand("unzip", [
      "-q",
      "-o",
      zipPath,
      "-d",
      extractDir,
    ]);
  }

  if (extractResult.code !== 0) {
    throw new Error(
      `Failed to extract Podman: ${extractResult.stderr || extractResult.stdout}`
    );
  }

  // Find the podman.exe binary
  const possiblePaths = [
    join(extractDir, "podman-4.9.2-windows-amd64", "podman.exe"),
    join(extractDir, "podman.exe"),
    join(extractDir, "podman", "podman.exe"),
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
    const listResult = await executeCommand("find", [extractDir, "-name", "podman.exe"]);
    throw new Error(
      `Podman binary (podman.exe) not found in extracted archive.\n${listResult.stdout}`
    );
  }

  log(`Found Podman binary at ${binaryPath}`);
  return binaryPath;
}

/**
 * Copy Podman binary to build directory for installer
 */
async function preparePodmanBinary(
  podmanBinary: string,
  buildPodmanDir: string
): Promise<void> {
  log("Preparing Podman binary for installer...");

  if (!existsSync(podmanBinary)) {
    throw new Error(`Podman binary not found at ${podmanBinary}`);
  }

  if (!existsSync(buildPodmanDir)) {
    mkdirSync(buildPodmanDir, { recursive: true });
  }

  const targetPath = join(buildPodmanDir, "podman.exe");
  copyFileSync(podmanBinary, targetPath);
  log(`Copied Podman to ${targetPath}`);

  // Verify file exists and is executable
  if (!existsSync(targetPath)) {
    throw new Error(`Failed to copy Podman binary to ${targetPath}`);
  }
}

/**
 * Validate NSIS compiler is available
 */
async function validateNSISCompiler(): Promise<string> {
  log("Checking for NSIS compiler (makensis)...");

  // Try to find makensis in common locations or PATH
  let makensisBin = "makensis";

  // Try common NSIS installation paths on Windows
  if (process.platform === "win32") {
    const commonPaths = [
      "C:\\Program Files (x86)\\NSIS\\makensis.exe",
      "C:\\Program Files\\NSIS\\makensis.exe",
    ];

    for (const path of commonPaths) {
      if (existsSync(path)) {
        makensisBin = path;
        log(`Found NSIS at ${path}`);
        return makensisBin;
      }
    }
  }

  // Try to check if makensis is in PATH
  const checkResult = await executeCommand(makensisBin, ["-VERSION"]);
  if (checkResult.code !== 0) {
    throw new Error(
      `NSIS compiler (makensis) not found. Please install NSIS 3.x or later from https://nsis.sourceforge.io`
    );
  }

  log(`NSIS compiler found: ${makensisBin}`);
  return makensisBin;
}

/**
 * Compile NSIS installer script
 */
async function compileNSIS(
  nsisScript: string,
  makensisBin: string
): Promise<void> {
  log("Compiling NSIS installer script...");

  if (!existsSync(nsisScript)) {
    throw new Error(`NSIS script not found at ${nsisScript}`);
  }

  const compileResult = await executeCommand(makensisBin, [
    "/V2", // Verbose output
    `"${nsisScript}"`,
  ], { timeout: 300000 });

  if (compileResult.code !== 0) {
    throw new Error(
      `NSIS compilation failed: ${compileResult.stderr || compileResult.stdout}`
    );
  }

  log("NSIS compilation successful");
  log(compileResult.stdout);
}

/**
 * Sign executable with Authenticode certificate (optional)
 */
async function signExecutable(
  exePath: string,
  certPath: string,
  certPassword: string
): Promise<void> {
  log(`Code signing executable: ${exePath}`);

  if (!existsSync(exePath)) {
    throw new Error(`Executable not found at ${exePath}`);
  }

  if (!existsSync(certPath)) {
    throw new Error(`Certificate not found at ${certPath}`);
  }

  // Find signtool.exe (comes with Windows SDK)
  // Common paths on Windows
  const signToolPaths = [
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe",
    "C:\\Program Files\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe",
    "signtool.exe", // Assume it's in PATH
  ];

  let signToolBin: string | null = null;
  for (const path of signToolPaths) {
    if (process.platform === "win32" && existsSync(path)) {
      signToolBin = path;
      break;
    }
  }

  if (!signToolBin) {
    signToolBin = "signtool.exe";
  }

  // Check if signtool exists
  const checkResult = await executeCommand(signToolBin, ["/?"], { timeout: 30000 });
  if (checkResult.code !== 0) {
    log("Warning: signtool not found, skipping code signing");
    log("To enable signing, install Windows SDK or set SIGNTOOL_PATH environment variable");
    return;
  }

  const signResult = await executeCommand(signToolBin, [
    "sign",
    "/f", `"${certPath}"`,
    "/p", certPassword,
    "/t", "http://timestamp.digicert.com",
    "/d", "Container Cove",
    `"${exePath}"`,
  ], { timeout: 300000 });

  if (signResult.code !== 0) {
    throw new Error(
      `Code signing failed: ${signResult.stderr || signResult.stdout}`
    );
  }

  log("Code signing successful");
}

/**
 * Main orchestrator function
 */
export async function buildWindowsInstaller(
  options: BuildOptions
): Promise<void> {
  try {
    log("Starting Windows installer build process...");

    // Step 1: Validate NSIS compiler
    const makensisBin = await validateNSISCompiler();

    // Step 2: Download and prepare Podman binary
    const podmanDir = join(options.outputDir, "podman");
    const podmanBinary = await downloadPodmanWindows(podmanDir);
    await preparePodmanBinary(podmanBinary, join(options.outputDir, "podman"));

    // Step 3: Validate required assets
    const requiredAssets = [
      "assets/icons/App_Icon.ico",
      "assets/icons/installer-header.bmp",
      "assets/icons/installer-welcome.bmp"
    ];

    for (const asset of requiredAssets) {
      const assetPath = resolve(import.meta.dir, "..", asset);
      if (!existsSync(assetPath)) {
        throw new Error(`Missing required asset: ${assetPath}`);
      }
    }

    log(`All required assets validated ✓`);

    // Step 4: Compile NSIS installer
    const nsisScript = resolve(
      import.meta.dir,
      "windows-installer.nsi"
    );
    await compileNSIS(nsisScript, makensisBin);

    // Step 5: Code sign (if certificate provided)
    const exePath = join(
      options.outputDir,
      `Container Cove Setup ${options.version}.exe`
    );

    if (!existsSync(exePath)) {
      throw new Error(
        `Installer executable not found at ${exePath}. NSIS compilation may have failed.`
      );
    }

    if (options.signCert && options.signPassword) {
      await signExecutable(exePath, options.signCert, options.signPassword);
    } else {
      log("Skipping code signing: certificate not provided");
    }

    log("Windows installer build completed successfully!");
    log(`Installer file: ${exePath}`);
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
      const appPath = resolve(
        import.meta.dir,
        "..",
        "build",
        `${appName}.exe`
      );
      const outputDir = resolve(import.meta.dir, "..", "build");

      // Note: On macOS/Linux, the Windows build won't exist yet, but the script should still work
      // The NSIS compiler will handle the final .exe creation

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Get signing credentials from environment variables
      const signCert = process.env.WINDOWS_SIGN_CERT;
      const signPassword = process.env.WINDOWS_SIGN_PASSWORD;

      const options: BuildOptions = {
        appPath,
        outputDir,
        version: appVersion,
        signCert,
        signPassword,
      };

      log("Windows Installer Build Script");
      log(`App version: ${appVersion}`);
      log(`App executable: ${appPath}`);
      log(`Output directory: ${outputDir}`);
      log(`Code signing: ${signCert ? "enabled" : "disabled"}`);
      log(`Platform: ${process.platform}`);
      log("");

      await buildWindowsInstaller(options).catch((err) => {
        console.error("Build failed:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      });

      console.log("✓ Windows installer build completed successfully");
      process.exit(0);
    } catch (err) {
      console.error("Unexpected error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  })();
}

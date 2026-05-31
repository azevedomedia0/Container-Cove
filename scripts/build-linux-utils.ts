import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";

export interface ChildProcessOptions {
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * Log a timestamped message
 */
export const log = (msg: string) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${msg}`);
};

/**
 * Execute a shell command and return result
 */
export async function executeCommand(
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
export async function downloadPodmanLinux(outputDir: string): Promise<string> {
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
    const { rmSync } = await import("fs");
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
export function copyDirRecursive(src: string, dest: string): void {
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

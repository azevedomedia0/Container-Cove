import { homedir } from "os";
import { join } from "path";
import type { SetupState } from "./setup-state";

export type OrbStackSetupResult =
  | { success: true; runtime: "orbstack" | "docker" }
  | { success: false; error: string; recoveryOptions: RecoveryOption[] };

export type RecoveryOption = {
  label: string;
  action: "install-orbstack" | "install-docker" | "open-docs" | "fallback-docker" | "retry" | "cancel";
  url?: string;
  description?: string;
  installScript?: string;
};

/**
 * Check if a binary exists and is executable.
 */
async function binaryExists(binaryPath: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([binaryPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Safely invoke progress callback with error handling.
 */
function safeProgressUpdate(
  callback: (percentComplete: number, step: string) => void,
  percent: number,
  step: string,
  state?: any,
): void {
  try {
    callback(percent, step);
    if (state?.setStage) {
      state.setStage("initializing", step, percent);
    }
  } catch (err) {
    console.warn("Progress callback error (ignored):", err);
  }
}

/**
 * Check for OrbStack or Docker on macOS.
 * OrbStack is the preferred runtime; Docker Desktop is a fallback.
 */
export async function checkOrbStackMacOS(
  progressCallback: (percentComplete: number, step: string) => void,
  state?: any,
): Promise<OrbStackSetupResult> {
  safeProgressUpdate(progressCallback, 0, "Checking for container runtime (OrbStack or Docker)", state);

  // Check for Docker (includes both OrbStack's docker and Docker Desktop)
  const dockerCandidates = [
    "/opt/orbstack/bin/docker",    // OrbStack (preferred)
    "/usr/local/bin/docker",       // Docker Desktop or Homebrew Docker
    "/opt/homebrew/bin/docker",    // Apple Silicon Homebrew
    "docker",                       // System PATH
  ];

  let dockerPath: string | null = null;
  let runtime: "orbstack" | "docker" = "docker";

  for (const candidate of dockerCandidates) {
    if (await binaryExists(candidate)) {
      dockerPath = candidate;
      runtime = candidate.includes("orbstack") ? "orbstack" : "docker";
      break;
    }
  }

  if (dockerPath) {
    safeProgressUpdate(progressCallback, 100, `${runtime === "orbstack" ? "OrbStack" : "Docker"} found`, state);
    return { success: true, runtime };
  }

  // No Docker found — provide installation guidance
  safeProgressUpdate(progressCallback, 50, "Container runtime not found", state);

  const orbstackInstallScript = `#!/bin/bash
# Auto-install OrbStack via Homebrew
set -euo pipefail

info() { echo "[OrbStack Install] $1"; }
warn() { echo "[OrbStack Install] ⚠ $1"; }

if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found. Installing Homebrew first..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

info "Installing OrbStack..."
brew install orbstack

if command -v docker >/dev/null 2>&1; then
  info "✓ OrbStack installed successfully!"
else
  warn "OrbStack installation completed, but docker command not found."
  warn "Please restart your terminal or computer."
  exit 1
fi
`;

  const dockerInstallScript = `#!/bin/bash
# Auto-install Docker Desktop via Homebrew Cask
set -euo pipefail

info() { echo "[Docker Install] $1"; }
warn() { echo "[Docker Install] ⚠ $1"; }

if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found. Installing Homebrew first..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

info "Installing Docker Desktop..."
brew install --cask docker

# Docker Desktop requires a manual launch to complete setup
open -a Docker 2>/dev/null || true

info "Waiting for Docker to start..."
for i in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then
    info "✓ Docker Desktop is running!"
    exit 0
  fi
  sleep 2
done

warn "Docker Desktop installed but not yet running."
warn "Please open Docker Desktop from your Applications folder, then click Retry."
exit 1
`;

  const recoveryOptions: RecoveryOption[] = [
    {
      label: "Install OrbStack (Recommended)",
      action: "install-orbstack",
      description: "Lightweight and fast — installs automatically via Homebrew",
      installScript: orbstackInstallScript,
    },
    {
      label: "Install Docker Desktop (Fallback)",
      action: "install-docker",
      description: "Heavier alternative — installs via Homebrew Cask",
      installScript: dockerInstallScript,
    },
    {
      label: "Install Manually",
      action: "open-docs",
      url: "https://orbstack.dev/download",
      description: "Open orbstack.dev to download and install yourself",
    },
    {
      label: "Retry",
      action: "retry",
      description: "Retry detection after installing a runtime",
    },
  ];

  if (state?.setError) {
    state.setError(
      "ORBSTACK_NOT_FOUND",
      "OrbStack or Docker not found. Container Cove requires one of these to run containers on macOS.",
      recoveryOptions,
    );
  }

  return {
    success: false,
    error: "OrbStack or Docker not found. Please install OrbStack (brew install orbstack) or Docker Desktop.",
    recoveryOptions,
  };
}

/**
 * Main entry point for macOS container runtime setup.
 * Checks for OrbStack/Docker and guides user through installation if needed.
 */
export async function setupContainerRuntimeMacOS(
  progressCallback: (percentComplete: number, step: string) => void,
  state?: any,
): Promise<OrbStackSetupResult> {
  // Platform check (safety — should only be called on macOS)
  if (process.platform !== "darwin") {
    return {
      success: false,
      error: "This function is only for macOS",
      recoveryOptions: [],
    };
  }

  return checkOrbStackMacOS(progressCallback, state);
}

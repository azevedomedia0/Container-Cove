import { homedir } from "os";
import { join } from "path";
import type { SetupState } from "./setup-state";
import { podmanEnv } from "./container-env";

export type RecoveryOption = {
  label: string;
  action: "retry" | "fallback-docker" | "open-docs" | "open-uninstall-guide" | "cancel";
  url?: string;
  description?: string;
  command?: string;
};

export type PodmanSetupResult =
  | { success: true; runtime: "podman" | "docker" }
  | { success: false; error: string; recoveryOptions: RecoveryOption[] };

/**
 * Execute a shell command and return stdout as a string.
 * @param command The command to execute (e.g., "podman version --format {{.Client.Version}}")
 * @returns The stdout output or null if the command fails.
 */
async function executeCommand(command: string): Promise<string | null> {
  try {
    const parts = command.split(/\s+/);
    const proc = Bun.spawn(parts, { stdout: "pipe", stderr: "null", env: podmanEnv() });
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      const output = await new Response(proc.stdout).text();
      return output.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse JSON output from a command.
 * @param command The command to execute
 * @returns Parsed JSON or null if parsing fails
 */
async function executeJsonCommand<T>(command: string): Promise<T | null> {
  try {
    const parts = command.split(/\s+/);
    const proc = Bun.spawn(parts, { stdout: "pipe", stderr: "null", env: podmanEnv() });
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      const output = await new Response(proc.stdout).text();
      const parsed = JSON.parse(output);
      // Validate that parsed JSON is an array for machine list operations
      if (command.includes("machine list") && !Array.isArray(parsed)) {
        throw new Error("Expected array from podman machine list");
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a binary exists and is executable.
 * @param binaryPath The path or name of the binary to check
 * @returns true if the binary exists and runs successfully
 */
async function binaryExists(binaryPath: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([binaryPath, "--version"], { stdout: "pipe", stderr: "null", env: podmanEnv() });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Safely invoke progress callback with error handling.
 * @param callback The progress callback to invoke
 * @param percent Percentage complete (0-100)
 * @param step Current step description
 * @param state Optional SetupState to update
 */
function safeProgressUpdate(
  callback: (percentComplete: number, step: string) => void,
  percent: number,
  step: string,
  state?: any,
): void {
  try {
    callback(percent, step);
    // Also update SetupState if provided
    if (state?.setStage) {
      state.setStage("initializing", step, percent);
    }
  } catch (err) {
    console.warn("Progress callback error (ignored):", err);
  }
}

/**
 * Setup Podman on macOS with Podman Machine.
 * @param progressCallback Called with (percentComplete, stepDescription)
 * @param state Optional SetupState for tracking
 * @returns PodmanSetupResult
 */
async function setupPodmanMacOS(
  progressCallback: (percentComplete: number, step: string) => void,
  state?: any,
): Promise<PodmanSetupResult> {
  // Step 1 (0-20%): Verify bundled Podman binary exists
  safeProgressUpdate(progressCallback, 0, "Checking for Podman binary", state);

  const podmanBinaries = [
    "/opt/homebrew/bin/podman",
    "/usr/local/bin/podman",
    "/usr/local/podman/bin/podman",
    "podman",
  ];

  let podmanPath: string | null = null;
  for (const binary of podmanBinaries) {
    if (await binaryExists(binary)) {
      podmanPath = binary;
      break;
    }
  }

  if (!podmanPath) {
    const recoveryOptions = [
      {
        label: "View Podman Installation Guide",
        action: "open-docs" as const,
        url: "https://podman.io/docs/installation",
        description: "Install Podman from podman.io",
      },
      {
        label: "Use Docker Desktop Instead",
        action: "fallback-docker" as const,
        description: "Switch to Docker Desktop if you have it installed",
      },
      {
        label: "Retry",
        action: "retry" as const,
      },
    ];
    if (state?.setError) {
      state.setError("PODMAN_NOT_FOUND", "Podman binary not found on this system", recoveryOptions);
    }
    return {
      success: false,
      error: "Podman binary not found on this system",
      recoveryOptions,
    };
  }

  safeProgressUpdate(progressCallback, 20, "Checking for existing Podman Machine", state);

  // Step 2 (20-40%): Check if Podman Machine exists
  const machineListOutput = await executeJsonCommand<Array<{ Name: string; Running: boolean }>>(
    `${podmanPath} machine list --format json`,
  );

  const machineExists = machineListOutput && machineListOutput.length > 0;
  const machineRunning = machineListOutput?.some((m) => m.Running) ?? false;

  safeProgressUpdate(
    progressCallback,
    40,
    machineRunning ? "Podman Machine already running" : "Setting up Podman Machine",
    state,
  );

  // Step 3 (40-75%): Create or start machine
  if (!machineExists) {
    // Create and start new machine
    safeProgressUpdate(progressCallback, 50, "Initializing Podman Machine (this may take a minute)", state);

    try {
      await new Promise<void>((resolve, reject) => {
        const initProc = Bun.spawn([podmanPath, "machine", "init", "--now"], {
          stdout: "pipe",
          stderr: "null",
          env: podmanEnv(),
        });

        const startTime = Date.now();
        let lastProgress = 50;
        const pollInterval = 100;
        const timeoutMs = 120000; // 2 minutes

        // Set up timeout to kill process if it hangs
        const timeout = setTimeout(() => {
          clearInterval(pollInterval_id);
          initProc.kill();
          reject(new Error("Podman machine init timed out after 120 seconds"));
        }, timeoutMs);

        // Poll for completion with progress updates
        const pollInterval_id = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const currentProgress = Math.min(50 + Math.floor((elapsed / timeoutMs) * 25), 74);
          if (currentProgress > lastProgress) {
            lastProgress = currentProgress;
            safeProgressUpdate(
              progressCallback,
              currentProgress,
              "Initializing Podman Machine (this may take a minute)",
              state,
            );
          }
        }, pollInterval);

        initProc.exited.then((exitCode) => {
          clearTimeout(timeout);
          clearInterval(pollInterval_id);
          if (exitCode === 0) {
            resolve();
          } else {
            reject(new Error(`podman machine init exited with code ${exitCode}`));
          }
        }).catch((err) => {
          clearTimeout(timeout);
          clearInterval(pollInterval_id);
          reject(err);
        });
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const recoveryOptions = [
        {
          label: "View Troubleshooting Guide",
          action: "open-docs" as const,
          url: "https://podman.io/docs/installation#macos",
          description: "See troubleshooting steps for Podman Machine",
        },
        {
          label: "Uninstall Podman",
          action: "open-uninstall-guide" as const,
          description: "Completely uninstall Podman and try Docker Desktop",
        },
        {
          label: "Retry",
          action: "retry" as const,
        },
      ];
      if (state?.setError) {
        state.setError("PODMAN_MACHINE_INIT_FAILED", errorMessage, recoveryOptions);
      }
      return {
        success: false,
        error: errorMessage || "Failed to initialize Podman Machine",
        recoveryOptions,
      };
    }
  } else if (!machineRunning) {
    // Start existing machine
    try {
      await new Promise<void>((resolve, reject) => {
        const startProc = Bun.spawn([podmanPath, "machine", "start"], {
          stdout: "pipe",
          stderr: "null",
          env: podmanEnv(),
        });

        const timeout = setTimeout(() => {
          startProc.kill();
          reject(new Error("Podman machine start timed out after 60 seconds"));
        }, 60000); // 60 second timeout for start

        startProc.exited.then((exitCode) => {
          clearTimeout(timeout);
          if (exitCode === 0) {
            resolve();
          } else {
            reject(new Error(`podman machine start exited with code ${exitCode}`));
          }
        });

        startProc.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const recoveryOptions = [
        {
          label: "View Troubleshooting Guide",
          action: "open-docs" as const,
          url: "https://podman.io/docs/installation#macos",
        },
        {
          label: "Retry",
          action: "retry" as const,
        },
      ];
      if (state?.setError) {
        state.setError("PODMAN_MACHINE_START_FAILED", errorMessage, recoveryOptions);
      }
      return {
        success: false,
        error: errorMessage || "Failed to start Podman Machine",
        recoveryOptions,
      };
    }
  }

  safeProgressUpdate(progressCallback, 75, "Validating Podman connection", state);

  // Step 4 (75-100%): Validate connection
  const infoOutput = await executeCommand(`${podmanPath} info`);

  if (!infoOutput) {
    const recoveryOptions = [
      {
        label: "Restart Podman Machine",
        action: "retry" as const,
        command: `${podmanPath} machine restart`,
        description: "Attempt to restart the Podman Machine",
      },
      {
        label: "View Troubleshooting Guide",
        action: "open-docs" as const,
        url: "https://podman.io/docs/installation#macos",
      },
    ];
    if (state?.setError) {
      state.setError("PODMAN_CONNECTION_FAILED", "Failed to validate Podman connection", recoveryOptions);
    }
    return {
      success: false,
      error: "Failed to validate Podman connection",
      recoveryOptions,
    };
  }

  safeProgressUpdate(progressCallback, 100, "Podman setup complete", state);
  return { success: true, runtime: "podman" };
}

/**
 * Setup Podman on Windows with WSL2 fallback to Docker Desktop.
 * @param progressCallback Called with (percentComplete, stepDescription)
 * @param state Optional SetupState for tracking
 * @returns PodmanSetupResult
 */
async function setupPodmanWindows(
  progressCallback: (percentComplete: number, step: string) => void,
  state?: any,
): Promise<PodmanSetupResult> {
  // Step 1 (0-30%): Try Docker Desktop first
  safeProgressUpdate(progressCallback, 0, "Checking for Docker Desktop", state);

  // Issue 2: Use environment variable fallbacks for Windows paths
  const progFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
  const localAppData = process.env.LOCALAPPDATA ?? `${process.env.USERPROFILE}\\AppData\\Local`;

  const dockerBinaries = [
    `${progFiles}\\Docker\\Docker\\resources\\bin\\docker.exe`,
    `${localAppData}\\Docker\\Docker\\Docker.exe`,
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    "docker",
  ];

  let dockerPath: string | null = null;
  for (const binary of dockerBinaries) {
    if (await binaryExists(binary)) {
      dockerPath = binary;
      break;
    }
  }

  if (dockerPath) {
    safeProgressUpdate(progressCallback, 100, "Docker Desktop found", state);
    return { success: true, runtime: "docker" };
  }

  safeProgressUpdate(progressCallback, 30, "Docker not found, checking for Podman", state);

  // Step 2 (30-100%): Try Podman Machine on WSL2
  const podmanBinaries = [
    `${progFiles}\\Podman\\podman.exe`,
    "C:\\Program Files\\Podman\\podman.exe",
    "podman",
  ];

  let podmanPath: string | null = null;
  for (const binary of podmanBinaries) {
    if (await binaryExists(binary)) {
      podmanPath = binary;
      break;
    }
  }

  if (!podmanPath) {
    const recoveryOptions = [
      {
        label: "Install Docker Desktop",
        action: "open-docs" as const,
        url: "https://www.docker.com/products/docker-desktop",
        description: "Download and install Docker Desktop for Windows",
      },
      {
        label: "Install Podman with WSL2",
        action: "open-docs" as const,
        url: "https://podman.io/docs/installation#windows",
        description: "Install Podman and WSL2 for Windows",
      },
      {
        label: "Retry",
        action: "retry" as const,
      },
    ];
    if (state?.setError) {
      state.setError(
        "CONTAINER_RUNTIME_NOT_FOUND",
        "Neither Docker Desktop nor Podman found on this system",
        recoveryOptions,
      );
    }
    return {
      success: false,
      error: "Neither Docker Desktop nor Podman found on this system",
      recoveryOptions,
    };
  }

  safeProgressUpdate(progressCallback, 40, "Checking for WSL2", state);

  // Verify WSL2 is installed
  const wslCheck = await executeCommand("wsl --list");
  if (!wslCheck) {
    const recoveryOptions = [
      {
        label: "Install WSL2",
        action: "open-docs" as const,
        url: "https://learn.microsoft.com/en-us/windows/wsl/install",
        description: "Follow Microsoft's WSL2 installation guide",
      },
      {
        label: "Retry",
        action: "retry" as const,
      },
    ];
    if (state?.setError) {
      state.setError("WSL2_NOT_INSTALLED", "WSL2 (Windows Subsystem for Linux 2) is not installed", recoveryOptions);
    }
    return {
      success: false,
      error: "WSL2 (Windows Subsystem for Linux 2) is not installed",
      recoveryOptions,
    };
  }

  safeProgressUpdate(progressCallback, 50, "Verifying Podman Machine setup", state);

  // Check if machine exists
  const machineListOutput = await executeJsonCommand<Array<{ Name: string; Running: boolean }>>(
    `${podmanPath} machine list --format json`,
  );

  const machineExists = machineListOutput && machineListOutput.length > 0;
  const machineRunning = machineListOutput?.some((m) => m.Running) ?? false;

  // Step 2b: Create or start machine
  if (!machineExists) {
    safeProgressUpdate(progressCallback, 60, "Initializing Podman Machine", state);

    try {
      await new Promise<void>((resolve, reject) => {
        const initProc = Bun.spawn([podmanPath, "machine", "init", "--now"], {
          stdout: "pipe",
          stderr: "null",
          env: podmanEnv(),
        });

        const startTime = Date.now();
        let lastProgress = 60;
        const pollInterval = 100;
        const timeoutMs = 120000; // 2 minutes

        // Set up timeout to kill process if it hangs
        const timeout = setTimeout(() => {
          clearInterval(pollInterval_id);
          initProc.kill();
          reject(new Error("Podman machine init timed out after 120 seconds"));
        }, timeoutMs);

        // Poll for completion with progress updates
        const pollInterval_id = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const currentProgress = Math.min(60 + Math.floor((elapsed / timeoutMs) * 40), 99);
          if (currentProgress > lastProgress) {
            lastProgress = currentProgress;
            safeProgressUpdate(
              progressCallback,
              currentProgress,
              "Initializing Podman Machine (this may take a minute)",
              state,
            );
          }
        }, pollInterval);

        initProc.exited.then((exitCode) => {
          clearTimeout(timeout);
          clearInterval(pollInterval_id);
          if (exitCode === 0) {
            resolve();
          } else {
            reject(new Error(`podman machine init exited with code ${exitCode}`));
          }
        }).catch((err) => {
          clearTimeout(timeout);
          clearInterval(pollInterval_id);
          reject(err);
        });
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const recoveryOptions = [
        {
          label: "View WSL2 Troubleshooting",
          action: "open-docs" as const,
          url: "https://podman.io/docs/installation#windows",
        },
        {
          label: "Try Docker Desktop Instead",
          action: "fallback-docker" as const,
          description: "Switch to Docker Desktop",
        },
        {
          label: "Retry",
          action: "retry" as const,
        },
      ];
      if (state?.setError) {
        state.setError("PODMAN_MACHINE_INIT_FAILED_WSL2", errorMessage, recoveryOptions);
      }
      return {
        success: false,
        error: errorMessage || "Failed to initialize Podman Machine on WSL2",
        recoveryOptions,
      };
    }
  } else if (!machineRunning) {
    safeProgressUpdate(progressCallback, 70, "Starting Podman Machine", state);

    try {
      await new Promise<void>((resolve, reject) => {
        const startProc = Bun.spawn([podmanPath, "machine", "start"], {
          stdout: "pipe",
          stderr: "null",
          env: podmanEnv(),
        });

        const timeout = setTimeout(() => {
          startProc.kill();
          reject(new Error("Podman machine start timed out after 60 seconds"));
        }, 60000);

        startProc.exited.then((exitCode) => {
          clearTimeout(timeout);
          if (exitCode === 0) {
            resolve();
          } else {
            reject(new Error(`podman machine start exited with code ${exitCode}`));
          }
        });

        startProc.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const recoveryOptions = [
        {
          label: "Retry",
          action: "retry" as const,
        },
        {
          label: "View Troubleshooting Guide",
          action: "open-docs" as const,
          url: "https://podman.io/docs/installation#windows",
        },
      ];
      if (state?.setError) {
        state.setError("PODMAN_MACHINE_START_FAILED_WSL2", errorMessage, recoveryOptions);
      }
      return {
        success: false,
        error: errorMessage || "Failed to start Podman Machine",
        recoveryOptions,
      };
    }
  }

  safeProgressUpdate(progressCallback, 85, "Validating Podman connection", state);

  // Validate connection
  const infoOutput = await executeCommand(`${podmanPath} info`);
  if (!infoOutput) {
    const recoveryOptions = [
      {
        label: "Retry",
        action: "retry" as const,
      },
      {
        label: "Troubleshooting Guide",
        action: "open-docs" as const,
        url: "https://podman.io/docs/installation#windows",
      },
    ];
    if (state?.setError) {
      state.setError("PODMAN_CONNECTION_FAILED_WSL2", "Failed to validate Podman connection", recoveryOptions);
    }
    return {
      success: false,
      error: "Failed to validate Podman connection",
      recoveryOptions,
    };
  }

  safeProgressUpdate(progressCallback, 100, "Podman setup complete", state);
  return { success: true, runtime: "podman" };
}

/**
 * Setup Podman on Linux with rootless configuration.
 * @param progressCallback Called with (percentComplete, stepDescription)
 * @param state Optional SetupState for tracking
 * @returns PodmanSetupResult
 */
async function setupPodmanLinux(
  progressCallback: (percentComplete: number, step: string) => void,
  state?: any,
): Promise<PodmanSetupResult> {
  // Step 1 (0-40%): Verify Podman binary
  safeProgressUpdate(progressCallback, 0, "Checking for Podman binary", state);

  const podmanBinaries = [
    "/usr/bin/podman",
    "/usr/local/bin/podman",
    "podman",
  ];

  let podmanPath: string | null = null;
  for (const binary of podmanBinaries) {
    if (await binaryExists(binary)) {
      podmanPath = binary;
      break;
    }
  }

  if (!podmanPath) {
    const recoveryOptions = [
      {
        label: "View Podman Installation Guide",
        action: "open-docs" as const,
        url: "https://podman.io/docs/installation#linux",
        description: "Install Podman using your distribution's package manager",
      },
      {
        label: "Retry",
        action: "retry" as const,
      },
    ];
    if (state?.setError) {
      state.setError("PODMAN_NOT_FOUND_LINUX", "Podman is not installed on this system", recoveryOptions);
    }
    return {
      success: false,
      error: "Podman is not installed on this system",
      recoveryOptions,
    };
  }

  safeProgressUpdate(progressCallback, 40, "Checking rootless setup", state);

  // Step 2 (40-70%): Check rootless setup
  const socketPath = join(homedir(), ".local/share/podman/podman.sock");
  const socketCheck = Bun.file(socketPath);
  const socketExists = await socketCheck.exists().catch(() => false);

  if (!socketExists) {
    safeProgressUpdate(progressCallback, 50, "Migrating Podman system for rootless", state);

    // Try to run system migrate if rootless not set up
    try {
      await new Promise<void>((resolve, reject) => {
        const migrateProc = Bun.spawn([podmanPath, "system", "migrate"], {
          stdout: "pipe",
          stderr: "null",
          env: podmanEnv(),
        });

        const timeout = setTimeout(() => {
          migrateProc.kill();
          reject(new Error("Podman system migrate timed out after 60 seconds"));
        }, 60000);

        migrateProc.exited.then((exitCode) => {
          clearTimeout(timeout);
          if (exitCode === 0) {
            resolve();
          } else {
            reject(new Error(`podman system migrate exited with code ${exitCode}`));
          }
        });

        migrateProc.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const recoveryOptions = [
        {
          label: "View Rootless Setup Guide",
          action: "open-docs" as const,
          url: "https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md",
          description: "Follow the rootless Podman setup guide",
        },
        {
          label: "Uninstall Podman",
          action: "open-uninstall-guide" as const,
          description: "Completely remove Podman and reinstall",
        },
        {
          label: "Retry",
          action: "retry" as const,
        },
      ];
      if (state?.setError) {
        state.setError("PODMAN_ROOTLESS_SETUP_FAILED", errorMessage, recoveryOptions);
      }
      return {
        success: false,
        error: errorMessage || "Failed to set up rootless Podman",
        recoveryOptions,
      };
    }
  }

  safeProgressUpdate(progressCallback, 70, "Validating Podman connection", state);

  // Step 3 (70-100%): Validate connection
  const infoOutput = await executeCommand(`${podmanPath} info`);

  if (!infoOutput) {
    const recoveryOptions = [
      {
        label: "Troubleshooting Guide",
        action: "open-docs" as const,
        url: "https://podman.io/docs/installation#linux",
      },
      {
        label: "Retry",
        action: "retry" as const,
      },
    ];
    if (state?.setError) {
      state.setError("PODMAN_CONNECTION_FAILED_LINUX", "Failed to validate Podman connection", recoveryOptions);
    }
    return {
      success: false,
      error: "Failed to validate Podman connection",
      recoveryOptions,
    };
  }

  safeProgressUpdate(progressCallback, 100, "Podman setup complete", state);
  return { success: true, runtime: "podman" };
}

/**
 * Main orchestrator function for Podman setup.
 * Detects platform and routes to appropriate platform-specific setup function.
 *
 * @param state The SetupState instance to track progress
 * @param progressCallback Called with (percentComplete, stepDescription)
 * @returns PodmanSetupResult indicating success or failure with recovery options
 */
export async function setupPodman(
  state: SetupState,
  progressCallback: (percentComplete: number, step: string) => void,
): Promise<PodmanSetupResult> {
  const platform = state.getPlatform();

  try {
    if (platform === "darwin") {
      return await setupPodmanMacOS(progressCallback, state);
    } else if (platform === "win32") {
      return await setupPodmanWindows(progressCallback, state);
    } else if (platform === "linux") {
      return await setupPodmanLinux(progressCallback, state);
    } else {
      const recoveryOptions = [
        {
          label: "Cancel",
          action: "cancel" as const,
        },
      ];
      state.setError("UNSUPPORTED_PLATFORM", `Unsupported platform: ${platform}`, recoveryOptions);
      return {
        success: false,
        error: `Unsupported platform: ${platform}`,
        recoveryOptions,
      };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const recoveryOptions = [
      {
        label: "Retry",
        action: "retry" as const,
      },
      {
        label: "Cancel",
        action: "cancel" as const,
      },
    ];
    state.setError("UNEXPECTED_ERROR", errorMessage, recoveryOptions);
    return {
      success: false,
      error: `Unexpected error during setup: ${errorMessage}`,
      recoveryOptions,
    };
  }
}

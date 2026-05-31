import { homedir } from "os";
import { join } from "path";
import type { SetupState } from "./setup-state";

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
    const proc = Bun.spawn(parts, { stdout: "pipe", stderr: "pipe" });
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
    const proc = Bun.spawn(parts, { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      const output = await new Response(proc.stdout).text();
      return JSON.parse(output);
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
    const proc = Bun.spawn([binaryPath, "--version"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Setup Podman on macOS with Podman Machine.
 * @param progressCallback Called with (percentComplete, stepDescription)
 * @returns PodmanSetupResult
 */
async function setupPodmanMacOS(
  progressCallback: (percentComplete: number, step: string) => void,
): Promise<PodmanSetupResult> {
  // Step 1 (0-20%): Verify bundled Podman binary exists
  progressCallback(0, "Checking for Podman binary");

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
    return {
      success: false,
      error: "Podman binary not found on this system",
      recoveryOptions: [
        {
          label: "View Podman Installation Guide",
          action: "open-docs",
          url: "https://podman.io/docs/installation",
          description: "Install Podman from podman.io",
        },
        {
          label: "Use Docker Desktop Instead",
          action: "fallback-docker",
          description: "Switch to Docker Desktop if you have it installed",
        },
        {
          label: "Retry",
          action: "retry",
        },
      ],
    };
  }

  progressCallback(20, "Checking for existing Podman Machine");

  // Step 2 (20-40%): Check if Podman Machine exists
  const machineListOutput = await executeJsonCommand<Array<{ Name: string; Running: boolean }>>(
    `${podmanPath} machine list --format json`,
  );

  const machineExists = machineListOutput && machineListOutput.length > 0;
  const machineRunning = machineListOutput?.some((m) => m.Running) ?? false;

  progressCallback(40, machineRunning ? "Podman Machine already running" : "Setting up Podman Machine");

  // Step 3 (40-75%): Create or start machine
  if (!machineExists) {
    // Create and start new machine
    progressCallback(50, "Initializing Podman Machine (this may take a minute)");

    const initProc = Bun.spawn([podmanPath, "machine", "init", "--now"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const startTime = Date.now();
    let lastProgress = 50;
    const pollInterval = 100; // Poll more frequently in tests
    const timeoutMs = 120000; // 2 minutes

    // Poll for completion with progress updates
    const pollInterval_id = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const currentProgress = Math.min(50 + Math.floor((elapsed / timeoutMs) * 25), 74);
      if (currentProgress > lastProgress) {
        lastProgress = currentProgress;
        progressCallback(currentProgress, "Initializing Podman Machine (this may take a minute)");
      }
    }, pollInterval);

    const exitCode = await initProc.exited;
    clearInterval(pollInterval_id);

    if (exitCode !== 0) {
      return {
        success: false,
        error: "Failed to initialize Podman Machine",
        recoveryOptions: [
          {
            label: "View Troubleshooting Guide",
            action: "open-docs",
            url: "https://podman.io/docs/installation#macos",
            description: "See troubleshooting steps for Podman Machine",
          },
          {
            label: "Uninstall Podman",
            action: "open-uninstall-guide",
            description: "Completely uninstall Podman and try Docker Desktop",
          },
          {
            label: "Retry",
            action: "retry",
          },
        ],
      };
    }
  } else if (!machineRunning) {
    // Start existing machine
    const startProc = Bun.spawn([podmanPath, "machine", "start"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await startProc.exited;

    if (exitCode !== 0) {
      return {
        success: false,
        error: "Failed to start Podman Machine",
        recoveryOptions: [
          {
            label: "View Troubleshooting Guide",
            action: "open-docs",
            url: "https://podman.io/docs/installation#macos",
          },
          {
            label: "Retry",
            action: "retry",
          },
        ],
      };
    }
  }

  progressCallback(75, "Validating Podman connection");

  // Step 4 (75-100%): Validate connection
  const infoOutput = await executeCommand(`${podmanPath} info`);

  if (!infoOutput) {
    return {
      success: false,
      error: "Failed to validate Podman connection",
      recoveryOptions: [
        {
          label: "Restart Podman Machine",
          action: "retry",
          command: `${podmanPath} machine restart`,
          description: "Attempt to restart the Podman Machine",
        },
        {
          label: "View Troubleshooting Guide",
          action: "open-docs",
          url: "https://podman.io/docs/installation#macos",
        },
      ],
    };
  }

  progressCallback(100, "Podman setup complete");
  return { success: true, runtime: "podman" };
}

/**
 * Setup Podman on Windows with WSL2 fallback to Docker Desktop.
 * @param progressCallback Called with (percentComplete, stepDescription)
 * @returns PodmanSetupResult
 */
async function setupPodmanWindows(
  progressCallback: (percentComplete: number, step: string) => void,
): Promise<PodmanSetupResult> {
  // Step 1 (0-30%): Try Docker Desktop first
  progressCallback(0, "Checking for Docker Desktop");

  const dockerBinaries = [
    `${process.env["PROGRAMFILES"]}\\Docker\\Docker\\resources\\bin\\docker.exe`,
    `${process.env["LOCALAPPDATA"]}\\Docker\\Docker\\Docker.exe`,
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
    progressCallback(100, "Docker Desktop found");
    return { success: true, runtime: "docker" };
  }

  progressCallback(30, "Docker not found, checking for Podman");

  // Step 2 (30-100%): Try Podman Machine on WSL2
  const podmanBinaries = [
    `${process.env["PROGRAMFILES"]}\\Podman\\podman.exe`,
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
    return {
      success: false,
      error: "Neither Docker Desktop nor Podman found on this system",
      recoveryOptions: [
        {
          label: "Install Docker Desktop",
          action: "open-docs",
          url: "https://www.docker.com/products/docker-desktop",
          description: "Download and install Docker Desktop for Windows",
        },
        {
          label: "Install Podman with WSL2",
          action: "open-docs",
          url: "https://podman.io/docs/installation#windows",
          description: "Install Podman and WSL2 for Windows",
        },
        {
          label: "Retry",
          action: "retry",
        },
      ],
    };
  }

  progressCallback(40, "Checking for WSL2");

  // Verify WSL2 is installed
  const wslCheck = await executeCommand("wsl --list");
  if (!wslCheck) {
    return {
      success: false,
      error: "WSL2 (Windows Subsystem for Linux 2) is not installed",
      recoveryOptions: [
        {
          label: "Install WSL2",
          action: "open-docs",
          url: "https://learn.microsoft.com/en-us/windows/wsl/install",
          description: "Follow Microsoft's WSL2 installation guide",
        },
        {
          label: "Retry",
          action: "retry",
        },
      ],
    };
  }

  progressCallback(50, "Verifying Podman Machine setup");

  // Check if machine exists
  const machineListOutput = await executeJsonCommand<Array<{ Name: string; Running: boolean }>>(
    `${podmanPath} machine list --format json`,
  );

  const machineExists = machineListOutput && machineListOutput.length > 0;
  const machineRunning = machineListOutput?.some((m) => m.Running) ?? false;

  // Step 2b: Create or start machine
  if (!machineExists) {
    progressCallback(60, "Initializing Podman Machine");

    const initProc = Bun.spawn([podmanPath, "machine", "init", "--now"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const startTime = Date.now();
    let lastProgress = 60;
    const pollInterval = 100;
    const timeoutMs = 120000; // 2 minutes

    // Poll for completion with progress updates
    const pollInterval_id = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const currentProgress = Math.min(60 + Math.floor((elapsed / timeoutMs) * 40), 99);
      if (currentProgress > lastProgress) {
        lastProgress = currentProgress;
        progressCallback(currentProgress, "Initializing Podman Machine (this may take a minute)");
      }
    }, pollInterval);

    const exitCode = await initProc.exited;
    clearInterval(pollInterval_id);

    if (exitCode !== 0) {
      return {
        success: false,
        error: "Failed to initialize Podman Machine on WSL2",
        recoveryOptions: [
          {
            label: "View WSL2 Troubleshooting",
            action: "open-docs",
            url: "https://podman.io/docs/installation#windows",
          },
          {
            label: "Try Docker Desktop Instead",
            action: "fallback-docker",
            description: "Switch to Docker Desktop",
          },
          {
            label: "Retry",
            action: "retry",
          },
        ],
      };
    }
  } else if (!machineRunning) {
    progressCallback(70, "Starting Podman Machine");

    const startProc = Bun.spawn([podmanPath, "machine", "start"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await startProc.exited;

    if (exitCode !== 0) {
      return {
        success: false,
        error: "Failed to start Podman Machine",
        recoveryOptions: [
          {
            label: "Retry",
            action: "retry",
          },
          {
            label: "View Troubleshooting Guide",
            action: "open-docs",
            url: "https://podman.io/docs/installation#windows",
          },
        ],
      };
    }
  }

  progressCallback(85, "Validating Podman connection");

  // Validate connection
  const infoOutput = await executeCommand(`${podmanPath} info`);
  if (!infoOutput) {
    return {
      success: false,
      error: "Failed to validate Podman connection",
      recoveryOptions: [
        {
          label: "Retry",
          action: "retry",
        },
        {
          label: "Troubleshooting Guide",
          action: "open-docs",
          url: "https://podman.io/docs/installation#windows",
        },
      ],
    };
  }

  progressCallback(100, "Podman setup complete");
  return { success: true, runtime: "podman" };
}

/**
 * Setup Podman on Linux with rootless configuration.
 * @param progressCallback Called with (percentComplete, stepDescription)
 * @returns PodmanSetupResult
 */
async function setupPodmanLinux(
  progressCallback: (percentComplete: number, step: string) => void,
): Promise<PodmanSetupResult> {
  // Step 1 (0-40%): Verify Podman binary
  progressCallback(0, "Checking for Podman binary");

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
    return {
      success: false,
      error: "Podman is not installed on this system",
      recoveryOptions: [
        {
          label: "View Podman Installation Guide",
          action: "open-docs",
          url: "https://podman.io/docs/installation#linux",
          description: "Install Podman using your distribution's package manager",
        },
        {
          label: "Retry",
          action: "retry",
        },
      ],
    };
  }

  progressCallback(40, "Checking rootless setup");

  // Step 2 (40-70%): Check rootless setup
  const socketPath = join(homedir(), ".local/share/podman/podman.sock");
  const socketCheck = Bun.file(socketPath);
  const socketExists = await socketCheck.exists().catch(() => false);

  if (!socketExists) {
    progressCallback(50, "Migrating Podman system for rootless");

    // Try to run system migrate if rootless not set up
    const migrateProc = Bun.spawn([podmanPath, "system", "migrate"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await migrateProc.exited;

    if (exitCode !== 0) {
      return {
        success: false,
        error: "Failed to set up rootless Podman",
        recoveryOptions: [
          {
            label: "View Rootless Setup Guide",
            action: "open-docs",
            url: "https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md",
            description: "Follow the rootless Podman setup guide",
          },
          {
            label: "Uninstall Podman",
            action: "open-uninstall-guide",
            description: "Completely remove Podman and reinstall",
          },
          {
            label: "Retry",
            action: "retry",
          },
        ],
      };
    }
  }

  progressCallback(70, "Validating Podman connection");

  // Step 3 (70-100%): Validate connection
  const infoOutput = await executeCommand(`${podmanPath} info`);

  if (!infoOutput) {
    return {
      success: false,
      error: "Failed to validate Podman connection",
      recoveryOptions: [
        {
          label: "Troubleshooting Guide",
          action: "open-docs",
          url: "https://podman.io/docs/installation#linux",
        },
        {
          label: "Retry",
          action: "retry",
        },
      ],
    };
  }

  progressCallback(100, "Podman setup complete");
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
      return await setupPodmanMacOS(progressCallback);
    } else if (platform === "win32") {
      return await setupPodmanWindows(progressCallback);
    } else if (platform === "linux") {
      return await setupPodmanLinux(progressCallback);
    } else {
      return {
        success: false,
        error: `Unsupported platform: ${platform}`,
        recoveryOptions: [
          {
            label: "Cancel",
            action: "cancel",
          },
        ],
      };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Unexpected error during setup: ${errorMessage}`,
      recoveryOptions: [
        {
          label: "Retry",
          action: "retry",
        },
        {
          label: "Cancel",
          action: "cancel",
        },
      ],
    };
  }
}

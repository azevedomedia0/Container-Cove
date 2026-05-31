import { Electroview } from "electrobun/view";
import type { RecoveryOption } from "../../main/setup-state";

// Electrobun ≥1.18.1 changed Electroview to require a config arg; pass {} to
// avoid the "Cannot read properties of undefined (reading 'rpc')" crash.
// Polyfill ev.on / ev.send to match the Electrobun RPC envelope format:
//   { type: "message", id: <channel>, payload: <data> }
const ev = new Electroview({} as any);
(ev as any).on = function (
  name: string,
  handler: (msg: unknown) => void,
): void {
  // rpcHandler receives the full RPC envelope from bun; unwrap payload before
  // dispatching so the handler sees the raw message, not the envelope.
  this.rpcHandler = (envelope: any) => {
    if (envelope?.type === "message" && envelope?.id === name) {
      handler(envelope.payload);
    }
  };
};
(ev as any).send = function (name: string, payload: unknown): void {
  // Wrap in the RPC message envelope that Electrobun's bun-side handler expects.
  this.bunBridge(JSON.stringify({ type: "message", id: name, payload }));
};

// ── IPC Message Types ───────────────────────────────────────────────
interface SetupProgressMessage {
  percentComplete: number;
  currentStep: string;
}

interface SetupErrorMessage {
  message: string;
  recoveryOptions: RecoveryOption[];
}

// ── UI State ────────────────────────────────────────────────────────
type ScreenName = "permission" | "progress" | "error";

let currentScreen: ScreenName = "permission";
let setupStarted = false;

// ── DOM Elements ────────────────────────────────────────────────────
// Non-null assertions are safe here because we control the HTML structure in index.html.
// If any element ID is removed from the HTML, this will throw at runtime—update this list if that happens.

// Permission screen
const permissionScreen = document.getElementById("permission-screen")!;
const btnPermissionAllow = document.getElementById("btn-permission-allow")!;
const btnPermissionCancel = document.getElementById("btn-permission-cancel")!;

// Progress screen
const progressScreen = document.getElementById("progress-screen")!;
const progressBar = document.getElementById("progress-bar")!;
const progressFill = document.getElementById("progress-fill")!;
const progressText = document.getElementById("progress-text")!;
const progressStep = document.getElementById("progress-step")!;
const btnProgressCancel = document.getElementById("btn-progress-cancel")!;

// Error screen
const errorScreen = document.getElementById("error-screen")!;
const errorMessage = document.getElementById("error-message")!;
const recoveryOptions = document.getElementById("recovery-options")!;
const btnErrorRetry = document.getElementById("btn-error-retry")!;

// ── Screen Switching ────────────────────────────────────────────────

function showScreen(screen: ScreenName): void {
  // Remove .active from all screens
  permissionScreen.classList.remove("active");
  progressScreen.classList.remove("active");
  errorScreen.classList.remove("active");

  // Add .active to target screen
  if (screen === "permission") {
    permissionScreen.classList.add("active");
  } else if (screen === "progress") {
    progressScreen.classList.add("active");
  } else if (screen === "error") {
    errorScreen.classList.add("active");
  }

  currentScreen = screen;
}

// ── Event Handlers ──────────────────────────────────────────────────

// Permission prompt: Allow
btnPermissionAllow.addEventListener("click", () => {
  showScreen("progress");
  setupStarted = true;
  ev.send("setup:start", {});
});

// Permission prompt: Cancel
btnPermissionCancel.addEventListener("click", () => {
  ev.send("setup:cancel", {});
});

// Progress screen: Cancel
btnProgressCancel.addEventListener("click", () => {
  ev.send("setup:cancel", {});
});

// Error screen: Retry
btnErrorRetry.addEventListener("click", () => {
  showScreen("progress");
  ev.send("setup:retry", {});
});

// ── IPC Listeners ───────────────────────────────────────────────────

// setup:progress — Update progress bar and step info
ev.on("setup:progress", (payload: SetupProgressMessage) => {
  const { percentComplete, currentStep } = payload;

  // Update progress bar width
  progressFill.style.width = `${percentComplete}%`;

  // Update percentage text
  progressText.textContent = `${percentComplete}%`;

  // Update step description
  progressStep.textContent = currentStep;

  // Update aria-valuenow for accessibility
  progressBar.setAttribute("aria-valuenow", String(percentComplete));
});

// setup:complete — Mark completion and close wizard
ev.on("setup:complete", () => {
  // Guard: only process if we're still in progress
  if (currentScreen !== "progress") return;

  // Set progress bar to 100%
  progressFill.style.width = "100%";
  progressText.textContent = "100%";
  progressBar.setAttribute("aria-valuenow", "100");

  // Set step to "Ready!"
  progressStep.textContent = "Ready!";

  // After 1.5 seconds, notify main process and close
  setTimeout(() => {
    ev.send("setup:finished", {});
  }, 1500);
});

// setup:error — Show error screen with recovery options
ev.on("setup:error", (payload: SetupErrorMessage) => {
  const { message, recoveryOptions: options } = payload;

  // Set error message
  errorMessage.textContent = message;

  // Clear and rebuild recovery options
  while (recoveryOptions.firstChild) {
    recoveryOptions.removeChild(recoveryOptions.firstChild);
  }

  if (options && Array.isArray(options)) {
    for (const option of options) {
      // Validate option has required properties
      if (!option.label || !option.action) {
        console.warn("Invalid recovery option:", option);
        continue; // Skip malformed options
      }

      const optionDiv = document.createElement("div");
      optionDiv.className = "recovery-option";

      // Label
      const label = document.createElement("strong");
      label.textContent = option.label;
      optionDiv.appendChild(label);

      // Description
      const desc = document.createElement("p");
      desc.textContent = option.description || "";
      optionDiv.appendChild(desc);

      // Action-specific content
      if (option.action === "open-docs" && option.url) {
        const link = document.createElement("a");
        link.href = option.url;
        link.textContent = "Open documentation";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        optionDiv.appendChild(link);
      } else if (option.action === "open-uninstall-guide") {
        const code = document.createElement("code");
        code.textContent = option.command || "podman system prune";
        optionDiv.appendChild(code);

        const instructions = document.createElement("p");
        instructions.textContent = "Run the command above in your terminal to uninstall.";
        optionDiv.appendChild(instructions);
      } else if (option.action === "fallback-docker") {
        const link = document.createElement("a");
        link.href = option.url || "https://www.docker.com/products/docker-desktop";
        link.textContent = "Install Docker Desktop";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        optionDiv.appendChild(link);
      } else {
        console.warn("Unknown recovery action:", option.action);
      }

      recoveryOptions.appendChild(optionDiv);
    }
  }

  // Show error screen
  showScreen("error");
});

// Initialize — show permission screen on load
showScreen("permission");

import { BrowserWindow, Tray, ApplicationMenu, Utils, app } from "electrobun/bun";
import { tmpdir, cpus, loadavg } from "os";
import { join } from "path";
import { writeFileSync } from "fs";
import type { DockerApp, IpcMessage } from "../shared/types";
import { loadRegistry, registryExists, saveRegistry } from "./registry";
import {
  getContainerHealthBatch,
  getContainerMetricsBatch,
  isDockerAvailable,
  startDockerDaemon,
  checkImageUpdateAvailable,
} from "./docker";
import { fetchAllOgImages } from "./dockerhub";
import { loadMetricsHistory, saveMetricsHistory } from "./metrics-store";
import { loadSettings, saveSettings, type WindowBounds } from "./settings";
import { nextUnhealthyStreak, shouldRestartUnhealthy } from "./health-recovery";
import { appendErrorEntry } from "./error-report";
import { checkForUpdate } from "./updater";
import { resolveKeychainEnv } from "./keychain";
import { launchApp, stopApp } from "./docker";
import {
  CURRENT_VERSION,
  UPDATE_CHECK_INTERVAL_MS,
  LAUNCH_SERVER_PORT,
  LOCAL_PROXY_PORT,
} from "./constants";
import { openWebUiWindow } from "./webui";
import type { AppState, HandlerContext } from "./ipc-handlers/context";
import { handleApps } from "./ipc-handlers/apps";
import { handleSettings } from "./ipc-handlers/settings";
import { handleUpdater } from "./ipc-handlers/updater";
import { handleRegistry } from "./ipc-handlers/registry";
import { setupPodman } from "./podman-setup";
import { SetupState } from "./setup-state";

// ── Tray icon ─────────────────────────────────────────────────────────────────
const TRAY_ICON_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAARRlWElmTU0A" +
  "KgAAAAgABwESAAMAAAABAAEAAAEaAAUAAAABAAAAYgEbAAUAAAABAAAAagEoAAMAAAABAAIAAAEx" +
  "AAIAAAA/AAAAcgE7AAIAAAAUAAAAsodpAAQAAAABAAAAxgAAAAAAAABgAAAAAQAAAGAAAAABQ2Fu" +
  "dmEgZG9jPURBSExONExSTTRNIHVzZXI9VUFGVzB1WVIzUmcgYnJhbmQ9TmhhdGNoZXIxJ3MgQ2xh" +
  "c3MAAHN0ZXZlbmF6ZXZlZG9kZXNpZ24AAAaQAAAHAAAABDAyMTCRAQAHAAAABAECAwCgAAAHAAAA" +
  "BDAxMDCgAQADAAAAAQABAACgAgAEAAAAAQAAACCgAwAEAAAAAQAAACAAAAAAM3mXegAAAAlwSFlz" +
  "AAAOxAAADsQBlSsOGwAABlFpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1s" +
  "bnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDYuMC4wIj4KICAgPHJkZjpS" +
  "REYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMj" +
  "Ij4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6" +
  "ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOnht" +
  "cD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyIKICAgICAgICAgICAgeG1sbnM6dGlmZj0i" +
  "aHR0cDovL25zLmFkb2JlLmNvbS90aWZmLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOmRjPSJodHRw" +
  "Oi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyI+CiAgICAgICAgIDxleGlmOkNvbG9yU3BhY2U+" +
  "NjU1MzU8L2V4aWY6Q29sb3JTcGFjZT4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjY0" +
  "PC9leGlmOlBpeGVsWERpbWVuc2lvbj4KICAgICAgICAgPGV4aWY6RXhpZlZlcnNpb24+MDIxMDwv" +
  "ZXhpZjpFeGlmVmVyc2lvbj4KICAgICAgICAgPGV4aWY6Rmxhc2hQaXhWZXJzaW9uPjAxMDA8L2V4" +
  "aWY6Rmxhc2hQaXhWZXJzaW9uPgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+NjQ8L2V4" +
  "aWY6UGl4ZWxZRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpDb21wb25lbnRzQ29uZmlndXJhdGlv" +
  "bj4KICAgICAgICAgICAgPHJkZjpTZXE+CiAgICAgICAgICAgICAgIDxyZGY6bGk+MTwvcmRmOmxp" +
  "PgogICAgICAgICAgICAgICA8cmRmOmxpPjI8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjps" +
  "aT4zPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGk+MDwvcmRmOmxpPgogICAgICAgICAg" +
  "ICA8L3JkZjpTZXE+CiAgICAgICAgIDwvZXhpZjpDb21wb25lbnRzQ29uZmlndXJhdGlvbj4KICAg" +
  "ICAgICAgPHhtcDpDcmVhdG9yVG9vbD5DYW52YSBkb2M9REFITE40TFJNNE0gdXNlcj1VQUZXMHVZ" +
  "UjNSZyBicmFuZD1OaGF0Y2hlcjEncyBDbGFzczwveG1wOkNyZWF0b3JUb29sPgogICAgICAgICA8" +
  "dGlmZjpSZXNvbHV0aW9uVW5pdD4yPC90aWZmOlJlc29sdXRpb25Vbml0PgogICAgICAgICA8dGlm" +
  "ZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICAgICA8dGlmZjpYUmVzb2x1" +
  "dGlvbj45NjwvdGlmZjpYUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6WVJlc29sdXRpb24+OTY8" +
  "L3RpZmY6WVJlc29sdXRpb24+CiAgICAgICAgIDxkYzp0aXRsZT4KICAgICAgICAgICAgPHJkZjpB" +
  "bHQ+CiAgICAgICAgICAgICAgIDxyZGY6bGkgeG1sOmxhbmc9IngtZGVmYXVsdCI+Q29udGFpbmVy" +
  "IENvdmUgKDY0IHggNjQgcHgpIC0gMTwvcmRmOmxpPgogICAgICAgICAgICA8L3JkZjpBbHQ+CiAg" +
  "ICAgICAgIDwvZGM6dGl0bGU+CiAgICAgICAgIDxkYzpjcmVhdG9yPgogICAgICAgICAgICA8cmRm" +
  "OlNlcT4KICAgICAgICAgICAgICAgPHJkZjpsaT5zdGV2ZW5hemV2ZWRvZGVzaWduPC9yZGY6bGk+" +
  "CiAgICAgICAgICAgIDwvcmRmOlNlcT4KICAgICAgICAgPC9kYzpjcmVhdG9yPgogICAgICA8L3Jk" +
  "ZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4K995xRQAACOpJREFUWAmt" +
  "FmtwVNX5nHPv3t3NY5PdZclrQx5QCAnPUpCE8DAiSKkKQ63FmVootVaLOOrYwWrHaWFsaX+IY6nC" +
  "FMMwOhXslAFUJENpwqNCEkCESAhJWJAseewj2d1kd+/jnH7n7iNhA4U6frN37znf953v/X3nCugb" +
  "QE5OTrrRaPxeWlpaZjgc9nwDEckjJLm6t4Vgt9tXMKrWiQI5JhJ80uGw/yUrK2v8vR0fzYVHo26P" +
  "AcWzwdqNmOBHMUYCYzE+DBvGWDejbKtBlne6g8H/KyJ3NSA7O7fYIMgvYELWgDILKLuthVwQUL7U" +
  "qPZnr9f/D9hGbsuYgryjARaLxSZJ0jpg2EAIdt5JcYo8fcsQq6OyusU7MHD0dvSRuNsZIDoctlUI" +
  "kY1AnDGSOXVNqQZuM0QEkacBMUphTRDGhO8jgNkDqC1er/dS6tnEXkgs+Hus1TovLSPjrxDqjQTj" +
  "PB5ULjQmkMIW1sDHk8Bzn+UoYBnWMSw04EUGkxllO/KZHAkjqmlAxlCjZAZUyGpzWnoGIaRFluVB" +
  "rmckJCNgt1vXC0T4Exw0695wZURkxqwcFh3oxqLZggQpDRpAxmo4iCSTmS5c9RStmLuIdN/4Gtns" +
  "BTi3dAI6/MFb9F/vvylIkgnsjjUZN1bTaCNYvdLj8bhHGQBtZDVLhlOKpk3k3olwUDCm0ak/3crG" +
  "lC8kPV8cpl1N+6jRMhabsnPZ2Kk1hEH4hzw3UKj9czZv4SJccd8ScnDn71WqakwymYSmwx+SaHgI" +
  "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" +
  "tklVAAAAAElFTkSuQmCC";

const TRAY_ICON_PATH = join(tmpdir(), "container-cove-tray.png");
writeFileSync(TRAY_ICON_PATH, Buffer.from(TRAY_ICON_B64, "base64"));
const WINDOWS_TOAST_SCRIPT_PATH = join(tmpdir(), "container-cove-toast.ps1");
writeFileSync(
  WINDOWS_TOAST_SCRIPT_PATH,
  `
param(
  [string]$TitleB64,
  [string]$BodyB64
)

$Title = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TitleB64))
$Body = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($BodyB64))

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$template.GetElementsByTagName('text')[0].AppendChild($template.CreateTextNode($Title)) | Out-Null
$template.GetElementsByTagName('text')[1].AppendChild($template.CreateTextNode($Body)) | Out-Null
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Container Cove')
$notifier.Show([Windows.UI.Notifications.ToastNotification]::new($template))
  `.trim(),
);
function getPodmanInstallUrl(): string {
  if (process.platform === "darwin") {
    return "https://podman.io/getting-started/installation#macos";
  }
  if (process.platform === "win32") {
    return "https://podman.io/getting-started/installation#windows";
  }
  return "https://podman.io/docs/installation";
}

function getPodmanStateHint(
  context: "first-run" | "unavailable",
): { message: string; detail: string } {
  if (process.platform === "darwin") {
    if (context === "first-run") {
      return {
        message: "Podman is not installed.",
        detail: "Install Podman Desktop from podman.io, or run brew install podman in Terminal, then click Retry.",
      };
    }
    return {
      message: "Podman is not responding.",
      detail: "Podman Desktop may have quit or the VM stopped. Open Podman Desktop, then click Retry.",
    };
  }
  if (process.platform === "win32") {
    if (context === "first-run") {
      return {
        message: "Podman is not installed.",
        detail: "Install Podman Desktop (includes WSL2 and podman machine setup), then click Retry.",
      };
    }
    return {
      message: "Podman is not responding.",
      detail: "The Podman machine may have stopped. Click Retry to start it, or open Podman Desktop.",
    };
  }
  // Linux
  if (context === "first-run") {
    return {
      message: "Podman is not installed.",
      detail: "Install Podman with your package manager (sudo apt install podman, sudo dnf install podman, etc.), then click Retry.",
    };
  }
  return {
    message: "Podman is not responding.",
    detail: "The Podman service may have stopped. Try sudo systemctl start podman or click Retry.",
  };
}

// ── Process-level state ───────────────────────────────────────────────────────

let launcherWindow: InstanceType<typeof BrowserWindow> | null = null;
let setupWindow: InstanceType<typeof BrowserWindow> | null = null;
let launcherReady = false;
let setupStarted = false;
const appWindows = new Map<string, InstanceType<typeof BrowserWindow>>();
const logHistory = new Map<string, string[]>();
let dockerAvailable = false;
let isFirstRun = false;
let pendingTrayBulkAction: "stop-all" | "restart-all" | null = null;
let startupRestoreIds = new Set<string>();
let dockerStartPromise: Promise<void> | null = null;

// ogCache persists for the process lifetime; shared with broadcastOgImages()
const ogCache = new Map<string, string>();

// Shared mutable state object — passed by reference to all handler modules
const state: AppState = {
  apps: [],
  secretsMaskingEnabled: true,
  keychainSecretsEnabled: false,
  autoRestartOnUnhealthy: true,
  errorLoggingEnabled: true,
  notificationsEnabled: true,
  openAtLogin: false,
  autoCheckUpdates: true,
  theme: "dark",
  showOnboarding: true,
  dataDir: "~/.container-cove",
  releaseChannel: "stable",
  pendingUpdate: null,
  pendingWebUiOpen: new Set(),
  metricsHistory: new Map(),
  unhealthyStreaks: new Map(),
  healthRestartInProgress: new Set(),
  systemUid: String((process as any).getuid?.() ?? 1000),
  systemGid: String((process as any).getgid?.() ?? 1000),
  systemTz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
};

let windowBounds: WindowBounds = { x: 100, y: 80, width: 920, height: 640 };

// ── Core messaging ────────────────────────────────────────────────────────────

function broadcast(message: IpcMessage) {
  if (message.type === "app:status" || message.type === "apps:list") {
    updateTrayMenu();
  }
  if (message.type === "app:status") {
    void saveRegistry(state.apps);
  }
  if (message.type === "error") {
    recordError("ui:error", message.message);
  }
  if (message.type === "docker:log") {
    const logs = logHistory.get(message.id) ?? [];
    logs.push(message.line);
    if (logs.length > 1000) logs.shift();
    logHistory.set(message.id, logs);
  }
  if (message.type === "app:status" && state.notificationsEnabled) {
    const app = state.apps.find((a) => a.id === message.id);
    const name = app?.name ?? message.id;
    if (message.status === "error") {
      sendNativeNotification("Container Cove", `${name} entered an error state.`);
      broadcast({ type: "error", message: `App ${name} entered error state.` });
    } else if (message.status === "stopped" && app?.status !== "stopping") {
      sendNativeNotification("Container Cove", `${name} stopped unexpectedly.`);
    }
  }
  sendToLauncher(message);
  for (const win of appWindows.values()) safeSend(win.webview, message);
}

function sendToLauncher(message: IpcMessage) {
  if (!launcherWindow) return;
  safeSend(launcherWindow.webview, message);
}

function requestTrayBulkAction(action: "stop-all" | "restart-all") {
  openLauncher();
  if (!launcherReady) {
    pendingTrayBulkAction = action;
    return;
  }
  sendToLauncher({ type: "tray:bulk-action-request", action });
}

function flushPendingTrayBulkAction() {
  if (!launcherReady || !pendingTrayBulkAction) return;
  const action = pendingTrayBulkAction;
  pendingTrayBulkAction = null;
  sendToLauncher({ type: "tray:bulk-action-request", action });
}

function safeSend(webview: unknown, message: IpcMessage) {
  const rpc = (webview as any)?.rpc;
  if (rpc?.send) {
    try { rpc.send["ipc-message"](message); return; } catch {}
  }
  const sender = (webview as { send?: (n: string, p: IpcMessage) => void })?.send;
  if (typeof sender === "function") sender("ipc-message", message);
}

function recordError(source: string, text: string, appId?: string) {
  if (!state.errorLoggingEnabled) return;
  appendErrorEntry({
    timestamp: Date.now(),
    level: "error",
    source,
    message: text,
    appId,
  }).catch(() => undefined);
}

function broadcastOgImages() {
  const refs = [...new Set(state.apps.map((a) => a.image))];
  const cached: Record<string, string> = {};
  const uncached: string[] = [];
  for (const ref of refs) {
    const url = ogCache.get(ref);
    if (url) cached[ref] = url;
    else uncached.push(ref);
  }
  if (Object.keys(cached).length > 0) {
    sendToLauncher({ type: "dockerhub:og-images", results: cached });
  }
  if (uncached.length > 0) {
    fetchAllOgImages(uncached)
      .then((results) => {
        for (const [img, url] of Object.entries(results)) ogCache.set(img, url);
        if (Object.keys(results).length > 0) {
          sendToLauncher({ type: "dockerhub:og-images", results });
        }
      })
      .catch(() => {});
  }
}

function broadcastSettingsState() {
  sendToLauncher({
    type: "settings:state",
    autoRestartOnUnhealthy: state.autoRestartOnUnhealthy,
    errorLoggingEnabled: state.errorLoggingEnabled,
    openAtLogin: state.openAtLogin,
    autoCheckUpdates: state.autoCheckUpdates,
    theme: state.theme,
    secretsMaskingEnabled: state.secretsMaskingEnabled,
    keychainSecretsEnabled: state.keychainSecretsEnabled,
    showOnboarding: state.showOnboarding,
    dataDir: state.dataDir,
    systemUid: state.systemUid,
    systemGid: state.systemGid,
    systemTz: state.systemTz,
  });
}

// ── Handler context (shared by all IPC handler modules) ───────────────────────

const ctx: HandlerContext = {
  state,
  broadcast,
  recordError,
  broadcastOgImages,
  broadcastSettingsState,
  openAppWindow,
  restartAppForHealth,
};

// ── IPC router ────────────────────────────────────────────────────────────────

async function handleIpc(message: IpcMessage) {
  if (message.type === "docker:retry") {
    void ensureDockerRunning();
    return;
  }
  if (message.type === "docker:start-if-needed") {
    if (!dockerAvailable) void ensureDockerRunning();
    return;
  }
  if (message.type === "podman:install") {
    Utils.openExternal(getPodmanInstallUrl());
    return;
  }
  if (await handleApps(message, ctx)) return;
  if (await handleSettings(message, ctx)) return;
  if (await handleUpdater(message, ctx)) return;
  if (await handleRegistry(message, ctx)) return;
}

// ── Setup wizard window ────────────────────────────────────────────────────────

async function runSetupFlow(
  onProgress: (percent: number, step: string) => void,
): Promise<{ success: boolean; error?: string; recoveryOptions?: any[] }> {
  const setupState = new SetupState();
  return await setupPodman(setupState, onProgress);
}

function createSetupWindow(): Promise<void> {
  return new Promise((resolve) => {
    // FIX 4: Set setupStarted flag BEFORE creating window to prevent race condition
    setupStarted = true;

    setupWindow = new BrowserWindow({
      width: 600,
      height: 800,
      minWidth: 500,
      minHeight: 600,
      webPreferences: {
        sandbox: false,
      },
      show: false,
      url: "views://setup-wizard/index.html",
    } as any);

    // FIX 9: Add logging when setup window created
    console.log("[container-cove] Setup wizard window created.");

    const rpc = (setupWindow as any).rpc;

    // FIX 1: Use once() for setup:start to auto-unsubscribe
    rpc.once("setup:start", async () => {
      try {
        const result = await runSetupFlow((percent, step) => {
          // Send progress to setup wizard
          if (setupWindow) {
            safeSend(setupWindow.webview, {
              type: "setup:progress",
              percentComplete: percent,
              currentStep: step,
            });
          }
        });

        // FIX 7: Add type guard before casting
        if (!result.success && result.error) {
          // Type narrowing for error case
          if (setupWindow) {
            safeSend(setupWindow.webview, {
              type: "setup:error",
              message: result.error,
              recoveryOptions: (result as any).recoveryOptions || [],
            });
          }
        } else if (result.success) {
          // Send completion signal
          if (setupWindow) {
            safeSend(setupWindow.webview, { type: "setup:complete" });
          }
          dockerAvailable = true;
        }
      } catch (err) {
        recordError("setup:start", String(err));
        if (setupWindow) {
          safeSend(setupWindow.webview, {
            type: "setup:error",
            message: String(err),
            recoveryOptions: [],
          });
        }
      }
    });

    // FIX 1: Use once() for setup:cancel and FIX 2: Call resolve() before app.quit()
    rpc.once("setup:cancel", () => {
      try {
        setupWindow?.hide();
        setupWindow = null;
        resolve(); // FIX 2: Resolve promise before quitting
      } finally {
        app.quit();
      }
    });

    // FIX 1: Use once() for setup:retry and FIX 6: Extracted to runSetupFlow()
    rpc.once("setup:retry", async () => {
      try {
        const result = await runSetupFlow((percent, step) => {
          // Send progress to setup wizard
          if (setupWindow) {
            safeSend(setupWindow.webview, {
              type: "setup:progress",
              percentComplete: percent,
              currentStep: step,
            });
          }
        });

        // FIX 7: Add type guard before casting
        if (!result.success && result.error) {
          // Type narrowing for error case
          if (setupWindow) {
            safeSend(setupWindow.webview, {
              type: "setup:error",
              message: result.error,
              recoveryOptions: (result as any).recoveryOptions || [],
            });
          }
        } else if (result.success) {
          // Send completion signal
          if (setupWindow) {
            safeSend(setupWindow.webview, { type: "setup:complete" });
          }
          dockerAvailable = true;
        }
      } catch (err) {
        recordError("setup:retry", String(err));
        if (setupWindow) {
          safeSend(setupWindow.webview, {
            type: "setup:error",
            message: String(err),
            recoveryOptions: [],
          });
        }
      }
    });

    // FIX 1: Use once() for setup:finished to auto-unsubscribe
    // NOTE: Do NOT set launcherReady here - let launcher's dom-ready handler set it (FIX 8)
    rpc.once("setup:finished", () => {
      setupWindow?.hide();
      setupWindow = null;
      resolve();
    });

    setupWindow.on("closed", () => {
      setupWindow = null;
      resolve();
    });

    // FIX 3: Consolidate dom-ready handlers into one listener
    setupWindow.webview.once("dom-ready", () => {
      setupWindow!.show();
      // FIX 5: Validate rpc.send exists before calling
      const rpcSend = (setupWindow as any)?.rpc?.send;
      if (rpcSend && typeof rpcSend["ipc-message"] === "function") {
        rpcSend["ipc-message"]({ type: "setup:ready" });
      }
    });
  });
}

// ── Window management ─────────────────────────────────────────────────────────

function openLauncher() {
  if (launcherWindow) { launcherWindow.show(); return; }
  launcherReady = false;
  launcherWindow = new BrowserWindow({
    title: "Container Cove",
    url: "views://launcher/index.html",
    frame: windowBounds,
  } as any);

  let saveBoundsDebounce: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = (bounds: WindowBounds) => {
    windowBounds = bounds;
    if (saveBoundsDebounce) clearTimeout(saveBoundsDebounce);
    saveBoundsDebounce = setTimeout(() => void saveSettings({ windowBounds: bounds }), 500);
  };
  launcherWindow.on("resize", (e: any) => {
    const { x, y, width, height } = e as WindowBounds;
    persistBounds({ x, y, width, height });
  });
  launcherWindow.on("move", (e: any) => {
    const { x, y, width, height } = e as WindowBounds;
    persistBounds({ x, y, width, height });
  });

  // FIX 8: Set launcherReady flag in launcher's dom-ready, not in setup handler
  launcherWindow.webview.once("dom-ready", () => {
    sendToLauncher({ type: "apps:list", apps: state.apps });
    sendToLauncher({
      type: "docker:availability",
      available: dockerAvailable,
      message: dockerAvailable
        ? undefined
        : getPodmanStateHint(isFirstRun ? "first-run" : "unavailable").message,
      detail: dockerAvailable
        ? undefined
        : getPodmanStateHint(isFirstRun ? "first-run" : "unavailable").detail,
      canRetry: !dockerAvailable,
      canInstall: !dockerAvailable,
    });
    sendToLauncher({
      type: "onboarding:state",
      firstRun: isFirstRun,
      showOnboarding: state.showOnboarding,
      dataDir: state.dataDir,
      systemUid: state.systemUid,
      systemGid: state.systemGid,
      systemTz: state.systemTz,
    });
    sendToLauncher({ type: "update:state", channel: state.releaseChannel });
    if (state.pendingUpdate) {
      sendToLauncher({
        type: "update:available",
        version: state.pendingUpdate.version,
        releaseNotes: state.pendingUpdate.releaseNotes,
        downloadUrl: state.pendingUpdate.downloadUrl,
        channel: state.pendingUpdate.channel,
      });
    }
    broadcastSettingsState();
    broadcastOgImages();
    void handleIpc({ type: "networks:list" } as IpcMessage);
    // FIX 8: Set launcherReady AFTER all initial state is sent
    launcherReady = true;
    flushPendingTrayBulkAction();
  });
  (launcherWindow.webview as any).rpc.addMessageListener(
    "ipc-message",
    async (message: IpcMessage) => await handleIpc(message),
  );
  launcherWindow.on("close", () => {
    launcherWindow = null;
    launcherReady = false;
    pendingTrayBulkAction = null;
  });

  if (!dockerAvailable) void ensureDockerRunning();
}

function openAppWindow(app: DockerApp) {
  if (appWindows.has(app.id)) { appWindows.get(app.id)!.show(); return; }
  const win = new BrowserWindow({
    title: app.name,
    url: "views://app-window/index.html",
    frame: { x: 140, y: 120, width: 820, height: 580 },
  } as any);
  win.webview.on("dom-ready", () => {
    safeSend(win.webview, { type: "app:open-window", app });
    safeSend(win.webview, {
      type: "docker:logs:history",
      id: app.id,
      lines: logHistory.get(app.id) ?? [],
    });
    safeSend(win.webview, { type: "secrets:mask", enabled: state.secretsMaskingEnabled });
    safeSend(win.webview, {
      type: "metrics:history",
      id: app.id,
      points: state.metricsHistory.get(app.id) ?? [],
    });
  });
  (win.webview as any).rpc.addMessageListener(
    "ipc-message",
    async (message: IpcMessage) => await handleIpc(message),
  );
  win.on("close", () => appWindows.delete(app.id));
  appWindows.set(app.id, win);
}

// ── Health-restart (needs broadcast + launch/stop + state) ────────────────────

async function restartAppForHealth(app: DockerApp) {
  if (state.healthRestartInProgress.has(app.id)) return;
  state.healthRestartInProgress.add(app.id);
  state.unhealthyStreaks.set(app.id, 0);
  try {
    broadcast({ type: "app:health-restart", id: app.id, name: app.name });
    recordError(
      "health:restart",
      `Restarting ${app.name} after repeated unhealthy health checks`,
      app.id,
    );
    sendNativeNotification("Container Cove", `${app.name} was unhealthy — restarting container`);
    await stopApp(app, (id, status) => {
      const t = state.apps.find((a) => a.id === id);
      if (t) t.status = status;
      broadcast({ type: "app:status", id, status });
    });
    const fresh = state.apps.find((a) => a.id === app.id);
    if (!fresh) return;
    const resolvedEnv = state.keychainSecretsEnabled
      ? await resolveKeychainEnv(fresh.id, fresh.env, fresh.keychainEnvKeys)
      : undefined;
    await launchApp(
      fresh,
      (id, status, containerId) => {
        const t = state.apps.find((a) => a.id === id);
        if (t) { t.status = status; t.containerId = containerId; }
        broadcast({ type: "app:status", id, status, containerId });
      },
      (id, line) => broadcast({ type: "docker:log", id, line }),
      (id, sts, detail) => broadcast({ type: "app:pull-progress", id, status: sts, detail }),
      resolvedEnv,
    );
  } catch (err) {
    recordError("health:restart", String(err), app.id);
    broadcast({ type: "error", message: `Health restart failed for ${app.name}: ${String(err)}` });
  } finally {
    state.healthRestartInProgress.delete(app.id);
  }
}

// ── First-run setup check ──────────────────────────────────────────────────────

async function checkAndRunSetup(): Promise<boolean> {
  const runtimeAvailable = await isDockerAvailable();

  if (!runtimeAvailable && !setupStarted) {
    console.log("[container-cove] Podman/Docker not available — launching setup wizard…");
    await createSetupWindow();
    // After setup completes or is cancelled, check again
    return await isDockerAvailable();
  }

  return runtimeAvailable;
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main() {
  isFirstRun = !(await registryExists());
  state.apps = await loadRegistry();
  startupRestoreIds = new Set(
    state.apps.filter((app) => app.status === "running").map((app) => app.id),
  );
  for (const app of state.apps) {
    app.status = "stopped";
    app.containerId = undefined;
  }

  const persistedMetrics = await loadMetricsHistory();
  for (const [id, points] of Object.entries(persistedMetrics)) {
    state.metricsHistory.set(id, points);
  }

  const settings = await loadSettings();
  state.releaseChannel = settings.releaseChannel;
  state.notificationsEnabled = settings.notificationsEnabled;
  state.secretsMaskingEnabled = settings.secretsMaskingEnabled;
  state.keychainSecretsEnabled = settings.keychainSecretsEnabled;
  state.autoRestartOnUnhealthy = settings.autoRestartOnUnhealthy;
  state.errorLoggingEnabled = settings.errorLoggingEnabled;
  state.openAtLogin = settings.openAtLogin ?? false;
  state.autoCheckUpdates = settings.autoCheckUpdates ?? true;
  state.theme = settings.theme ?? "dark";
  state.showOnboarding = settings.showOnboarding ?? true;
  state.dataDir = settings.dataDir ?? "~/.container-cove";
  if (settings.windowBounds) windowBounds = settings.windowBounds;

  dockerAvailable = await isDockerAvailable();

  setupProcessErrorHandlers();
  startLaunchServer();
  setupTray();
  setupMenu();

  // Run setup wizard if Podman/Docker is not available on first run
  const runtimeReady = await checkAndRunSetup();

  if (!runtimeReady && !setupStarted) {
    console.error("[container-cove] Podman/Docker not available after setup attempt. Exiting.");
    process.exit(1);
  }

  openLauncher();
  startRuntimeTelemetry();
  startSystemMetricsPolling();
  startImageUpdatePolling();
  startLocalDomainProxy();
  scheduleStartupUpdateCheck();

  if (dockerAvailable) {
    void autoLaunchAllApps();
  }
}

async function autoLaunchAllApps() {
  const appsToRestore = state.apps.filter((app) => startupRestoreIds.has(app.id));
  if (appsToRestore.length === 0) return;
  console.log(`[container-cove] Restoring ${appsToRestore.length} running app(s)…`);
  await Promise.allSettled(
    appsToRestore.map((app) => handleIpc({ type: "app:launch", id: app.id })),
  );
  startupRestoreIds.clear();
}

async function ensureDockerRunning() {
  if (dockerStartPromise) return dockerStartPromise;
  dockerStartPromise = (async () => {
  sendToLauncher({
    type: "docker:availability",
    available: false,
    message: "Starting Podman — please wait…",
    canRetry: false,
    canInstall: false,
  });
    const ready = await startDockerDaemon();
    if (ready) {
      dockerAvailable = true;
      sendToLauncher({ type: "docker:availability", available: true, canRetry: false });
      console.log("[container-cove] Podman is ready.");
      void autoLaunchAllApps();
    } else {
      console.error("[container-cove] Podman did not become ready within the timeout.");
      sendToLauncher({
        type: "docker:availability",
        available: false,
        ...getPodmanStateHint("unavailable"),
        canRetry: true,
        canInstall: true,
      });
    }
  })().finally(() => {
    dockerStartPromise = null;
  });
  return dockerStartPromise;
}

async function scheduleStartupUpdateCheck() {
  if (!state.autoCheckUpdates) return;
  const settings = await loadSettings();
  const sinceLastCheck = Date.now() - (settings.lastUpdateCheckAt ?? 0);
  if (sinceLastCheck < UPDATE_CHECK_INTERVAL_MS) return;
  setTimeout(() => {
    checkForUpdate(CURRENT_VERSION, state.releaseChannel, async (result) => {
      if (result.type === "available") {
        state.pendingUpdate = result.info;
        broadcast({
          type: "update:available",
          version: result.info.version,
          releaseNotes: result.info.releaseNotes,
          downloadUrl: result.info.downloadUrl,
          channel: result.info.channel,
        });
      }
      await saveSettings({ lastUpdateCheckAt: Date.now() });
    });
  }, 3000);
}

function setupProcessErrorHandlers() {
  process.on("uncaughtException", (err) => recordError("process:uncaughtException", String(err)));
  process.on("unhandledRejection", (reason) => recordError("process:unhandledRejection", String(reason)));
}

// ── Polling loops ─────────────────────────────────────────────────────────────

function startRuntimeTelemetry() {
  let telemetryInFlight = false;
  setInterval(async () => {
    if (telemetryInFlight) return;
    telemetryInFlight = true;
    try {
      const running = state.apps.filter((a) => a.status === "running");
      if (running.length === 0) return;
      const [healthMap, metricsMap] = await Promise.all([
        getContainerHealthBatch(running),
        getContainerMetricsBatch(running),
      ]);
      for (const app of running) {
        const health = healthMap.get(app.id) ?? "unknown";
        const target = state.apps.find((a) => a.id === app.id);
        if (target) target.health = health;
        broadcast({ type: "app:health", id: app.id, health });

        const prevStreak = state.unhealthyStreaks.get(app.id) ?? 0;
        const streak = nextUnhealthyStreak(health, prevStreak);
        state.unhealthyStreaks.set(app.id, streak);
        if (shouldRestartUnhealthy(app, health, streak, state.autoRestartOnUnhealthy)) {
          void restartAppForHealth(app);
        }

        const metrics = metricsMap.get(app.id);
        if (metrics) {
          const point = {
            id: app.id,
            cpuPercent: metrics.cpuPercent,
            memUsageMB: metrics.memUsageMB,
            timestamp: Date.now(),
          };
          const list = state.metricsHistory.get(app.id) ?? [];
          list.push(point);
          const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const trimmed = list.filter((p) => p.timestamp >= cutoff).slice(-5000);
          state.metricsHistory.set(app.id, trimmed);
          saveMetricsHistory(Object.fromEntries(state.metricsHistory)).catch(() => undefined);
          broadcast({ type: "app:metrics", point });
        }
      }
    } finally {
      telemetryInFlight = false;
    }
  }, 5000);
}

async function checkAllImageUpdates() {
  const PARALLEL = 3;
  for (let i = 0; i < state.apps.length; i += PARALLEL) {
    await Promise.all(
      state.apps.slice(i, i + PARALLEL).map(async (app) => {
        const available = await checkImageUpdateAvailable(app);
        broadcast({ type: "app:image-update", id: app.id, available });
      }),
    );
  }
}

function startImageUpdatePolling() {
  setTimeout(() => void checkAllImageUpdates(), 30_000);
  setInterval(() => void checkAllImageUpdates(), 6 * 60 * 60 * 1000);
}

async function collectSystemMetrics(): Promise<{ cpuPercent: number; gpuPercent: number | null }> {
  const cpuCount = cpus().length || 1;
  const cpuPercent = Math.min(100, Math.round((loadavg()[0] / cpuCount) * 100));
  let gpuPercent: number | null = null;
  if (process.platform === "darwin") {
    try {
      const result = Bun.spawnSync(
        ["ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"],
        { stdout: "pipe", stderr: "pipe" },
      );
      const out = result.stdout.toString();
      const m =
        out.match(/"Device Utilization %"\s*=\s*(\d+)/) ??
        out.match(/"Renderer Utilization"\s*=\s*(\d+)/);
      if (m) gpuPercent = Number(m[1]);
    } catch {}
  }
  return { cpuPercent, gpuPercent };
}

function startSystemMetricsPolling() {
  const poll = async () => {
    const metrics = await collectSystemMetrics();
    broadcast({ type: "system:metrics", ...metrics });
  };
  void poll();
  setInterval(() => void poll(), 4000);
}

// ── Local domain proxy ────────────────────────────────────────────────────────

function startLocalDomainProxy() {
  try {
    Bun.serve({
      port: LOCAL_PROXY_PORT,
      async fetch(req) {
        const hostHeader = req.headers.get("host") ?? "";
        const subdomain = hostHeader.split(":")[0].replace(/\.localhost$/i, "");
        const app = state.apps.find((a) => a.localDomain === subdomain);
        if (!app) {
          return new Response(
            `<html><body><h2>404 — no app with local domain <code>${subdomain}.localhost</code></h2></body></html>`,
            { status: 404, headers: { "content-type": "text/html" } },
          );
        }
        const hostPort = app.ports[0]?.split(":")[0];
        if (!hostPort) return new Response("App has no host port", { status: 502 });
        const url = new URL(req.url);
        const targetUrl = `http://localhost:${hostPort}${url.pathname}${url.search}`;
        try {
          const proxyHeaders = new Headers(req.headers);
          proxyHeaders.set("host", `localhost:${hostPort}`);
          const upstream = await fetch(targetUrl, {
            method: req.method,
            headers: proxyHeaders,
            body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
            redirect: "manual",
          });
          return new Response(upstream.body, {
            status: upstream.status,
            headers: upstream.headers,
          });
        } catch {
          return new Response("Gateway error — is the app running?", { status: 502 });
        }
      },
    });
    console.log(`[container-cove] Local domain proxy on port ${LOCAL_PROXY_PORT}`);
  } catch (err) {
    console.error("[container-cove] Could not start local domain proxy:", err);
  }
}

// ── Desktop shortcut launch server ────────────────────────────────────────────

function startLaunchServer() {
  try {
    Bun.serve({
      port: LAUNCH_SERVER_PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/launch") {
          const id = url.searchParams.get("id");
          if (id) {
            const app = state.apps.find((a) => a.id === id);
            if (app) {
              if (app.status === "running") {
                if (app.openUrl) {
                  openWebUiWindow(app);
                } else {
                  openLauncher();
                  openAppWindow(app);
                }
              } else {
                if (app.openUrl) state.pendingWebUiOpen.add(id);
                void handleIpc({ type: "app:launch", id });
                openLauncher();
              }
            }
          }
          return new Response("ok");
        }
        return new Response("not found", { status: 404 });
      },
    });
  } catch {
    // Already running — another instance is open
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────

function sendNativeNotification(title: string, body: string) {
  try {
    if (process.platform === "darwin") {
      Bun.spawn(["osascript", "-e",
        `display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`]);
  } else if (process.platform === "linux") {
      Bun.spawn(["notify-send", title, body]);
    } else if (process.platform === "win32") {
      Bun.spawn([
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        WINDOWS_TOAST_SCRIPT_PATH,
        Buffer.from(title, "utf8").toString("base64"),
        Buffer.from(body, "utf8").toString("base64"),
      ]);
    }
  } catch {}
}

// ── Tray ──────────────────────────────────────────────────────────────────────

let trayInstance: InstanceType<typeof Tray> | null = null;

function setupTray() {
  trayInstance = new Tray({ image: TRAY_ICON_PATH, template: true, width: 16, height: 16 });
  trayInstance.on("tray-clicked", handleTrayAction);
  updateTrayMenu();
}

function trayDot(status: DockerApp["status"]): string {
  if (status === "running") return "🟢 ";
  if (status === "starting" || status === "stopping") return "🟡 ";
  if (status === "error") return "🔴 ";
  return "⚫ ";
}

function updateTrayMenu() {
  if (!trayInstance) return;
  const appItems: any[] = state.apps.length === 0
    ? [{ type: "normal", label: "No apps installed", enabled: false }]
    : state.apps.map((app) => {
        const busy = app.status === "starting" || app.status === "stopping";
        const statusText = app.status === "stopped"
          ? "Offline"
          : app.status.charAt(0).toUpperCase() + app.status.slice(1);
        return {
          type: "normal",
          label: `${trayDot(app.status)}${app.name}`,
          tooltip: statusText,
          action: "tray-app-click",
          data: { id: app.id },
          enabled: !busy,
        };
      });
  const hasRunning = state.apps.some((a) => a.status === "running");
  trayInstance.setMenu([
    { type: "normal", label: "Open Dashboard", action: "open-launcher" },
    { type: "separator" },
    ...appItems,
    { type: "separator" },
    { type: "normal", label: "Stop All", action: "tray-stop-all", enabled: hasRunning },
    { type: "normal", label: "Restart All", action: "tray-restart-all", enabled: hasRunning },
    { type: "separator" },
    { type: "normal", label: "Settings", action: "open-launcher" },
    { type: "separator" },
    { type: "normal", label: "Quit", action: "quit-app" },
  ]);
}

function handleTrayAction(event: unknown) {
  const ev = event as { action?: string; data?: { id?: string } } | undefined;
  const action = ev?.action;
  const id = ev?.data?.id;
  if (action === "open-launcher") { openLauncher(); return; }
  if (action === "quit-app") { process.exit(0); }
  if (action === "tray-app-click" && id) {
    const app = state.apps.find((a) => a.id === id);
    if (!app) return;
    if (app.status === "running") { openLauncher(); openAppWindow(app); }
    else void handleIpc({ type: "app:launch", id });
  }
  if (action === "tray-stop-all") {
    requestTrayBulkAction("stop-all");
  }
  if (action === "tray-restart-all") {
    requestTrayBulkAction("restart-all");
  }
}

// ── Application menu ──────────────────────────────────────────────────────────

function setupMenu() {
  ApplicationMenu.setApplicationMenu([
    {
      label: "Container Cove",
      submenu: [
        { label: "About Container Cove", role: "about" },
        { type: "separator" },
        { label: "Quit", role: "quit-app" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { label: "Launcher", action: "open-launcher" },
        { label: "Minimize", role: "minimize" },
      ],
    },
  ]);
  ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
    const action = (event as { action?: string } | undefined)?.action;
    if (action === "open-launcher") openLauncher();
  });
}

main().catch(console.error);

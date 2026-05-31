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
  "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";

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
    setupWindow.webview.on("dom-ready", () => {
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
  launcherWindow.webview.on("dom-ready", () => {
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
  trayInstance = new Tray({ image: TRAY_ICON_PATH, template: false, width: 16, height: 16 });
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

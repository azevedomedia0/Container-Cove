import { BrowserWindow, Tray, ApplicationMenu, Utils } from "electrobun/bun";
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

// ── Tray icon ─────────────────────────────────────────────────────────────────
const TRAY_ICON_B64 =
  "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" +
  "e2fJf9c1nP4HWCA+QSNCyegAAAAASUVORK5CYII=";

const TRAY_ICON_PATH = join(tmpdir(), "loading-dock-tray.png");
writeFileSync(TRAY_ICON_PATH, Buffer.from(TRAY_ICON_B64, "base64"));
const WINDOWS_TOAST_SCRIPT_PATH = join(tmpdir(), "loading-dock-toast.ps1");
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
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('The Loading Dock(r)')
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
let launcherReady = false;
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
  dataDir: "~/.loading-dock",
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
      sendNativeNotification("The Loading Dock(r)", `${name} entered an error state.`);
      broadcast({ type: "error", message: `App ${name} entered error state.` });
    } else if (message.status === "stopped" && app?.status !== "stopping") {
      sendNativeNotification("The Loading Dock(r)", `${name} stopped unexpectedly.`);
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

// ── Window management ─────────────────────────────────────────────────────────

function openLauncher() {
  if (launcherWindow) { launcherWindow.show(); return; }
  launcherReady = false;
  launcherWindow = new BrowserWindow({
    title: "The Loading Dock(r)",
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

  launcherWindow.webview.on("dom-ready", () => {
    launcherReady = true;
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
    sendNativeNotification("The Loading Dock(r)", `${app.name} was unhealthy — restarting container`);
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
  state.dataDir = settings.dataDir ?? "~/.loading-dock";
  if (settings.windowBounds) windowBounds = settings.windowBounds;

  dockerAvailable = await isDockerAvailable();

  setupProcessErrorHandlers();
  startLaunchServer();
  setupTray();
  setupMenu();
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
  console.log(`[loading-dock] Restoring ${appsToRestore.length} running app(s)…`);
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
      console.log("[loading-dock] Podman is ready.");
      void autoLaunchAllApps();
    } else {
      console.error("[loading-dock] Podman did not become ready within the timeout.");
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
    console.log(`[loading-dock] Local domain proxy on port ${LOCAL_PROXY_PORT}`);
  } catch (err) {
    console.error("[loading-dock] Could not start local domain proxy:", err);
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
      label: "The Loading Dock(r)",
      submenu: [
        { label: "About The Loading Dock(r)", role: "about" },
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

import { homedir } from "os";
import { join, dirname } from "path";
import {
  writeFileSync,
  mkdirSync,
  chmodSync,
  rmSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  existsSync,
} from "fs";
import type { DockerApp, IpcMessage } from "../../shared/types";
import {
  launchApp,
  stopApp,
  removeAppVolumes,
  removeAppImage,
  listDockerNetworks,
  createDockerNetwork,
} from "../docker";
import { normalizeName, validateOpenUrl, validateLocalDomain } from "../../shared/validation";
import { importComposeAsApps } from "../compose";
import { searchImages, getPopularImages } from "../dockerhub";
import { presetForImage } from "../../shared/presets";
import { saveRegistry } from "../registry";
import { keychainSet, keychainDelete, resolveKeychainEnv } from "../keychain";
import { openWebUiWindow, closeWebUiWindow } from "../webui";
import { Utils } from "electrobun/bun";
import { LAUNCH_SERVER_PORT } from "../constants";
import type { HandlerContext } from "./context";
import { tmpdir } from "os";

const DESKTOP_ICON_PLACEHOLDER_ICNS = join(tmpdir(), "container-cove-shortcut-placeholder.icns");
const DESKTOP_ICONSET_CANDIDATES = [
  join(process.cwd(), "assets/icons/App_Icon.iconset"),
  join(dirname(process.execPath), "..", "..", "assets/icons/App_Icon.iconset"),
];

let desktopIconPlaceholderPromise: Promise<string> | null = null;

export async function handleApps(
  message: IpcMessage,
  ctx: HandlerContext,
): Promise<boolean> {
  const { state, broadcast, recordError, broadcastOgImages, openAppWindow } = ctx;

  function validateNetworkedApp(input: Omit<DockerApp, "status" | "containerId">, sourceId?: string) {
    const localDomain = validateLocalDomain(input.localDomain ?? "");
    if (localDomain) {
      if (!input.ports?.length) {
        throw new Error("Local domain requires at least one published port.");
      }
      const duplicate = state.apps.some(
        (a) => a.id !== sourceId && a.localDomain === localDomain,
      );
      if (duplicate) {
        throw new Error("Another app is already using this local domain.");
      }
    }
    return { ...input, localDomain };
  }

  switch (message.type) {
    case "app:launch": {
      const app = state.apps.find((a) => a.id === message.id);
      if (!app) return true;
      try {
        const resolvedEnv = state.keychainSecretsEnabled
          ? await resolveKeychainEnv(app.id, app.env, app.keychainEnvKeys)
          : undefined;
        await launchApp(
          app,
          (id, status, containerId) => {
            const t = state.apps.find((a) => a.id === id);
            if (t) { t.status = status; t.containerId = containerId; }
            broadcast({ type: "app:status", id, status, containerId });
            if (status === "running" && state.pendingWebUiOpen.has(id)) {
              state.pendingWebUiOpen.delete(id);
              const target = state.apps.find((a) => a.id === id);
              if (target?.openUrl) openWebUiWindow(target);
            }
            if (status === "error" || status === "stopped") {
              state.pendingWebUiOpen.delete(id);
            }
          },
          (id, line) => broadcast({ type: "docker:log", id, line }),
          (id, status, detail) =>
            broadcast({ type: "app:pull-progress", id, status, detail }),
          resolvedEnv,
        );
      } catch (err) {
        const text = "Failed to launch app: " + String(err);
        recordError("app:launch", text, message.id);
        broadcast({ type: "error", message: text });
      }
      return true;
    }

    case "app:stop": {
      const app = state.apps.find((a) => a.id === message.id);
      if (!app) return true;
      try {
        await stopApp(app, (id, status) => {
          const t = state.apps.find((a) => a.id === id);
          if (t) t.status = status;
          broadcast({ type: "app:status", id, status });
        });
        closeWebUiWindow(app.id);
      } catch (err) {
        const text = "Failed to stop app: " + String(err);
        recordError("app:stop", text, message.id);
        broadcast({ type: "error", message: text });
      }
      return true;
    }

    case "app:restart": {
      const app = state.apps.find((a) => a.id === message.id);
      if (!app) return true;
      try {
        const statusCb = (id: string, status: DockerApp["status"], containerId?: string) => {
          const t = state.apps.find((a) => a.id === id);
          if (t) { t.status = status; t.containerId = containerId; }
          broadcast({ type: "app:status", id, status, containerId });
        };
        await stopApp(app, statusCb);
        const resolvedEnv = state.keychainSecretsEnabled
          ? await resolveKeychainEnv(app.id, app.env, app.keychainEnvKeys)
          : undefined;
        await launchApp(
          app,
          statusCb,
          (id, line) => broadcast({ type: "docker:log", id, line }),
          (id, status, detail) =>
            broadcast({ type: "app:pull-progress", id, status, detail }),
          resolvedEnv,
        );
      } catch (err) {
        const text = "Failed to restart app: " + String(err);
        recordError("app:restart", text, message.id);
        broadcast({ type: "error", message: text });
      }
      return true;
    }

    case "app:open-window": {
      const app = state.apps.find((a) => a.id === message.app.id);
      if (app) openAppWindow(app);
      return true;
    }

    case "app:open-webui": {
      const app = state.apps.find((a) => a.id === message.id);
      if (!app) return true;
      const err = openWebUiWindow(app);
      if (err) broadcast({ type: "error", message: err });
      return true;
    }

    case "app:open-external": {
      const app = state.apps.find((a) => a.id === message.id);
      if (!app?.openUrl) return true;
      const url = validateOpenUrl(app.openUrl);
      if (!url) {
        broadcast({ type: "error", message: "Invalid Web UI URL." });
        return true;
      }
      Utils.openExternal(url);
      return true;
    }

    case "app:add": {
      if (
        state.apps.some(
          (a) =>
            a.id === message.app.id ||
            normalizeName(a.name) === normalizeName(message.app.name),
        )
      ) {
        broadcast({ type: "error", message: "An app with this name already exists." });
        return true;
      }
      let newApp: DockerApp;
      try {
        newApp = { ...validateNetworkedApp(message.app), status: "stopped" };
      } catch (err) {
        broadcast({ type: "error", message: String(err) });
        return true;
      }
      const preset = presetForImage(newApp.image);
      if (preset) {
        newApp.restartPolicy ??= preset.restartPolicy;
        newApp.healthcheck ??= preset.healthcheck;
      }
      state.apps.push(newApp);
      await saveRegistry(state.apps);
      broadcast({ type: "apps:list", apps: state.apps });
      broadcastOgImages();
      void createDesktopIcon(newApp, ctx.broadcast);
      return true;
    }

    case "app:update": {
      const idx = state.apps.findIndex((a) => a.id === message.app.id);
      if (idx < 0) {
        broadcast({ type: "error", message: "App not found for update." });
        return true;
      }
      const duplicate = state.apps.some(
        (a, i) => i !== idx && normalizeName(a.name) === normalizeName(message.app.name),
      );
      if (duplicate) {
        broadcast({ type: "error", message: "Another app with this name already exists." });
        return true;
      }
      const oldApp = state.apps[idx];
      try {
        state.apps[idx] = {
          ...validateNetworkedApp(message.app, message.app.id),
          status: state.apps[idx].status,
        };
      } catch (err) {
        broadcast({ type: "error", message: String(err) });
        return true;
      }
      await saveRegistry(state.apps);
      broadcast({ type: "apps:list", apps: state.apps });
      broadcastOgImages();
      if (oldApp.name !== message.app.name) {
        removeDesktopIcon(oldApp);
        void createDesktopIcon(state.apps[idx], ctx.broadcast);
      }
      return true;
    }

    case "app:remove": {
      const removed = state.apps.find((a) => a.id === message.id);
      state.apps = state.apps.filter((a) => a.id !== message.id);
      await saveRegistry(state.apps);
      broadcast({ type: "apps:list", apps: state.apps });
      if (removed) {
        removeDesktopIcon(removed);
        if (message.cleanVolumes) void removeAppVolumes(removed);
        if (message.cleanImage) void removeAppImage(removed);
      }
      return true;
    }

    case "compose:import": {
      try {
        const imported = importComposeAsApps(message.yaml, message.projectName);
        const existingNames = new Set(state.apps.map((a) => normalizeName(a.name)));
        const unique = imported.filter((a) => !existingNames.has(normalizeName(a.name)));
        if (!unique.length) {
          broadcast({
            type: "error",
            message: "No new services to import (names already exist).",
          });
          return true;
        }
        state.apps.push(...unique.map((a) => ({ ...a, status: "stopped" as const })));
        await saveRegistry(state.apps);
        broadcast({ type: "apps:list", apps: state.apps });
      } catch (err) {
        broadcast({ type: "error", message: "Compose import failed: " + String(err) });
      }
      return true;
    }

    case "dockerhub:browse": {
      try {
        const images = message.query?.trim()
          ? await searchImages(message.query)
          : await getPopularImages();
        broadcast({ type: "dockerhub:results", query: message.query, images });
      } catch (err) {
        broadcast({ type: "error", message: "Docker Hub fetch failed: " + String(err) });
      }
      return true;
    }

    case "keychain:set": {
      try {
        await keychainSet(message.appId, message.envKey, message.value);
        const app = state.apps.find((a) => a.id === message.appId);
        if (app) {
          app.keychainEnvKeys = Array.from(
            new Set([...(app.keychainEnvKeys ?? []), message.envKey]),
          );
          await saveRegistry(state.apps);
        }
        broadcast({
          type: "keychain:set:done",
          appId: message.appId,
          envKey: message.envKey,
        });
      } catch (err) {
        broadcast({
          type: "keychain:error",
          message: "Keychain write failed: " + String(err),
        });
      }
      return true;
    }

    case "keychain:delete": {
      try {
        await keychainDelete(message.appId, message.envKey);
        const app = state.apps.find((a) => a.id === message.appId);
        if (app) {
          app.keychainEnvKeys = (app.keychainEnvKeys ?? []).filter(
            (k) => k !== message.envKey,
          );
          await saveRegistry(state.apps);
        }
      } catch {
        // best-effort
      }
      return true;
    }

    case "networks:list": {
      const networks = await listDockerNetworks();
      broadcast({ type: "networks:listed", networks });
      return true;
    }

    case "network:create": {
      await createDockerNetwork(message.name);
      const networks = await listDockerNetworks();
      if (!networks.includes(message.name)) {
        broadcast({
          type: "error",
          message: `Could not create Docker network "${message.name}".`,
        });
        return true;
      }
      broadcast({ type: "networks:listed", networks });
      return true;
    }

    case "tray:bulk-action-confirm": {
      const runningApps = state.apps.filter((a) => a.status === "running");
      if (message.action === "stop-all") {
        for (const app of runningApps) {
          try {
            await stopApp(app, (id, status) => {
              const t = state.apps.find((a) => a.id === id);
              if (t) t.status = status;
              broadcast({ type: "app:status", id, status });
            });
            closeWebUiWindow(app.id);
          } catch (err) {
            recordError("tray:stop-all", String(err), app.id);
            broadcast({ type: "error", message: `Failed to stop ${app.name}: ${String(err)}` });
          }
        }
      } else if (message.action === "restart-all") {
        for (const app of runningApps) {
          try {
            const statusCb = (id: string, status: DockerApp["status"], containerId?: string) => {
              const t = state.apps.find((a) => a.id === id);
              if (t) { t.status = status; t.containerId = containerId; }
              broadcast({ type: "app:status", id, status, containerId });
            };
            await stopApp(app, statusCb);
            const resolvedEnv = state.keychainSecretsEnabled
              ? await resolveKeychainEnv(app.id, app.env, app.keychainEnvKeys)
              : undefined;
            await launchApp(
              app,
              statusCb,
              (id, line) => broadcast({ type: "docker:log", id, line }),
              (id, status, detail) =>
                broadcast({ type: "app:pull-progress", id, status, detail }),
              resolvedEnv,
            );
          } catch (err) {
            recordError("tray:restart-all", String(err), app.id);
            broadcast({ type: "error", message: `Failed to restart ${app.name}: ${String(err)}` });
          }
        }
      }
      return true;
    }

    case "dialog:pick-folder": {
      if (process.platform !== "darwin") return true;
      try {
        const result = Bun.spawnSync(
          ["osascript", "-e", 'POSIX path of (choose folder with prompt "Select folder")'],
          { stdout: "pipe", stderr: "pipe" },
        );
        const path = result.stdout.toString().trim();
        if (path) {
          broadcast({
            type: "dialog:folder-result",
            callbackId: message.callbackId,
            path,
          });
        } else {
          broadcast({ type: "dialog:folder-cancelled", callbackId: message.callbackId });
        }
      } catch {
        broadcast({ type: "dialog:folder-cancelled", callbackId: message.callbackId });
      }
      return true;
    }

    default:
      return false;
  }
}

// ── Desktop icon helpers ──────────────────────────────────────────────────────

function desktopIconPath(app: DockerApp): string {
  const safe = app.name.replace(/[/\\:*?"<>|]/g, "-");
  return join(homedir(), "Desktop", `${safe}.app`);
}

function iconSlugForApp(image: string): string {
  let slug = image.replace(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+(:\d+)?\//, "");
  slug = slug.split(":")[0].split("@")[0];
  slug = (slug.split("/").pop() ?? slug);
  return slug;
}

async function ensureDesktopIconPlaceholder(): Promise<string | null> {
  if (existsSync(DESKTOP_ICON_PLACEHOLDER_ICNS)) return DESKTOP_ICON_PLACEHOLDER_ICNS;
  if (!desktopIconPlaceholderPromise) {
    desktopIconPlaceholderPromise = (async () => {
      const iconset = DESKTOP_ICONSET_CANDIDATES.find((candidate) => existsSync(candidate));
      if (!iconset) return "";
      const { exitCode } = Bun.spawnSync([
        "iconutil",
        "-c",
        "icns",
        iconset,
        "-o",
        DESKTOP_ICON_PLACEHOLDER_ICNS,
      ]);
      return exitCode === 0 ? DESKTOP_ICON_PLACEHOLDER_ICNS : "";
    })().finally(() => {
      desktopIconPlaceholderPromise = null;
    });
  }
  const result = await desktopIconPlaceholderPromise;
  return result || null;
}

void ensureDesktopIconPlaceholder();

async function fetchDesktopIconArtwork(app: DockerApp): Promise<string | null> {
  const slug = app.iconSlug || iconSlugForApp(app.image);
  const iconUrl = app.iconUrl || `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons@main/png/${slug}.png`;
  const workDir = join(tmpdir(), `container-cove-icon-${app.id}`);
  const iconPng = join(workDir, "icon.png");
  const iconsetDir = join(workDir, "icon.iconset");
  const generatedIcns = join(workDir, "icon.generated.icns");
  try {
    const resp = await fetch(iconUrl);
    if (!resp.ok) return null;
    mkdirSync(workDir, { recursive: true });
    writeFileSync(iconPng, Buffer.from(await resp.arrayBuffer()));
    mkdirSync(iconsetDir, { recursive: true });
    let iconsetOk = true;
    for (const size of [16, 32, 128, 256, 512]) {
      const r1 = Bun.spawnSync([
        "sips", "-z", String(size), String(size), iconPng,
        "--out", join(iconsetDir, `icon_${size}x${size}.png`),
      ]);
      const r2 = Bun.spawnSync([
        "sips", "-z", String(size * 2), String(size * 2), iconPng,
        "--out", join(iconsetDir, `icon_${size}x${size}@2x.png`),
      ]);
      if (r1.exitCode !== 0 || r2.exitCode !== 0) {
        iconsetOk = false;
        break;
      }
    }
    if (!iconsetOk) return null;
    const { exitCode } = Bun.spawnSync([
      "iconutil",
      "-c",
      "icns",
      iconsetDir,
      "-o",
      generatedIcns,
    ]);
    if (exitCode !== 0) return null;
    return generatedIcns;
  } catch {
    return null;
  } finally {
    try { rmSync(iconsetDir, { recursive: true, force: true }); } catch {}
    try { rmSync(iconPng, { force: true }); } catch {}
  }
}

export async function createDesktopIcon(
  app: DockerApp,
  broadcast?: (msg: { type: "desktop:shortcut:progress"; state: "creating" | "done"; appName: string }) => void,
): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    broadcast?.({ type: "desktop:shortcut:progress", state: "creating", appName: app.name });

    // Fetch real icon first before placing anything on the Desktop
    const fetchedIcns = await fetchDesktopIconArtwork(app);
    const placeholderIcns = await ensureDesktopIconPlaceholder();
    const iconIcnsSource = fetchedIcns || placeholderIcns;
    const hasIcon = !!iconIcnsSource;

    // Now build the .app bundle on the Desktop
    const appPath = desktopIconPath(app);
    const contentsPath = join(appPath, "Contents");
    const macosDir = join(contentsPath, "MacOS");
    const resourcesDir = join(contentsPath, "Resources");
    mkdirSync(macosDir, { recursive: true });
    mkdirSync(resourcesDir, { recursive: true });

    const iconIcns = join(resourcesDir, "icon.icns");
    if (iconIcnsSource) {
      copyFileSync(iconIcnsSource, iconIcns);
    }
    // Clean up temp work dir if we fetched an icon
    if (fetchedIcns) {
      try { rmSync(dirname(fetchedIcns), { recursive: true, force: true }); } catch {}
    }

    writeFileSync(
      join(contentsPath, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIdentifier</key><string>com.loadingdock.shortcut.${app.id}</string>
  <key>CFBundleName</key><string>${app.name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>${hasIcon ? `
  <key>CFBundleIconFile</key><string>icon</string>` : ""}
  <key>LSUIElement</key><true/>
  <key>LSBackgroundOnly</key><true/>
</dict>
</plist>`,
    );

    const script = join(macosDir, "launch");
    writeFileSync(
      script,
      `#!/bin/bash\ncurl -s "http://localhost:${LAUNCH_SERVER_PORT}/launch?id=${app.id}" &\nopen -a "Container Cove"\n`,
    );
    chmodSync(script, 0o755);
  } catch (err) {
    console.error("Failed to create desktop icon:", err);
  } finally {
    broadcast?.({ type: "desktop:shortcut:progress", state: "done", appName: app.name });
  }
}

export function removeDesktopIcon(app: DockerApp): void {
  if (process.platform !== "darwin") return;
  try {
    rmSync(desktopIconPath(app), { recursive: true, force: true });
  } catch {}
  try {
    const desktopPath = join(homedir(), "Desktop");
    const targetBundleId = `com.loadingdock.shortcut.${app.id}`;
    for (const entry of readdirSync(desktopPath, { withFileTypes: true })) {
      if (!entry.name.endsWith(".app")) continue;
      const plistPath = join(desktopPath, entry.name, "Contents", "Info.plist");
      try {
        if (readFileSync(plistPath, "utf8").includes(targetBundleId)) {
          rmSync(join(desktopPath, entry.name), { recursive: true, force: true });
        }
      } catch {}
    }
  } catch {}
}

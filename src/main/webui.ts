// src/main/webui.ts — sandboxed embedded browser windows for app openUrl
import { BrowserWindow } from "electrobun/bun";
import type { DockerApp } from "../shared/types";
import { validateOpenUrl } from "../shared/validation";

const webUiWindows = new Map<string, InstanceType<typeof BrowserWindow>>();

export function openWebUiWindow(app: DockerApp): string | null {
  const url = app.openUrl ? validateOpenUrl(app.openUrl) : undefined;
  if (!url) return "No valid Web UI URL configured for this app.";

  if (webUiWindows.has(app.id)) {
    webUiWindows.get(app.id)!.show();
    return null;
  }

  // Open as a dedicated app-like window: full title is just the app name,
  // generous size so it feels like a native desktop app rather than a browser tab.
  const win = new BrowserWindow({
    title: app.name,
    url,
    frame: { x: 120, y: 80, width: 1280, height: 820 },
  } as any);

  win.on("close", (e: any) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    win.hide();
  });
  webUiWindows.set(app.id, win);
  return null;
}

export function closeWebUiWindow(appId: string): void {
  const win = webUiWindows.get(appId);
  if (win) {
    win.close();
    webUiWindows.delete(appId);
  }
}

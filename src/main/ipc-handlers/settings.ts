import type { IpcMessage } from "../../shared/types";
import { saveSettings } from "../settings";
import { setLoginItem } from "../login-item";
import { formatErrorExport, loadRecentErrors } from "../error-report";
import type { HandlerContext } from "./context";

export async function handleSettings(
  message: IpcMessage,
  ctx: HandlerContext,
): Promise<boolean> {
  const { state, broadcast, recordError, broadcastSettingsState } = ctx;

  switch (message.type) {
    case "secrets:mask": {
      state.secretsMaskingEnabled = message.enabled;
      await saveSettings({ secretsMaskingEnabled: state.secretsMaskingEnabled });
      broadcast({ type: "secrets:mask", enabled: state.secretsMaskingEnabled });
      return true;
    }

    case "secrets:keychain": {
      state.keychainSecretsEnabled = message.enabled;
      await saveSettings({ keychainSecretsEnabled: state.keychainSecretsEnabled });
      broadcast({
        type: "notification:show",
        title: "The Loading Dock(r)",
        body: `Keychain secrets ${state.keychainSecretsEnabled ? "enabled" : "disabled"}.`,
      });
      return true;
    }

    case "settings:auto-restart": {
      state.autoRestartOnUnhealthy = message.enabled;
      await saveSettings({ autoRestartOnUnhealthy: state.autoRestartOnUnhealthy });
      broadcastSettingsState();
      return true;
    }

    case "settings:error-logging": {
      state.errorLoggingEnabled = message.enabled;
      await saveSettings({ errorLoggingEnabled: state.errorLoggingEnabled });
      broadcastSettingsState();
      return true;
    }

    case "onboarding:dismiss": {
      if (message.noStartup) {
        state.showOnboarding = false;
        await saveSettings({ showOnboarding: false });
        broadcastSettingsState();
      }
      return true;
    }

    case "settings:show-onboarding": {
      state.showOnboarding = message.enabled;
      await saveSettings({ showOnboarding: state.showOnboarding });
      broadcastSettingsState();
      return true;
    }

    case "settings:data-dir": {
      state.dataDir = message.path;
      await saveSettings({ dataDir: state.dataDir });
      broadcastSettingsState();
      return true;
    }

    case "settings:open-at-login": {
      state.openAtLogin = message.enabled;
      await saveSettings({ openAtLogin: state.openAtLogin });
      if (process.platform === "darwin") {
        const appPath = process.execPath.split(".app/")[0] + ".app";
        try {
          setLoginItem(appPath, state.openAtLogin);
        } catch (err) {
          console.error("setLoginItem failed:", err);
        }
      }
      return true;
    }

    case "settings:auto-check-updates": {
      state.autoCheckUpdates = message.enabled;
      await saveSettings({ autoCheckUpdates: state.autoCheckUpdates });
      return true;
    }

    case "settings:theme": {
      state.theme = message.theme;
      await saveSettings({ theme: state.theme });
      return true;
    }

    case "errors:export": {
      const entries = await loadRecentErrors(200);
      broadcast({ type: "errors:exported", json: formatErrorExport(entries) });
      return true;
    }

    case "notifications:enabled": {
      state.notificationsEnabled = message.enabled;
      await saveSettings({ notificationsEnabled: state.notificationsEnabled });
      return true;
    }

    default:
      return false;
  }
}

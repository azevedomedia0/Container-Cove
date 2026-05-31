// src/main/settings.ts
import { join } from "path";
import { getRegistryDir } from "./registry";

const SETTINGS_FILE = "settings.json";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppSettings {
  releaseChannel: "stable" | "beta";
  notificationsEnabled: boolean;
  secretsMaskingEnabled: boolean;
  keychainSecretsEnabled: boolean;
  lastUpdateCheckAt: number;
  autoRestartOnUnhealthy: boolean;
  errorLoggingEnabled: boolean;
  openAtLogin: boolean;
  autoCheckUpdates: boolean;
  theme: "dark" | "light";
  showOnboarding: boolean;
  dataDir: string;
  windowBounds?: WindowBounds;
}

const DEFAULTS: AppSettings = {
  releaseChannel: "stable",
  notificationsEnabled: true,
  secretsMaskingEnabled: true,
  keychainSecretsEnabled: false,
  lastUpdateCheckAt: 0,
  autoRestartOnUnhealthy: true,
  errorLoggingEnabled: true,
  openAtLogin: false,
  autoCheckUpdates: true,
  theme: "dark",
  showOnboarding: true,
  dataDir: "~/.container-cove",
};

export function getSettingsFile(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getRegistryDir(platform, env), SETTINGS_FILE);
}

export async function loadSettings(
  file = getSettingsFile(),
): Promise<AppSettings> {
  try {
    const text = await Bun.file(file).text();
    const parsed = JSON.parse(text) as Partial<AppSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(
  patch: Partial<AppSettings>,
  file = getSettingsFile(),
): Promise<void> {
  let current: AppSettings;
  try {
    const text = await Bun.file(file).text();
    current = { ...DEFAULTS, ...(JSON.parse(text) as Partial<AppSettings>) };
  } catch {
    current = { ...DEFAULTS };
  }
  await Bun.write(file, JSON.stringify({ ...current, ...patch }, null, 2));
}

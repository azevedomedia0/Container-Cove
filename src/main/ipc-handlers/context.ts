import type { DockerApp, IpcMessage } from "../../shared/types";
import type { ReleaseInfo } from "../updater";

export type MetricsPoint = {
  id: string;
  cpuPercent: number;
  memUsageMB: number;
  timestamp: number;
};

/**
 * All mutable process-level state, owned by index.ts and shared by reference
 * with every handler module.  Mutating a property here is visible everywhere.
 */
export interface AppState {
  apps: DockerApp[];
  secretsMaskingEnabled: boolean;
  keychainSecretsEnabled: boolean;
  autoRestartOnUnhealthy: boolean;
  errorLoggingEnabled: boolean;
  notificationsEnabled: boolean;
  openAtLogin: boolean;
  autoCheckUpdates: boolean;
  theme: "dark" | "light";
  showOnboarding: boolean;
  dataDir: string;
  releaseChannel: "stable" | "beta";
  pendingUpdate: ReleaseInfo | null;
  pendingWebUiOpen: Set<string>;
  metricsHistory: Map<string, MetricsPoint[]>;
  unhealthyStreaks: Map<string, number>;
  healthRestartInProgress: Set<string>;
  systemUid: string;
  systemGid: string;
  systemTz: string;
}

/**
 * Everything a handler module needs beyond its own direct imports.
 * Passed by the index.ts router on every message dispatch.
 */
export interface HandlerContext {
  state: AppState;
  broadcast: (msg: IpcMessage) => void;
  recordError: (source: string, text: string, appId?: string) => void;
  broadcastOgImages: () => void;
  broadcastSettingsState: () => void;
  openAppWindow: (app: DockerApp) => void;
  restartAppForHealth: (app: DockerApp) => Promise<void>;
}

// src/main/registry.ts
import { dirname, join } from "path";
import type { DockerApp } from "../shared/types";

const APP_DIR_NAME = "container-cove";
const APPS_FILE_NAME = "apps.json";
const METRICS_FILE_NAME = "metrics.json";

export function getRegistryDir(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const home = env.HOME ?? ".";
  if (platform === "darwin")
    return join(home, "Library", "Application Support", APP_DIR_NAME);
  if (platform === "win32") {
    const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, APP_DIR_NAME);
  }
  const xdg = env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(xdg, APP_DIR_NAME);
}

export function getRegistryFile(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getRegistryDir(platform, env), APPS_FILE_NAME);
}

export function getMetricsFile(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getRegistryDir(platform, env), METRICS_FILE_NAME);
}

async function ensureDir(registryDir = getRegistryDir()) {
  await Bun.write(join(registryDir, ".keep"), "");
}


export async function loadRegistry(
  registryFile = getRegistryFile(),
): Promise<DockerApp[]> {
  try {
    const file = Bun.file(registryFile);
    const text = await file.text();
    const raw = JSON.parse(text) as Partial<DockerApp>[];
    return raw.flatMap((a) => {
      if (!a.id || !a.name || !a.icon || !a.description || !a.image) return [];
      return [{
        id: a.id,
        name: a.name,
        icon: a.icon,
        description: a.description,
        image: a.image,
        ports: a.ports ?? [],
        env: a.env ?? {},
        volumes: a.volumes ?? [],
        openUrl: a.openUrl,
        composeProject: a.composeProject,
        group: a.group,
        restartPolicy: a.restartPolicy,
        healthcheck: a.healthcheck,
        health: a.health,
        status: a.status === "running" ? "running" : "stopped",
        containerId: undefined,
        keychainEnvKeys: a.keychainEnvKeys,
        sortOrder: a.sortOrder,
        network: a.network,
        localDomain: a.localDomain,
      }];
    });
  } catch {
    return getDefaultApps();
  }
}

export async function registryExists(
  registryFile = getRegistryFile(),
): Promise<boolean> {
  return Bun.file(registryFile).exists();
}

export async function saveRegistry(
  apps: DockerApp[],
  registryFile = getRegistryFile(),
): Promise<void> {
  await ensureDir(dirname(registryFile));
  const serializable = apps.map(
    ({ containerId: _c, ...rest }) => rest,
  );
  await Bun.write(registryFile, JSON.stringify(serializable, null, 2));
}

function getDefaultApps(): DockerApp[] {
  return [];
}

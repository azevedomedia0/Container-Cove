/**
 * container-env.ts
 *
 * Provides a clean environment for all Podman/Docker subprocess spawns.
 *
 * Problem: if the user previously had Docker Desktop installed, their
 * ~/.docker/config.json contains `"credsStore": "desktop"`.  Podman
 * (and any Docker-compatible CLI) inherits DOCKER_CONFIG and then fails
 * with:
 *   "error getting credentials - err: exec: \"docker-credential-desktop\":
 *    executable file not found in $PATH"
 *
 * Fix: point DOCKER_CONFIG at a minimal config we own that has no
 * credsStore entry.  Only Container Cove's spawned processes see this —
 * the user's own shell environment is completely unaffected.
 */

import { join, resolve } from "path";
import { mkdirSync, writeFileSync, existsSync } from "fs";

let _cleanDockerConfigDir: string | undefined;

/**
 * Returns a copy of process.env with DOCKER_CONFIG overridden to a
 * minimal config directory that has no credsStore entry.
 *
 * The config directory is created on first call and reused thereafter.
 */
export function podmanEnv(): NodeJS.ProcessEnv {
  if (!_cleanDockerConfigDir) {
    const dir = resolve(
      process.env.HOME ?? "~",
      ".config",
      "container-cove",
      "docker",
    );
    const cfgPath = join(dir, "config.json");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(cfgPath)) {
      writeFileSync(cfgPath, JSON.stringify({ auths: {} }, null, 2));
    }
    _cleanDockerConfigDir = dir;
  }
  return { ...process.env, DOCKER_CONFIG: _cleanDockerConfigDir };
}

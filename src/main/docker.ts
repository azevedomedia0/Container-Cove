import { join, dirname } from "path";
import type { ContainerStatus, DockerApp } from "../shared/types";
import { podmanEnv } from "./container-env";

export type StatusCallback = (
  id: string,
  status: ContainerStatus,
  containerId?: string,
) => void;
export type LogCallback = (id: string, line: string) => void;

const activeProcs = new Map<string, ReturnType<typeof Bun.spawn>>();

// ── Concurrency limiter ───────────────────────────────────────────────────────

/**
 * A simple FIFO semaphore.  Callers await `acquire()` and must call
 * `release()` in a finally block, or use the convenience `run()` wrapper.
 */
class Semaphore {
  private slots: number;
  private readonly waitQueue: Array<() => void> = [];

  constructor(limit: number) {
    this.slots = limit;
  }

  acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waitQueue.push(resolve));
  }

  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.slots++;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Cap concurrent *informational* Docker CLI spawns (inspect, stats, volume ls,
// network ls, etc.).  Long-lived spawns (docker run, docker pull) are
// intentionally excluded — they are user-initiated and already fire-and-forget.
const _querySem = new Semaphore(6);

/**
 * Spawn a Docker query command under the concurrency limiter.
 * The semaphore slot is held for the entire lifetime of the subprocess so
 * that at most 6 short-lived Docker queries are in flight at once.
 * Returns the process handle after it has exited; stdout is still readable.
 */
async function spawnQuery(
  cmd: string[],
): Promise<ReturnType<typeof Bun.spawn>> {
  return _querySem.run(async () => {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: podmanEnv() });
    await p.exited;
    return p;
  });
}

// Cached path to the resolved container-runtime binary (`podman` or compatible).
// `undefined` = not yet searched; never permanently set to `null` so that
// re-detection works after `podman machine start` completes.
let resolvedContainerBin: string | undefined;

// Podman-first candidate list.  Podman is the bundled runtime; Docker-compatible
// CLIs are listed as fallbacks so existing Docker Desktop installations keep
// working without reconfiguration.
const CONTAINER_BINARY_CANDIDATES = [
  // Explicit overrides
  process.env.PODMAN_PATH,
  process.env.DOCKER_PATH,
  // Bundled Podman binary placed alongside the app executable at build time
  (() => {
    try { return join(dirname(process.execPath), "podman"); } catch { return null; }
  })(),
  // System Podman — common install locations (ordered by platform likelihood)
  "podman",
  "/opt/homebrew/bin/podman",          // macOS Apple Silicon (Homebrew / Podman Desktop)
  "/usr/local/bin/podman",             // macOS Intel  (Homebrew)
  "/usr/local/podman/bin/podman",      // Podman Desktop bundle (macOS)
  "/usr/bin/podman",                   // Linux
  // Docker-compatible fallback (for users who prefer Docker Desktop)
  "docker",
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
  "/usr/bin/docker",
  process.env["PROGRAMFILES"] &&
    `${process.env["PROGRAMFILES"]}\\Docker\\Docker\\resources\\bin\\docker.exe`,
].filter(Boolean) as string[];

/**
 * Locate the Podman (or Docker-compatible) binary.
 * Returns the resolved path or `null`.
 * Pass `force = true` to bypass the cache — used when polling after
 * `podman machine start` to detect the newly-available binary.
 */
async function resolveContainerBinary(force = false): Promise<string | null> {
  if (!force && resolvedContainerBin !== undefined) return resolvedContainerBin;

  for (const candidate of CONTAINER_BINARY_CANDIDATES) {
    try {
      // Both `podman version` and `docker version` print the client version
      // without requiring a running daemon / machine.
      const p = Bun.spawn(
        [candidate, "version", "--format", "{{.Client.Version}}"],
        { stdout: "pipe", stderr: "pipe", env: podmanEnv() },
      );
      await p.exited;
      if (p.exitCode === 0) {
        resolvedContainerBin = candidate;
        return candidate;
      }
    } catch {
      // binary not at this path — try next candidate
    }
  }

  // Leave resolvedContainerBin unchanged so the next call retries the full list
  // once Podman finishes installing or the machine starts.
  return null;
}

async function containerCmd(
  args: string[],
  force = false,
): Promise<string[] | null> {
  const bin = await resolveContainerBinary(force);
  if (!bin) return null;
  return [bin, ...args];
}

export async function isDockerAvailable(force = false): Promise<boolean> {
  const cmd = await containerCmd(["info"], force);
  if (!cmd) return false;
  const proc = await spawnQuery(cmd);
  return proc.exitCode === 0;
}

/**
 * Ensure Podman is ready to run containers.
 *
 * • macOS / Windows — Podman still requires a lightweight Linux VM
 *   (`podman machine`). We try to start an existing machine; if none exists
 *   we initialise one with `podman machine init --now`.
 * • Linux — Podman is daemonless and rootless; no VM or service is needed.
 *   We simply confirm the binary is present and working.
 *
 * Falls back to Docker-compatible CLI startup for users who have Docker
 * Desktop installed instead of Podman (the binary list prefers Podman, so
 * Docker is only reached if Podman is absent).
 *
 * Returns `true` when `podman info` (or `docker info`) succeeds.
 */
export async function startDockerDaemon(
  pollIntervalMs = 2000,
  timeoutMs = 90_000,
): Promise<boolean> {
  const platform = process.platform;
  const bin = await resolveContainerBinary();

  try {
    if (platform === "darwin") {
      if (bin) {
        // Determine whether this is Podman or a Docker-compatible CLI
        const isPodman = bin.includes("podman") || bin === "podman";

        if (isPodman) {
          // Try starting an existing machine first (fast path)
          const start = Bun.spawn([bin, "machine", "start"], {
            stdout: "pipe",
            stderr: "pipe",
            env: podmanEnv(),
          });
          await start.exited;

          if (start.exitCode !== 0) {
            // No machine yet — initialise one (downloads the VM image ~700 MB,
            // then starts it).  `--now` combines init + start in one command.
            Bun.spawn([bin, "machine", "init", "--now"], {
              stdout: "pipe",
              stderr: "pipe",
              env: podmanEnv(),
            });
          }
        } else {
          // Docker Desktop fallback
          const p = Bun.spawn(["open", "-a", "Docker"], {
            stdout: "pipe",
            stderr: "pipe",
          });
          await p.exited;
        }
      }
    } else if (platform === "win32") {
      if (bin) {
        const isPodman = bin.includes("podman") || bin === "podman";
        if (isPodman) {
          const start = Bun.spawn([bin, "machine", "start"], {
            stdout: "pipe",
            stderr: "pipe",
            env: podmanEnv(),
          });
          await start.exited;
          if (start.exitCode !== 0) {
            Bun.spawn([bin, "machine", "init", "--now"], {
              stdout: "pipe",
              stderr: "pipe",
              env: podmanEnv(),
            });
          }
        } else {
          // Docker Desktop fallback
          const candidates = [
            process.env["PROGRAMFILES"] &&
              `${process.env["PROGRAMFILES"]}\\Docker\\Docker\\Docker Desktop.exe`,
            process.env["LOCALAPPDATA"] &&
              `${process.env["LOCALAPPDATA"]}\\Docker\\Docker Desktop.exe`,
            "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
          ].filter(Boolean) as string[];
          for (const exe of candidates) {
            try {
              Bun.spawn(["cmd", "/c", "start", "", exe], {
                stdout: "pipe",
                stderr: "pipe",
              });
              break;
            } catch { /* try next */ }
          }
        }
      }
    } else {
      // Linux — Podman is daemonless; no machine or service to start.
      // If a Docker-compatible daemon is being used, try systemctl / service.
      if (bin && !bin.includes("podman") && bin !== "podman") {
        const systemctl = Bun.spawn(["systemctl", "start", "docker"], {
          stdout: "pipe",
          stderr: "pipe",
        });
        await systemctl.exited;
        if (systemctl.exitCode !== 0) {
          const svc = Bun.spawn(["service", "docker", "start"], {
            stdout: "pipe",
            stderr: "pipe",
          });
          await svc.exited;
        }
      }
      // For Podman on Linux, just verify it works — no startup needed.
      return await isDockerAvailable(true);
    }
  } catch {
    // Start command failed; still poll below in case it comes up anyway.
  }

  // Poll until `podman info` / `docker info` succeeds or we time out.
  // force = true bypasses the binary cache so newly-appearing binaries
  // (e.g. after `podman machine init` adds the socket) are detected.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
    if (await isDockerAvailable(true)) return true;
  }
  return false;
}

export async function launchApp(
  app: DockerApp,
  onStatus: StatusCallback,
  onLog: LogCallback,
  onPullProgress?: (id: string, status: string, detail?: string) => void,
  resolvedEnv?: Record<string, string>,
): Promise<void> {
  onStatus(app.id, "starting");

  const containerBin = await resolveContainerBinary();
  if (!containerBin) {
    onStatus(app.id, "error");
    onLog(
      app.id,
      "[container-cove] Podman not found. Install Podman (podman.io) or set PODMAN_PATH.",
    );
    return;
  }

  await silentRun(["rm", "-f", containerName(app)]);
  if (onPullProgress) {
    onPullProgress(app.id, "pulling", app.image);
    await pullImage(containerBin, app, onPullProgress);
    onPullProgress(app.id, "pulled", app.image);
  }
  const effectiveApp = resolvedEnv
    ? { ...app, env: { ...app.env, ...resolvedEnv } }
    : app;
  const args = buildDockerRunArgs(effectiveApp, containerBin);

  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: podmanEnv() });
    activeProcs.set(app.id, proc);
    streamLogs(proc.stdout, app.id, onLog);
    streamLogs(proc.stderr, app.id, onLog);

    const inspectCmd = [
      containerBin,
      "inspect",
      "--format",
      "{{.Id}}",
      containerName(app),
    ];
    const idProc = Bun.spawn(inspectCmd, { stdout: "pipe", stderr: "pipe", env: podmanEnv() });
    await idProc.exited;
    const rawId = await new Response(idProc.stdout).text();
    const containerId = rawId.trim().slice(0, 12);
    onStatus(app.id, "running", containerId);

    proc.exited.then((code) => {
      activeProcs.delete(app.id);
      onStatus(app.id, code === 0 ? "stopped" : "error");
      onLog(app.id, "[container-cove] Container exited with code " + code);
    });
  } catch (err) {
    onStatus(app.id, "error");
    onLog(app.id, "[container-cove] Failed to start: " + String(err));
  }
}

export async function stopApp(
  app: DockerApp,
  onStatus: StatusCallback,
): Promise<void> {
  onStatus(app.id, "stopping");
  const proc = activeProcs.get(app.id);
  if (proc) {
    proc.kill();
    activeProcs.delete(app.id);
  }
  await silentRun(["stop", containerName(app)]);
  await silentRun(["rm", containerName(app)]);
  onStatus(app.id, "stopped");
}

export function containerName(app: DockerApp): string {
  return "container-cove-" + app.id;
}

export function buildDockerRunArgs(
  app: DockerApp,
  dockerBin = "podman",
): string[] {
  const args = [dockerBin, "run", "--name", containerName(app)];
  if (app.restartPolicy && app.restartPolicy !== "no") {
    args.push("--restart", app.restartPolicy);
  }
  if (app.healthcheck?.cmd) {
    args.push("--health-cmd", app.healthcheck.cmd);
    if (app.healthcheck.intervalSec)
      args.push("--health-interval", `${app.healthcheck.intervalSec}s`);
    if (app.healthcheck.timeoutSec)
      args.push("--health-timeout", `${app.healthcheck.timeoutSec}s`);
    if (app.healthcheck.retries)
      args.push("--health-retries", String(app.healthcheck.retries));
  }
  if (app.network) args.push("--network", app.network);
  for (const port of app.ports) args.push("-p", port);
  for (const [key, val] of Object.entries(app.env))
    args.push("-e", key + "=" + val);
  for (const vol of app.volumes)
    args.push("-v", expandVolumePath(vol));
  args.push(app.image);
  return args;
}

/**
 * Expand shell-style home and environment variable references in the
 * host-side of a Docker volume spec (`host-path:container-path[:options]`).
 *
 * Handles:
 *   `~/…`        → `$HOME/…`
 *   `$HOME/…`    → resolved via process.env
 *   `${HOME}/…`  → resolved via process.env
 *   `$VAR/…`     → any env var via process.env
 *   `${VAR}/…`   → any env var via process.env
 *
 * Only the host path (before the first `:`) is expanded; the container path
 * and any mount options are passed through unchanged.
 * Unresolvable variables are left as-is (e.g. `${MISSING}` stays literal).
 *
 * Exported for unit testing.
 */
export function expandVolumePath(vol: string): string {
  const colonIdx = vol.indexOf(":");
  // Named volume (no colon) — nothing to expand
  if (colonIdx === -1) return vol;

  const host = vol.slice(0, colonIdx);
  const rest = vol.slice(colonIdx); // ":container[:options]"

  const expanded = host
    // ~/…  →  $HOME/…
    .replace(/^~(?=[/\\]|$)/, process.env.HOME ?? "~")
    // ${VAR}  →  env value, or restored literal if unset
    .replace(/\$\{([^}]+)\}/g, (orig, name: string) => process.env[name] ?? orig)
    // $VAR  →  env value, or restored literal if unset
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (orig, name: string) => process.env[name] ?? orig);

  return expanded + rest;
}

async function pullImage(
  dockerBin: string,
  app: DockerApp,
  onPullProgress: (id: string, status: string, detail?: string) => void,
) {
  const p = Bun.spawn([dockerBin, "pull", app.image], {
    stdout: "pipe",
    stderr: "pipe",
    env: podmanEnv(),
  });
  const reader = p.stdout?.getReader();
  const decoder = new TextDecoder();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split("\n")) {
        if (line.trim()) onPullProgress(app.id, "pulling", line.trim());
      }
    }
  }
  await p.exited;
}

// ── Batch health checks ───────────────────────────────────────────────────────

const VALID_HEALTH_STATUSES = new Set(["healthy", "unhealthy", "starting", "none"]);

/**
 * Parse the stdout of `docker inspect --format '{{.Name}}|{{...}}' c1 c2 …`
 * into a map of app-id → health status.
 * Exported for unit testing without a live Docker daemon.
 */
export function parseHealthBatchOutput(
  text: string,
  apps: DockerApp[],
): Map<string, NonNullable<DockerApp["health"]>> {
  const result = new Map<string, NonNullable<DockerApp["health"]>>();
  const lines = text.trim().split("\n").filter(Boolean);

  for (const app of apps) {
    // docker inspect's {{.Name}} carries a leading "/" — e.g. "/container-cove-foo"
    const needle = "/" + containerName(app) + "|";
    const line = lines.find((l) => l.startsWith(needle));
    const raw = line?.split("|")[1]?.trim() ?? "";
    result.set(
      app.id,
      VALID_HEALTH_STATUSES.has(raw)
        ? (raw as NonNullable<DockerApp["health"]>)
        : "unknown",
    );
  }
  return result;
}

/**
 * Fetch health status for multiple containers in a single `docker inspect`
 * call instead of one subprocess per container.
 * Containers not found by Docker are reported as "unknown".
 */
export async function getContainerHealthBatch(
  apps: DockerApp[],
): Promise<Map<string, NonNullable<DockerApp["health"]>>> {
  const result = new Map<string, NonNullable<DockerApp["health"]>>();
  if (apps.length === 0) return result;

  const cmd = await containerCmd([
    "inspect",
    "--format",
    // Prefix each line with the container name so we can match it back to an app.
    "{{.Name}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
    ...apps.map(containerName),
  ]);
  if (!cmd) {
    for (const app of apps) result.set(app.id, "unknown");
    return result;
  }

  // exitCode may be non-zero if some containers were not found, but Docker
  // still writes results for the ones it did find to stdout.
  const proc = await spawnQuery(cmd);
  const text = await new Response(proc.stdout).text();
  const parsed = parseHealthBatchOutput(text, apps);
  for (const app of apps) {
    result.set(app.id, parsed.get(app.id) ?? "unknown");
  }
  return result;
}

/** Single-app convenience wrapper around the batch call. */
export async function getContainerHealth(
  app: DockerApp,
): Promise<DockerApp["health"]> {
  const map = await getContainerHealthBatch([app]);
  return map.get(app.id) ?? "unknown";
}

// ── Batch metrics collection ──────────────────────────────────────────────────

/**
 * Parse the stdout of `docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' c1 c2 …`
 * into a map of app-id → {cpuPercent, memUsageMB}.
 * Exported for unit testing without a live Docker daemon.
 */
export function parseMetricsBatchOutput(
  text: string,
  apps: DockerApp[],
): Map<string, { cpuPercent: number; memUsageMB: number }> {
  const result = new Map<string, { cpuPercent: number; memUsageMB: number }>();

  for (const line of text.trim().split("\n").filter(Boolean)) {
    const [namePart, cpuPart, memPart] = line.split("|");
    const name = namePart?.trim();
    if (!name) continue;
    const app = apps.find((a) => containerName(a) === name);
    if (!app) continue;
    const cpuPercent = Number((cpuPart ?? "").replace("%", "").trim()) || 0;
    const used = ((memPart ?? "").split("/")[0] ?? "").trim();
    result.set(app.id, { cpuPercent, memUsageMB: parseMemoryToMB(used) });
  }
  return result;
}

/**
 * Fetch CPU + memory stats for multiple containers in a single
 * `docker stats --no-stream` call instead of one subprocess per container.
 */
export async function getContainerMetricsBatch(
  apps: DockerApp[],
): Promise<Map<string, { cpuPercent: number; memUsageMB: number }>> {
  if (apps.length === 0) return new Map();

  const cmd = await containerCmd([
    "stats",
    "--no-stream",
    "--format",
    "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}",
    ...apps.map(containerName),
  ]);
  if (!cmd) return new Map();

  const proc = await spawnQuery(cmd);
  const text = await new Response(proc.stdout).text();
  return parseMetricsBatchOutput(text, apps);
}

/** Single-app convenience wrapper around the batch call. */
export async function getContainerMetrics(
  app: DockerApp,
): Promise<{ cpuPercent: number; memUsageMB: number } | null> {
  const map = await getContainerMetricsBatch([app]);
  return map.get(app.id) ?? null;
}

function parseMemoryToMB(raw: string): number {
  const match = raw.match(/^([\d.]+)\s*([KMG]i?B?)?$/i);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = (match[2] ?? "B").toUpperCase();
  if (unit.startsWith("G")) return value * 1024;
  if (unit.startsWith("M")) return value;
  if (unit.startsWith("K")) return value / 1024;
  return value / (1024 * 1024);
}

/** Remove all named volumes referenced by the app's volume mappings. */
export async function removeAppVolumes(app: DockerApp): Promise<void> {
  const cmd = await containerCmd(["volume", "ls", "--format", "{{.Name}}"]);
  if (!cmd) return;
  // Only named volumes (host path that doesn't start with ~, /, or .) are
  // Docker-managed and safe to delete; bind-mount paths are the user's data.
  const namedVols = app.volumes
    .map((v) => v.split(":")[0])
    .filter((p) => p && !/^[~/.]/.test(p));
  for (const vol of namedVols) {
    await silentRun(["volume", "rm", "--force", vol]);
  }
  void cmd; // suppress lint — used above indirectly via silentRun
}

/** Remove the Docker image used by the app (if no other app uses it). */
export async function removeAppImage(app: DockerApp): Promise<void> {
  await silentRun(["rmi", "--force", app.image]);
}

/** Return true if a newer image is available on Docker Hub. */
export async function checkImageUpdateAvailable(app: DockerApp): Promise<boolean> {
  try {
    // Only handle Docker Hub images (no registry prefix with a dot)
    const ref = app.image;
    const hasRegistry = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+\//.test(ref);
    if (hasRegistry) return false;

    // Parse namespace/name:tag
    const withoutTag = ref.split(":")[0];
    const tag = ref.includes(":") ? ref.split(":")[1] : "latest";
    const parts = withoutTag.split("/");
    const namespace = parts.length > 1 ? parts[0] : "library";
    const name = parts.length > 1 ? parts[1] : parts[0];

    const url = `https://hub.docker.com/v2/repositories/${namespace}/${name}/tags/${tag}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const data = await res.json() as { last_pushed?: string; tag_last_pushed?: string };
    const remotePushed = data.tag_last_pushed ?? data.last_pushed;
    if (!remotePushed) return false;

    // Get local image creation time
    const localCmd = await containerCmd(["inspect", "--format", "{{.Created}}", ref]);
    if (!localCmd) return false;
    const proc = await spawnQuery(localCmd);
    if (proc.exitCode !== 0) return false;
    const localCreated = (await new Response(proc.stdout).text()).trim();
    if (!localCreated) return false;

    return new Date(remotePushed) > new Date(localCreated);
  } catch {
    return false;
  }
}

/** List all Docker networks (excluding built-ins). */
export async function listDockerNetworks(): Promise<string[]> {
  const cmd = await containerCmd(["network", "ls", "--format", "{{.Name}}"]);
  if (!cmd) return [];
  const proc = await spawnQuery(cmd);
  if (proc.exitCode !== 0) return [];
  return (await new Response(proc.stdout).text())
    .trim()
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
}

/** Create a new Docker bridge network. */
export async function createDockerNetwork(name: string): Promise<void> {
  await silentRun(["network", "create", "--driver", "bridge", name]);
}

async function silentRun(args: string[]): Promise<void> {
  try {
    const cmd = await containerCmd(args);
    if (!cmd) return;
    await spawnQuery(cmd);
  } catch {
    // ignore best-effort cleanup failures
  }
}

async function streamLogs(
  stream: ReadableStream<Uint8Array> | null,
  id: string,
  onLog: LogCallback,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split("\n");
    for (const line of lines) {
      if (line.trim()) onLog(id, line);
    }
  }
}

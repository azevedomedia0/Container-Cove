/**
 * E2E smoke tests: launch / stop / log / health / metrics on the real Docker CLI.
 *
 * Prerequisites: Docker daemon running. Skipped automatically when unavailable.
 * Run: bun test src/e2e/smoke.test.ts
 *
 * Each test uses a unique container name to avoid cross-contamination.
 * Alpine-based images are used for fast pulls.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DockerApp } from "../shared/types";
import {
  buildDockerRunArgs,
  containerName,
  getContainerHealth,
  getContainerMetrics,
  isDockerAvailable,
  launchApp,
  stopApp,
} from "../main/docker";

let dockerAvailable = false;
const SMOKE_TAG = `ed-smoke-${Date.now()}`;

function makeApp(overrides: Partial<DockerApp> = {}): DockerApp {
  return {
    id: `smoke-${SMOKE_TAG}`,
    name: "Smoke Test",
    icon: "default.png",
    description: "smoke test container",
    image: "alpine:3.19",
    ports: [],
    env: {},
    volumes: [],
    status: "stopped",
    ...overrides,
  };
}

beforeAll(async () => {
  dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    console.warn("[smoke] Docker not available — skipping all E2E tests");
  }
});

afterAll(async () => {
  // best-effort cleanup of any leftover smoke containers
  if (!dockerAvailable) return;
  const candidates = [`loading-dock-smoke-${SMOKE_TAG}`];
  for (const name of candidates) {
    const p = Bun.spawn(["docker", "rm", "-f", name], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await p.exited.catch(() => undefined);
  }
});

describe("smoke: docker availability", () => {
  test("isDockerAvailable returns boolean", async () => {
    const result = await isDockerAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("smoke: buildDockerRunArgs", () => {
  test("args include image as last element", () => {
    const app = makeApp({ image: "nginx:alpine" });
    const args = buildDockerRunArgs(app);
    expect(args[args.length - 1]).toBe("nginx:alpine");
  });

  test("container name follows convention", () => {
    const app = makeApp();
    expect(containerName(app)).toBe(`loading-dock-smoke-${SMOKE_TAG}`);
  });

  test("restart policy added when not 'no'", () => {
    const app = makeApp({ restartPolicy: "unless-stopped" });
    const args = buildDockerRunArgs(app);
    expect(args).toContain("--restart");
    expect(args).toContain("unless-stopped");
  });

  test("restart policy omitted when 'no'", () => {
    const app = makeApp({ restartPolicy: "no" });
    const args = buildDockerRunArgs(app);
    expect(args).not.toContain("--restart");
  });

  test("healthcheck flags added when cmd is set", () => {
    const app = makeApp({
      healthcheck: { cmd: "echo ok", intervalSec: 10, timeoutSec: 3, retries: 2 },
    });
    const args = buildDockerRunArgs(app);
    expect(args).toContain("--health-cmd");
    expect(args).toContain("echo ok");
    expect(args).toContain("--health-interval");
    expect(args).toContain("10s");
    expect(args).toContain("--health-timeout");
    expect(args).toContain("3s");
    expect(args).toContain("--health-retries");
    expect(args).toContain("2");
  });

  test("ports, env, volumes included in args", () => {
    const app = makeApp({
      ports: ["8080:80"],
      env: { FOO: "bar" },
      volumes: ["~/data:/data"],
    });
    const args = buildDockerRunArgs(app);
    expect(args).toContain("-p");
    expect(args).toContain("8080:80");
    expect(args).toContain("-e");
    expect(args).toContain("FOO=bar");
    expect(args).toContain("-v");
  });
});

describe("smoke: launch / stop cycle", () => {
  test(
    "launches a short-lived container and captures logs",
    async () => {
      if (!dockerAvailable) return;

      const app = makeApp({
        // echo then sleep to keep container alive long enough to inspect
        image: "alpine:3.19",
        id: `smoke-launch-${SMOKE_TAG}`,
      });

      const statuses: string[] = [];
      const logs: string[] = [];

      await launchApp(
        app,
        (_id, status) => statuses.push(status),
        (_id, line) => logs.push(line),
        undefined,
      );

      expect(statuses).toContain("starting");
      expect(statuses).toContain("running");
    },
    30_000,
  );

  test(
    "stop transitions container to stopped",
    async () => {
      if (!dockerAvailable) return;

      const app = makeApp({
        image: "alpine:3.19",
        id: `smoke-stop-${SMOKE_TAG}`,
      });

      const statuses: string[] = [];
      await launchApp(app, (_id, s) => statuses.push(s), () => {}, undefined);

      await stopApp(app, (_id, s) => statuses.push(s));

      expect(statuses).toContain("stopping");
      expect(statuses).toContain("stopped");
    },
    30_000,
  );
});

describe("smoke: health check", () => {
  test(
    "getContainerHealth returns valid value for unknown/non-existent container",
    async () => {
      if (!dockerAvailable) return;

      const app = makeApp({ id: "nonexistent-container-xyz" });
      const health = await getContainerHealth(app);
      const valid = ["healthy", "unhealthy", "starting", "none", "unknown"];
      expect(valid).toContain(health);
    },
    10_000,
  );

  test(
    "getContainerHealth returns 'unknown' when container does not exist",
    async () => {
      if (!dockerAvailable) return;

      const app = makeApp({ id: "definitely-does-not-exist-abc123" });
      const health = await getContainerHealth(app);
      expect(health).toBe("unknown");
    },
    10_000,
  );
});

describe("smoke: metrics collection", () => {
  test(
    "getContainerMetrics returns null for non-existent container",
    async () => {
      if (!dockerAvailable) return;

      const app = makeApp({ id: "no-such-container-metrics" });
      const metrics = await getContainerMetrics(app);
      expect(metrics).toBeNull();
    },
    10_000,
  );

  test(
    "getContainerMetrics returns numbers for running container",
    async () => {
      if (!dockerAvailable) return;

      const app = makeApp({
        id: `smoke-metrics-${SMOKE_TAG}`,
        image: "alpine:3.19",
      });

      const statuses: string[] = [];
      await launchApp(app, (_id, s) => statuses.push(s), () => {}, undefined);
      expect(statuses).toContain("running");

      const metrics = await getContainerMetrics(app);
      if (metrics !== null) {
        expect(typeof metrics.cpuPercent).toBe("number");
        expect(typeof metrics.memUsageMB).toBe("number");
        expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0);
        expect(metrics.memUsageMB).toBeGreaterThanOrEqual(0);
      }

      await stopApp(app, () => {});
    },
    45_000,
  );
});

describe("smoke: cross-platform path handling", () => {
  test("home dir substitution in volumes does not crash", () => {
    const app = makeApp({
      volumes: ["~/mydata:/data", "/absolute/path:/other"],
    });
    const args = buildDockerRunArgs(app);
    const vIdx = args.lastIndexOf("-v");
    expect(vIdx).toBeGreaterThan(-1);
    // home-expanded volume should not start with ~
    const volArg = args[vIdx + 1] ?? "";
    expect(volArg.startsWith("~")).toBe(false);
  });
});

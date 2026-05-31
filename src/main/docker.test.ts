import { describe, expect, test } from "bun:test";
import {
  buildDockerRunArgs,
  expandVolumePath,
  parseHealthBatchOutput,
  parseMetricsBatchOutput,
  containerName,
} from "./docker";
import type { DockerApp } from "../shared/types";

function makeApp(id: string, overrides: Partial<DockerApp> = {}): DockerApp {
  return {
    id,
    name: id,
    icon: "",
    description: "",
    image: "alpine:latest",
    ports: [],
    env: {},
    volumes: [],
    status: "running",
    ...overrides,
  };
}

describe("docker args", () => {
  test("buildDockerRunArgs includes ports, env, and volumes", () => {
    const app: DockerApp = {
      id: "postgres-dev",
      name: "Postgres",
      icon: "postgres.png",
      description: "db",
      image: "postgres:15",
      ports: ["5432:5432"],
      env: { POSTGRES_DB: "devdb" },
      volumes: ["~/data/postgres:/var/lib/postgresql/data"],
      status: "stopped",
    };
    const args = buildDockerRunArgs(app);
    expect(args[0]).toBe("docker");
    expect(args).toContain("--name");
    expect(args).toContain("loading-dock-postgres-dev");
    expect(args).toContain("-p");
    expect(args).toContain("5432:5432");
    expect(args).toContain("-e");
    expect(args).toContain("POSTGRES_DB=devdb");
    expect(args).toContain("-v");
    expect(args[args.length - 1]).toBe("postgres:15");
  });
});

describe("expandVolumePath", () => {
  const HOME = "/home/testuser";

  test("expands leading ~ to HOME", () => {
    expect(expandVolumePath(`~/data:/container`)).toBe(
      `${process.env.HOME}/data:/container`,
    );
  });

  test("expands $HOME", () => {
    const orig = process.env.HOME;
    process.env.HOME = HOME;
    expect(expandVolumePath("$HOME/data:/container")).toBe(`${HOME}/data:/container`);
    process.env.HOME = orig;
  });

  test("expands ${HOME}", () => {
    const orig = process.env.HOME;
    process.env.HOME = HOME;
    expect(expandVolumePath("${HOME}/config:/config")).toBe(`${HOME}/config:/config`);
    process.env.HOME = orig;
  });

  test("expands arbitrary $VAR", () => {
    process.env._TEST_VOL_VAR = "/mnt/storage";
    expect(expandVolumePath("$_TEST_VOL_VAR/data:/data")).toBe(
      "/mnt/storage/data:/data",
    );
    delete process.env._TEST_VOL_VAR;
  });

  test("expands arbitrary ${VAR}", () => {
    process.env._TEST_VOL_BRACED = "/mnt/braced";
    expect(expandVolumePath("${_TEST_VOL_BRACED}/data:/data")).toBe(
      "/mnt/braced/data:/data",
    );
    delete process.env._TEST_VOL_BRACED;
  });

  test("leaves unresolvable ${MISSING} literal", () => {
    expect(expandVolumePath("${_DOES_NOT_EXIST_XYZ}/data:/data")).toBe(
      "${_DOES_NOT_EXIST_XYZ}/data:/data",
    );
  });

  test("does not expand the container path", () => {
    const orig = process.env.HOME;
    process.env.HOME = HOME;
    // $HOME only appears on the container side — must not be expanded there
    expect(expandVolumePath(`/host/path:$HOME/container`)).toBe(
      `/host/path:$HOME/container`,
    );
    process.env.HOME = orig;
  });

  test("passes through named volumes (no colon)", () => {
    expect(expandVolumePath("myvolume")).toBe("myvolume");
  });

  test("passes through absolute host paths unchanged", () => {
    expect(expandVolumePath("/absolute/path:/container")).toBe(
      "/absolute/path:/container",
    );
  });

  test("preserves mount options after container path", () => {
    const orig = process.env.HOME;
    process.env.HOME = HOME;
    expect(expandVolumePath("~/music:/music:ro")).toBe(`${HOME}/music:/music:ro`);
    process.env.HOME = orig;
  });
});

describe("parseHealthBatchOutput", () => {
  const alpha = makeApp("alpha");
  const beta = makeApp("beta");

  test("parses healthy / none statuses", () => {
    const text = [
      `/${containerName(alpha)}|healthy`,
      `/${containerName(beta)}|none`,
    ].join("\n");
    const map = parseHealthBatchOutput(text, [alpha, beta]);
    expect(map.get("alpha")).toBe("healthy");
    expect(map.get("beta")).toBe("none");
  });

  test("reports 'unknown' for containers absent from output", () => {
    const ghost = makeApp("ghost");
    const map = parseHealthBatchOutput("", [ghost]);
    expect(map.get("ghost")).toBe("unknown");
  });

  test("reports 'unknown' for unrecognised status strings", () => {
    const app = makeApp("x");
    const text = `/${containerName(app)}|weird-status`;
    const map = parseHealthBatchOutput(text, [app]);
    expect(map.get("x")).toBe("unknown");
  });

  test("handles all four valid health statuses", () => {
    const statuses = ["healthy", "unhealthy", "starting", "none"] as const;
    for (const status of statuses) {
      const app = makeApp("s");
      const text = `/${containerName(app)}|${status}`;
      const map = parseHealthBatchOutput(text, [app]);
      expect(map.get("s")).toBe(status);
    }
  });

  test("returns empty map for empty app list", () => {
    const map = parseHealthBatchOutput("anything", []);
    expect(map.size).toBe(0);
  });

  test("ignores extraneous lines in output", () => {
    const app = makeApp("real");
    const text = [
      "/some-other-container|healthy",
      `/${containerName(app)}|starting`,
      "",
    ].join("\n");
    const map = parseHealthBatchOutput(text, [app]);
    expect(map.get("real")).toBe("starting");
  });
});

describe("parseMetricsBatchOutput", () => {
  const alpha = makeApp("alpha");
  const beta = makeApp("beta");

  test("parses cpu and memory for multiple containers", () => {
    const text = [
      `${containerName(alpha)}|0.25%|128MiB / 16GiB`,
      `${containerName(beta)}|1.50%|512MiB / 16GiB`,
    ].join("\n");
    const map = parseMetricsBatchOutput(text, [alpha, beta]);

    const a = map.get("alpha");
    expect(a?.cpuPercent).toBeCloseTo(0.25);
    expect(a?.memUsageMB).toBeCloseTo(128);

    const b = map.get("beta");
    expect(b?.cpuPercent).toBeCloseTo(1.5);
    expect(b?.memUsageMB).toBeCloseTo(512);
  });

  test("omits containers absent from output", () => {
    const ghost = makeApp("ghost");
    const map = parseMetricsBatchOutput("", [ghost]);
    expect(map.has("ghost")).toBe(false);
  });

  test("returns empty map for empty app list", () => {
    const map = parseMetricsBatchOutput("anything", []);
    expect(map.size).toBe(0);
  });

  test("handles GiB memory unit", () => {
    const app = makeApp("big");
    const text = `${containerName(app)}|2.00%|2GiB / 16GiB`;
    const map = parseMetricsBatchOutput(text, [app]);
    expect(map.get("big")?.memUsageMB).toBeCloseTo(2048);
  });

  test("handles KiB memory unit", () => {
    const app = makeApp("tiny");
    const text = `${containerName(app)}|0.01%|512KiB / 16GiB`;
    const map = parseMetricsBatchOutput(text, [app]);
    expect(map.get("tiny")?.memUsageMB).toBeCloseTo(0.5);
  });

  test("cpu defaults to 0 for malformed cpu field", () => {
    const app = makeApp("z");
    const text = `${containerName(app)}|--|10MiB / 16GiB`;
    const map = parseMetricsBatchOutput(text, [app]);
    expect(map.get("z")?.cpuPercent).toBe(0);
  });
});

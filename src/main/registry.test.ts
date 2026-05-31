import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { DockerApp } from "../shared/types";
import {
  getRegistryDir,
  getRegistryFile,
  loadRegistry,
  saveRegistry,
} from "./registry";

describe("registry paths", () => {
  test("uses platform-specific config dir", () => {
    expect(getRegistryDir("darwin", { HOME: "/Users/test" })).toBe(
      "/Users/test/Library/Application Support/container-cove",
    );
    expect(getRegistryDir("linux", { HOME: "/home/test" })).toBe(
      "/home/test/.config/container-cove",
    );
    expect(
      getRegistryDir("win32", { APPDATA: "C:/Users/test/AppData/Roaming" }),
    ).toBe("C:/Users/test/AppData/Roaming/container-cove");
  });

  test("registry file is apps.json in registry dir", () => {
    expect(getRegistryFile("linux", { HOME: "/home/test" })).toBe(
      "/home/test/.config/container-cove/apps.json",
    );
  });
});

describe("registry persistence", () => {
  test("save/load preserves last-known running state", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "container-cove-test-"));
    const registryFile = join(tmpRoot, "apps.json");
    const apps: DockerApp[] = [
      {
        id: "test",
        name: "Test",
        icon: "default.png",
        description: "test app",
        image: "nginx:latest",
        ports: ["8080:80"],
        env: { FOO: "bar" },
        volumes: [],
        status: "running",
        containerId: "abc123",
      },
    ];
    await saveRegistry(apps, registryFile);
    const loaded = await loadRegistry(registryFile);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].status).toBe("running");
    expect(loaded[0].containerId).toBeUndefined();
    expect(loaded[0].id).toBe("test");
  });

  test("load falls back to stopped for older registries without status", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "container-cove-test-"));
    const registryFile = join(tmpRoot, "apps.json");
    await Bun.write(
      registryFile,
      JSON.stringify([
        {
          id: "test",
          name: "Test",
          icon: "default.png",
          description: "test app",
          image: "nginx:latest",
          ports: ["8080:80"],
          env: { FOO: "bar" },
          volumes: [],
        },
      ]),
    );
    const loaded = await loadRegistry(registryFile);
    expect(loaded[0].status).toBe("stopped");
  });
});

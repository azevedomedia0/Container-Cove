/**
 * Integration-style tests for beta IPC/settings contracts (no Electrobun runtime).
 */
import { describe, expect, test } from "bun:test";
import type { IpcMessage } from "../shared/types";
import { loadSettings, saveSettings } from "./settings";
import { mkdtemp } from "node:fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("settings IPC contract", () => {
  test("beta settings persist and merge", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ed-ipc-"));
    const file = join(dir, "settings.json");
    await saveSettings(
      { autoRestartOnUnhealthy: false, errorLoggingEnabled: false },
      file,
    );
    const loaded = await loadSettings(file);
    expect(loaded.autoRestartOnUnhealthy).toBe(false);
    expect(loaded.errorLoggingEnabled).toBe(false);
    expect(loaded.notificationsEnabled).toBe(true);
  });

  test("settings:state message shape", () => {
    const msg: IpcMessage = {
      type: "settings:state",
      autoRestartOnUnhealthy: true,
      errorLoggingEnabled: true,
      openAtLogin: false,
      autoCheckUpdates: true,
      theme: "dark",
      secretsMaskingEnabled: true,
      keychainSecretsEnabled: false,
      showOnboarding: true,
      dataDir: "~/.container-cove",
      systemUid: "1000",
      systemGid: "1000",
      systemTz: "UTC",
    };
    expect(msg.type).toBe("settings:state");
  });

  test("errors:export response shape", () => {
    const msg: IpcMessage = {
      type: "errors:exported",
      json: '{"entries":[]}',
    };
    expect(msg.type).toBe("errors:exported");
  });
});

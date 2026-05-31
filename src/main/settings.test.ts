import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getSettingsFile, loadSettings, saveSettings } from "./settings";

describe("settings paths", () => {
  test("uses platform-specific config dir", () => {
    expect(getSettingsFile("darwin", { HOME: "/Users/test" })).toBe(
      "/Users/test/Library/Application Support/loading-dock/settings.json",
    );
    expect(getSettingsFile("linux", { HOME: "/home/test" })).toBe(
      "/home/test/.config/loading-dock/settings.json",
    );
    expect(
      getSettingsFile("win32", { APPDATA: "C:/Users/test/AppData/Roaming" }),
    ).toBe("C:/Users/test/AppData/Roaming/loading-dock/settings.json");
  });
});

describe("settings persistence", () => {
  test("defaults are returned when file is missing", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "ed-settings-"));
    const file = join(tmpRoot, "settings.json");
    const settings = await loadSettings(file);
    expect(settings.releaseChannel).toBe("stable");
    expect(settings.notificationsEnabled).toBe(true);
    expect(settings.secretsMaskingEnabled).toBe(true);
    expect(settings.keychainSecretsEnabled).toBe(false);
    expect(settings.autoRestartOnUnhealthy).toBe(true);
    expect(settings.errorLoggingEnabled).toBe(true);
  });

  test("saves and loads a patch without overwriting other fields", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "ed-settings-"));
    const file = join(tmpRoot, "settings.json");

    await saveSettings({ releaseChannel: "beta" }, file);
    const first = await loadSettings(file);
    expect(first.releaseChannel).toBe("beta");
    expect(first.notificationsEnabled).toBe(true);

    await saveSettings({ notificationsEnabled: false }, file);
    const second = await loadSettings(file);
    expect(second.releaseChannel).toBe("beta");
    expect(second.notificationsEnabled).toBe(false);
  });

  test("invalid JSON file falls back to defaults", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "ed-settings-"));
    const file = join(tmpRoot, "settings.json");
    await Bun.write(file, "{ not valid json }}}");
    const settings = await loadSettings(file);
    expect(settings.releaseChannel).toBe("stable");
  });
});

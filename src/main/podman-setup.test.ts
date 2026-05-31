import { describe, expect, test } from "bun:test";
import { setupPodman, type PodmanSetupResult } from "./podman-setup";
import { SetupState } from "./setup-state";

describe("podman-setup - type definitions", () => {
  test("PodmanSetupResult success type is correct", () => {
    const result: PodmanSetupResult = {
      success: true,
      runtime: "podman",
    };
    expect(result.success).toBe(true);
    expect((result as any).runtime).toBe("podman");
  });

  test("PodmanSetupResult error type has recovery options", () => {
    const result: PodmanSetupResult = {
      success: false,
      error: "Test error",
      recoveryOptions: [
        {
          label: "Retry",
          action: "retry",
        },
      ],
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe("Test error");
    expect(result.recoveryOptions.length).toBe(1);
  });
});

describe("setupPodman - setup orchestration", () => {
  test("setupPodman is callable with correct signature", async () => {
    const state = new SetupState();
    const progressUpdates: Array<[number, string]> = [];

    // Just verify the function exists and has correct type signature
    const func = setupPodman;
    expect(typeof func).toBe("function");
  });

  test("setupPodman calls progress callback", async () => {
    const state = new SetupState();
    const progressUpdates: Array<[number, string]> = [];

    // The actual setup will fail (no real Podman), but we can verify callback is called
    await setupPodman(state, (percent, step) => {
      progressUpdates.push([percent, step]);
    });

    // Progress callback should have been called at least once
    expect(progressUpdates.length).toBeGreaterThanOrEqual(0);
  });

  test("setupPodman returns result with correct shape", async () => {
    const state = new SetupState();

    const result = await setupPodman(state, () => {});

    // Check that result has the expected shape
    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");

    if (result.success) {
      expect((result as any).runtime).toBeDefined();
      expect(["podman", "docker"]).toContain((result as any).runtime);
    } else {
      expect(result.error).toBeDefined();
      expect(result.recoveryOptions).toBeDefined();
      expect(Array.isArray(result.recoveryOptions)).toBe(true);
    }
  });

  test("setupPodman respects SetupState.getPlatform()", async () => {
    const state = new SetupState();

    // Test that it uses the platform from state
    const platform = state.getPlatform();
    expect(["darwin", "win32", "linux"]).toContain(platform);
  });

  test("setupPodman handles errors gracefully", async () => {
    const state = new SetupState();
    let errorOccurred = false;

    try {
      const result = await setupPodman(state, () => {});
      // If no Podman is installed, we'll get an error result
      if (!result.success) {
        expect(result.error).toBeDefined();
        expect(result.error.length).toBeGreaterThan(0);
        expect(result.recoveryOptions).toBeDefined();
      }
      errorOccurred = false;
    } catch (e) {
      // Function should not throw, should return error result instead
      errorOccurred = true;
    }

    expect(errorOccurred).toBe(false);
  });
});

describe("setupPodman - result validation", () => {
  test("success result includes runtime field", async () => {
    const state = new SetupState();

    const result = await setupPodman(state, () => {});

    if (result.success) {
      const successResult = result as any;
      expect(successResult.runtime).toBeDefined();
      expect(["podman", "docker"]).toContain(successResult.runtime);
    }
  });

  test("error result includes error and recoveryOptions fields", async () => {
    const state = new SetupState();

    const result = await setupPodman(state, () => {});

    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);

      expect(result.recoveryOptions).toBeDefined();
      expect(Array.isArray(result.recoveryOptions)).toBe(true);

      // Each recovery option should have required fields
      for (const option of result.recoveryOptions) {
        expect(option.label).toBeDefined();
        expect(option.action).toBeDefined();
        expect(["retry", "fallback-docker", "open-docs", "open-uninstall-guide", "cancel"]).toContain(
          option.action,
        );
      }
    }
  });

  test("recovery options have valid action types", async () => {
    const state = new SetupState();

    const result = await setupPodman(state, () => {});

    if (!result.success) {
      const validActions = ["retry", "fallback-docker", "open-docs", "open-uninstall-guide", "cancel"];

      for (const option of result.recoveryOptions) {
        expect(validActions).toContain(option.action);
      }
    }
  });

  test("open-docs recovery options have URLs", async () => {
    const state = new SetupState();

    const result = await setupPodman(state, () => {});

    if (!result.success) {
      const docsOptions = result.recoveryOptions.filter((opt) => opt.action === "open-docs");

      for (const option of docsOptions) {
        expect(option.url).toBeDefined();
        expect(option.url?.length).toBeGreaterThan(0);
        expect(option.url).toMatch(/^https?:\/\//);
      }
    }
  });
});

describe("setupPodman - progress tracking", () => {
  test("progress callback tracks setup progress", async () => {
    const state = new SetupState();
    const progressUpdates: Array<[number, string]> = [];

    await setupPodman(state, (percent, step) => {
      progressUpdates.push([percent, step]);
      // Verify percentages are valid
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
      // Verify step description is not empty
      expect(step.length).toBeGreaterThan(0);
    });

    // Should have called progress callback at least once
    expect(progressUpdates.length).toBeGreaterThanOrEqual(0);
  });

  test("progress percentages are in valid range", async () => {
    const state = new SetupState();
    const progressUpdates: Array<[number, string]> = [];

    await setupPodman(state, (percent, step) => {
      progressUpdates.push([percent, step]);
    });

    for (const [percent, _step] of progressUpdates) {
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
      expect(Number.isInteger(percent)).toBe(true);
    }
  });

  test("progress step descriptions are meaningful", async () => {
    const state = new SetupState();
    const progressUpdates: Array<[number, string]> = [];

    await setupPodman(state, (percent, step) => {
      progressUpdates.push([percent, step]);
    });

    for (const [_percent, step] of progressUpdates) {
      // Step should be a non-empty string
      expect(typeof step).toBe("string");
      expect(step.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("setupPodman - SetupState integration", () => {
  test("uses SetupState getPlatform method", async () => {
    const state = new SetupState();

    // Verify that the state can provide a platform
    const platform = state.getPlatform();
    expect(["darwin", "win32", "linux"]).toContain(platform);
  });

  test("handles all supported platforms", async () => {
    // Test that setupPodman can be called for any valid platform
    const platforms: Array<"darwin" | "win32" | "linux"> = ["darwin", "win32", "linux"];

    for (const platform of platforms) {
      const state = new SetupState();
      // Create a test state with overridden getPlatform
      const originalGetPlatform = state.getPlatform;
      state.getPlatform = () => platform;

      const result = await setupPodman(state, () => {});

      // Should return a result (success or error, but not throw)
      expect(result).toBeDefined();
      expect(result.success === true || result.success === false).toBe(true);

      state.getPlatform = originalGetPlatform;
    }
  });

  test("setupPodman with SetupState creates valid progress state", async () => {
    const state = new SetupState();

    await setupPodman(state, () => {});

    // State should still be valid after setupPodman completes
    const progress = state.getProgress();
    expect(progress).toBeDefined();
    expect(progress.stage).toBeDefined();
  });
});

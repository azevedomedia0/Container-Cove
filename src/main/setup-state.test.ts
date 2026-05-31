import { describe, expect, test, beforeEach } from "bun:test";
import { SetupState } from "./setup-state";

describe("SetupState", () => {
  let setupState: SetupState;

  beforeEach(() => {
    setupState = new SetupState();
  });

  test("initializes with permission-prompt stage", () => {
    const progress = setupState.getProgress();
    expect(progress.stage).toBe("permission-prompt");
    expect(progress.currentStep).toBe("Requesting permissions");
    expect(progress.percentComplete).toBe(0);
    expect(progress.error).toBeUndefined();
  });

  test("updates stage with setStage", () => {
    setupState.setStage("initializing", "Starting Podman", 25);
    const progress = setupState.getProgress();
    expect(progress.stage).toBe("initializing");
    expect(progress.currentStep).toBe("Starting Podman");
    expect(progress.percentComplete).toBe(25);
  });

  test("sets error state with recovery options", () => {
    const recoveryOptions = [
      {
        label: "Retry",
        action: "retry",
      },
      {
        label: "View Docs",
        action: "help",
        url: "https://example.com/help",
      },
    ];
    setupState.setError("PODMAN_MISSING", "Podman not found", recoveryOptions);
    const progress = setupState.getProgress();
    expect(progress.stage).toBe("error");
    expect(progress.error).toBeDefined();
    expect(progress.error?.code).toBe("PODMAN_MISSING");
    expect(progress.error?.message).toBe("Podman not found");
    expect(progress.error?.recoveryOptions).toEqual(recoveryOptions);
  });

  test("isComplete returns true only when stage is complete", () => {
    expect(setupState.isComplete()).toBe(false);
    setupState.setStage("complete", "Setup complete", 100);
    expect(setupState.isComplete()).toBe(true);
  });

  test("hasError returns true only when stage is error", () => {
    expect(setupState.hasError()).toBe(false);
    setupState.setError("TEST_ERROR", "Test error message", []);
    expect(setupState.hasError()).toBe(true);
  });
});

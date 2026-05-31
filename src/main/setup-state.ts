export type SetupStage =
  | "permission-prompt"
  | "initializing"
  | "validating"
  | "complete"
  | "error";

export type Platform = "darwin" | "win32" | "linux";

export interface RecoveryOption {
  label: string;
  action: string;
  url?: string;
}

export interface SetupProgress {
  stage: SetupStage;
  percentComplete: number;
  currentStep: string;
  error?: {
    code: string;
    message: string;
    recoveryOptions: RecoveryOption[];
  };
}

export class SetupState {
  private progress: SetupProgress;

  constructor() {
    this.progress = {
      stage: "permission-prompt",
      percentComplete: 0,
      currentStep: "Requesting permissions",
    };
  }

  getProgress(): SetupProgress {
    return JSON.parse(JSON.stringify(this.progress));
  }

  setStage(stage: SetupStage, currentStep: string, percentComplete: number): void {
    this.progress.stage = stage;
    this.progress.currentStep = currentStep;
    this.progress.percentComplete = percentComplete;
    // Clear error when transitioning away from error stage
    if (stage !== "error") {
      this.progress.error = undefined;
    }
  }

  setError(
    code: string,
    message: string,
    recoveryOptions: RecoveryOption[],
  ): void {
    this.progress.stage = "error";
    this.progress.error = {
      code,
      message,
      recoveryOptions,
    };
  }

  getPlatform(): Platform {
    const platform = process.platform as Platform;
    return platform;
  }

  isComplete(): boolean {
    return this.progress.stage === "complete";
  }

  hasError(): boolean {
    return this.progress.stage === "error";
  }
}

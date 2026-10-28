import { LAB_STEPS, type LabStepId } from "./lab-pipeline.ts";

export type StepProgress = {
  readonly step: LabStepId;
  readonly fraction: number;
  readonly percent: number;
};

export type ProgressReporter = {
  readonly report: (step: LabStepId, fraction: number) => void;
  readonly finish: () => void;
};

// Measured with `npm run bench:lab` on the 512px icon. Small nonzero values
// keep the short stages visible while preserving the measured overall balance.
export const LAB_STEP_WEIGHTS: Readonly<Record<LabStepId, number>> = {
  capture: 1,
  colors: 12864,
  backdrop: 3,
  punch: 1,
  trace: 696,
  fit: 43,
  fair: 3.5,
  seal: 1
};

export function createProgressReporter(from: LabStepId, onProgress: (progress: StepProgress) => void): ProgressReporter {
  const start = LAB_STEPS.indexOf(from);
  const activeSteps = LAB_STEPS.slice(start);
  const totalWeight = activeSteps.reduce((sum, step) => sum + LAB_STEP_WEIGHTS[step], 0);
  let completedWeight = 0;
  let lastPercent = 0;
  let finished = false;

  const firstStep = activeSteps[0] ?? from;
  onProgress({ step: firstStep, fraction: 0, percent: 0 });

  const report = (step: LabStepId, fraction: number): void => {
    if (finished) return;
    const index = LAB_STEPS.indexOf(step);
    if (index < start) return;
    const safeFraction = Math.min(1, Math.max(0, fraction));
    let weightBefore = 0;
    for (let cursor = start; cursor < index; cursor += 1) {
      const previousStep = LAB_STEPS[cursor];
      if (previousStep !== undefined) weightBefore += LAB_STEP_WEIGHTS[previousStep];
    }
    const percent = Math.max(lastPercent, ((weightBefore + LAB_STEP_WEIGHTS[step] * safeFraction) / totalWeight) * 100);
    lastPercent = percent;
    onProgress({ step, fraction: safeFraction, percent: lastPercent });
  };

  return {
    report,
    finish: () => {
      if (finished) return;
      finished = true;
      const finalStep = LAB_STEPS[LAB_STEPS.length - 1] ?? "seal";
      onProgress({ step: finalStep, fraction: 1, percent: 100 });
    }
  };
}


import { LAB_STEPS, type LabStepId } from "./lab-pipeline.ts";

export type ActiveStepEvent =
  | { readonly kind: "tab-selected"; readonly step: LabStepId }
  | { readonly kind: "preset-selected" }
  | { readonly kind: "progress" }
  | { readonly kind: "rerun-started" }
  | { readonly kind: "rerun-completed" };

export function initialActiveStep(): LabStepId {
  return "colors";
}

export function reduceActiveStep(current: LabStepId, event: ActiveStepEvent): LabStepId {
  switch (event.kind) {
    case "tab-selected":
      return event.step;
    case "preset-selected":
      return "colors";
    case "progress":
    case "rerun-started":
    case "rerun-completed":
      return current;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function isLabStep(value: string | undefined): value is LabStepId {
  return LAB_STEPS.some((step) => step === value);
}

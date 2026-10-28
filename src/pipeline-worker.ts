import { parentPort } from "node:worker_threads";
import { planTrace, type PipelineSettings } from "./trace-pipeline.ts";
import type { LabControls } from "./lab-model.ts";
import type { LabRasterStages, LabStepId } from "./lab-pipeline.ts";
import { createProgressReporter } from "./progress.ts";
import type { SegmentColorStage } from "./segment.ts";

type PlanWorkerInput = {
  readonly sourcePng: Uint8Array;
  readonly settings: PipelineSettings;
  readonly controls: LabControls;
  readonly previousStages: LabRasterStages | null;
  readonly from: LabStepId;
  readonly substituteColors?: SegmentColorStage | null;
};

if (parentPort === null) throw new Error("Pipeline worker requires a worker thread");

parentPort.on("message", (input: PlanWorkerInput) => {
  try {
    const progress = createProgressReporter(input.from, (event) => parentPort?.postMessage({ kind: "progress", progress: event }));
    const plan = planTrace(Buffer.from(input.sourcePng), input.settings, input.controls, input.previousStages, input.from, progress.report, input.substituteColors);
    parentPort?.postMessage({ kind: "plan", plan });
  } catch (error) {
    parentPort?.postMessage({ kind: "error", error: error instanceof Error ? error.message : String(error) });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { initialActiveStep, reduceActiveStep } from "./step-selection.ts";

test("progress and rerun events keep the user's selected step", () => {
  const selected = "backdrop";
  const afterProgress = reduceActiveStep(selected, { kind: "progress" });
  const afterRerunStart = reduceActiveStep(afterProgress, { kind: "rerun-started" });
  const afterRerun = reduceActiveStep(afterRerunStart, { kind: "rerun-completed" });

  assert.equal(afterProgress, selected);
  assert.equal(afterRerunStart, selected);
  assert.equal(afterRerun, selected);
});

test("only tab and preset selection change the active step", () => {
  const selected = reduceActiveStep(initialActiveStep(), { kind: "tab-selected", step: "fit" });
  assert.equal(selected, "fit");
  assert.equal(reduceActiveStep(selected, { kind: "preset-selected" }), "colors");
});

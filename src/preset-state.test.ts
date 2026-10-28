import assert from "node:assert/strict";
import test from "node:test";
import { controlsFor } from "./lab-model.ts";
import {
  emptyPresetState,
  modifiedPresetControlCount,
  modifiedPresetControls,
  resetPresetControl,
  resetPresetControls,
  selectPreset,
  updatePresetControls
} from "./preset-state.ts";
import { TRACE_PRESETS } from "./trace.ts";

test("selecting a preset loads its controlsFor defaults", () => {
  for (const preset of TRACE_PRESETS) {
    const state = selectPreset(preset);
    assert.equal(state.kind, "selected");
    if (state.kind === "selected") {
      assert.equal(state.preset, preset);
      assert.deepEqual(state.controls, controlsFor(preset));
      assert.deepEqual(state.defaults, controlsFor(preset));
    }
  }
});

test("modified preset controls are counted independently", () => {
  const selected = selectPreset("photo");
  assert.equal(modifiedPresetControlCount(selected), 0);
  const modified = updatePresetControls(selected, {
    ...controlsFor("photo"),
    maxColors: controlsFor("photo").maxColors - 4,
    simplify: controlsFor("photo").simplify + 0.1,
    seal: !controlsFor("photo").seal
  });
  assert.equal(modifiedPresetControlCount(modified), 3);
  assert.deepEqual(modifiedPresetControls(modified), ["maxColors", "simplify", "seal"]);
});

test("reset restores one control or all controls to the selected preset", () => {
  const defaults = controlsFor("poster");
  const modified = updatePresetControls(selectPreset("poster"), {
    ...defaults,
    maxColors: defaults.maxColors - 2,
    simplify: defaults.simplify + 0.15
  });
  const oneReset = resetPresetControl(modified, "maxColors");
  assert.equal(modifiedPresetControlCount(oneReset), 1);
  if (oneReset.kind === "selected") assert.equal(oneReset.controls.maxColors, defaults.maxColors);
  const allReset = resetPresetControls(oneReset);
  assert.equal(modifiedPresetControlCount(allReset), 0);
  if (allReset.kind === "selected") assert.deepEqual(allReset.controls, defaults);
});

test("unselected state has no preset edits", () => {
  const state = emptyPresetState();
  assert.equal(modifiedPresetControlCount(state), 0);
  assert.deepEqual(modifiedPresetControls(state), []);
  assert.equal(resetPresetControls(state), state);
});

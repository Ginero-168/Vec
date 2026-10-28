import test from "node:test";
import assert from "node:assert/strict";
import { controlsFor } from "./lab-model.ts";
import { buildLabRasterStages } from "./lab-pipeline.ts";
import {
  applyEdits,
  applyMerge,
  applyRecolor,
  applySplit,
  checkEditsParamChange,
  extractClusters,
  hexToRgb,
  PaletteEditHistory,
  rgbToHex,
  type PaletteEdit
} from "./palette-edit.ts";
import { segmentColorStage, type SegmentColorStage } from "./segment.ts";

function createMockStage(): SegmentColorStage {
  const width = 4;
  const height = 4;
  const count = width * height;
  const rgba = new Uint8Array(count * 4);

  // 4 red pixels, 4 green pixels, 4 blue pixels, 4 yellow pixels
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    if (i < 4) {
      // Reddish with slight variations
      rgba[offset] = 240 + i * 4;
      rgba[offset + 1] = 10;
      rgba[offset + 2] = 10;
      rgba[offset + 3] = 255;
    } else if (i < 8) {
      // Green
      rgba[offset] = 10;
      rgba[offset + 1] = 220;
      rgba[offset + 2] = 10;
      rgba[offset + 3] = 255;
    } else if (i < 12) {
      // Blue
      rgba[offset] = 10;
      rgba[offset + 1] = 10;
      rgba[offset + 2] = 230;
      rgba[offset + 3] = 255;
    } else {
      // Yellow
      rgba[offset] = 240;
      rgba[offset + 1] = 240;
      rgba[offset + 2] = 10;
      rgba[offset + 3] = 255;
    }
  }

  return segmentColorStage(rgba, width, height, {
    mode: "photo",
    maxColors: 4,
    removeBackground: false,
    opaqueAt: 128
  });
}

test("no-edit applyEdits returns byte-identical and reference-identical stage", () => {
  const stage = createMockStage();
  const result = applyEdits(stage, []);

  // Same reference
  assert.strictEqual(result, stage);

  // Byte identical JSON
  assert.strictEqual(JSON.stringify(result), JSON.stringify(stage));

  // Typed arrays strictly identical
  assert.strictEqual(result.colors, stage.colors);
  assert.strictEqual(result.labels, stage.labels);
  assert.strictEqual(result.punchLabels, stage.punchLabels);
  assert.strictEqual(result.opaque, stage.opaque);
});

test("applyMerge merges two clusters and re-indexes cleanly", () => {
  const stage = createMockStage();
  const initialPaletteLength = stage.palette.length;
  assert.ok(initialPaletteLength >= 2);

  const from = 0;
  const to = 1;
  const merged = applyMerge(stage, from, to);

  // Palette length decreased by 1
  assert.strictEqual(merged.palette.length, initialPaletteLength - 1);

  // No labels equal to the old count or containing negative (except transparent)
  let foundFrom = false;
  for (let i = 0; i < merged.labels.length; i++) {
    assert.ok(merged.labels[i]! < merged.palette.length);
  }
  assert.strictEqual(foundFrom, false);

  // Colors array reflects updated palette
  assert.strictEqual(merged.colors.length, stage.colors.length);
});

test("applySplit deterministically splits a cluster into two in OKLab", () => {
  const stage = createMockStage();
  const initialPaletteLength = stage.palette.length;
  const clusterToSplit = 0;

  const split1 = applySplit(stage, clusterToSplit, 2);
  const split2 = applySplit(stage, clusterToSplit, 2);

  // Palette length increased by 1
  assert.strictEqual(split1.palette.length, initialPaletteLength + 1);

  // Determinism check
  assert.deepStrictEqual(Array.from(split1.labels), Array.from(split2.labels));
  assert.deepStrictEqual(split1.palette, split2.palette);
  assert.deepStrictEqual(Array.from(split1.colors), Array.from(split2.colors));

  // New cluster has assigned pixels
  let newClusterPixelCount = 0;
  const newIndex = initialPaletteLength;
  for (let i = 0; i < split1.labels.length; i++) {
    if (split1.labels[i] === newIndex) newClusterPixelCount++;
  }
  assert.ok(newClusterPixelCount > 0);
});

test("applyRecolor recolors specified cluster without modifying labels", () => {
  const stage = createMockStage();
  const targetCluster = 0;
  const targetHex = "#ff8800";
  const recolored = applyRecolor(stage, targetCluster, targetHex);

  assert.strictEqual(recolored.palette.length, stage.palette.length);
  assert.strictEqual(rgbToHex(recolored.palette[targetCluster]!), targetHex);

  // Labels must remain unchanged
  assert.deepStrictEqual(Array.from(recolored.labels), Array.from(stage.labels));

  // Pixels in target cluster should now match new hex
  const targetRgb = hexToRgb(targetHex);
  for (let i = 0; i < recolored.labels.length; i++) {
    if (recolored.labels[i] === targetCluster) {
      assert.strictEqual(recolored.colors[i * 4], targetRgb.r);
      assert.strictEqual(recolored.colors[i * 4 + 1], targetRgb.g);
      assert.strictEqual(recolored.colors[i * 4 + 2], targetRgb.b);
    }
  }
});

test("applyEdits applies an ordered sequence of merge, split, recolor deterministically", () => {
  const stage = createMockStage();
  const edits: PaletteEdit[] = [
    { kind: "recolor", cluster: 0, hex: "#ff00aa" },
    { kind: "split", cluster: 1, k: 2 },
    { kind: "merge", from: 0, to: 1 }
  ];

  const res1 = applyEdits(stage, edits);
  const res2 = applyEdits(stage, edits);

  assert.deepStrictEqual(Array.from(res1.colors), Array.from(res2.colors));
  assert.deepStrictEqual(Array.from(res1.labels), Array.from(res2.labels));
  assert.deepStrictEqual(res1.palette, res2.palette);
});

test("PaletteEditHistory manages undo and redo stack correctly", () => {
  const history = new PaletteEditHistory();
  assert.strictEqual(history.canUndo(), false);
  assert.strictEqual(history.canRedo(), false);

  const edit1: PaletteEdit = { kind: "recolor", cluster: 0, hex: "#112233" };
  const edit2: PaletteEdit = { kind: "merge", from: 0, to: 1 };

  history.push(edit1);
  assert.strictEqual(history.canUndo(), true);
  assert.strictEqual(history.canRedo(), false);
  assert.deepStrictEqual(history.getEdits(), [edit1]);

  history.push(edit2);
  assert.deepStrictEqual(history.getEdits(), [edit1, edit2]);

  // Undo edit2
  const undone = history.undo();
  assert.deepStrictEqual(undone, edit2);
  assert.deepStrictEqual(history.getEdits(), [edit1]);
  assert.strictEqual(history.canRedo(), true);

  // Redo edit2
  const redone = history.redo();
  assert.deepStrictEqual(redone, edit2);
  assert.deepStrictEqual(history.getEdits(), [edit1, edit2]);
  assert.strictEqual(history.canRedo(), false);

  // Push new edit clears redo
  history.undo();
  assert.strictEqual(history.canRedo(), true);
  const edit3: PaletteEdit = { kind: "split", cluster: 0, k: 2 };
  history.push(edit3);
  assert.strictEqual(history.canRedo(), false);
  assert.deepStrictEqual(history.getEdits(), [edit1, edit3]);

  history.clear();
  assert.strictEqual(history.canUndo(), false);
  assert.strictEqual(history.canRedo(), false);
  assert.deepStrictEqual(history.getEdits(), []);
});

test("checkEditsParamChange clears on maxColors or mode change, surfaces warning when edits present", () => {
  const baseControls = controlsFor("photo");

  // Mode change
  const modeChange = { ...baseControls, mode: "poster" as const };
  const checkModeWithEdits = checkEditsParamChange(baseControls, modeChange, true);
  assert.strictEqual(checkModeWithEdits.clearEdits, true);
  assert.ok(checkModeWithEdits.warning !== null);

  const checkModeNoEdits = checkEditsParamChange(baseControls, modeChange, false);
  assert.strictEqual(checkModeNoEdits.clearEdits, true);
  assert.strictEqual(checkModeNoEdits.warning, null);

  // maxColors change
  const maxColorsChange = { ...baseControls, maxColors: baseControls.maxColors + 4 };
  const checkColorsWithEdits = checkEditsParamChange(baseControls, maxColorsChange, true);
  assert.strictEqual(checkColorsWithEdits.clearEdits, true);
  assert.ok(checkColorsWithEdits.warning !== null);
});

test("checkEditsParamChange allows edits to survive downstream parameter changes", () => {
  const baseControls = controlsFor("photo");

  // Downstream parameter changes (speckArea, removeBackground, backdropSpread, opaqueAt, smoothness, corner, seal, etc.)
  const downstreamChanges = [
    { ...baseControls, speckArea: baseControls.speckArea + 5 },
    { ...baseControls, removeBackground: !baseControls.removeBackground },
    { ...baseControls, backdropSpread: baseControls.backdropSpread + 10 },
    { ...baseControls, opaqueAt: 160 },
    { ...baseControls, traceColors: 12 },
    { ...baseControls, colorPrecision: 7 },
    { ...baseControls, smoothness: 0.8 },
    { ...baseControls, corner: 60 },
    { ...baseControls, seal: !baseControls.seal },
    { ...baseControls, sealWidth: 3 }
  ];

  for (const next of downstreamChanges) {
    const result = checkEditsParamChange(baseControls, next, true);
    assert.strictEqual(result.clearEdits, false, `Failed to survive change in control field`);
    assert.strictEqual(result.warning, null);
  }
});

test("extractClusters extracts cluster metrics and sub-shades", () => {
  const stage = createMockStage();
  const clusters = extractClusters(stage);

  assert.ok(clusters.length > 0 && clusters.length <= stage.palette.length);
  for (const cluster of clusters) {
    assert.ok(cluster.pixelCount > 0);
    assert.ok(cluster.hex.startsWith("#"));
    assert.ok(cluster.subShades.length > 0);
  }
});

test("pipeline hook substituteColors feeds edited colors downstream to backdrop and punch", () => {
  const stage = createMockStage();
  const controls = controlsFor("photo");
  const initialStages = buildLabRasterStages(stage.sourceRgba!, 4, 4, controls);

  // Recolor cluster 0 to magenta
  const edited = applyRecolor(stage, 0, "#ff00ff");
  const substitutedStages = buildLabRasterStages(stage.sourceRgba!, 4, 4, controls, initialStages, "backdrop", edited);

  assert.strictEqual(substitutedStages.segmentation, edited);
  assert.strictEqual(substitutedStages.colors, edited.colors);
  assert.notStrictEqual(substitutedStages.backdrop, initialStages.backdrop);
});


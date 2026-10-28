import test from "node:test";
import assert from "node:assert/strict";
import { controlsFor } from "./lab-model.ts";
import { buildLabRasterStages, buildLabRasterStagesAsync } from "./lab-pipeline.ts";
import {
  applyEdits,
  applyHide,
  applyMerge,
  applyRecolor,
  applySplit,
  applySplitShade,
  checkEditsParamChange,
  createDimmedPreview,
  deriveSwatchColors,
  extractClusters,
  getMaxColorsLimit,
  hexToRgb,
  isNetZeroEdits,
  PaletteEditHistory,
  remapEditsAcrossMaxColors,
  rgbToHex,
  type PaletteEdit
} from "./palette-edit.ts";
import { encodeRgbaPng } from "./png-alpha.ts";
import { segmentColorStage, type SegmentColorStage } from "./segment.ts";
import { planTrace, planTraceAsync, settingsFromControls } from "./trace-pipeline.ts";

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

test("applySplitShade splits an inner shade circle out into its own color cluster", () => {
  const stage = createMockStage();
  const initialPaletteLength = stage.palette.length;
  const cluster = 0;

  const splitStage = applySplitShade(stage, cluster, 0);

  // Palette grows by 1
  assert.strictEqual(splitStage.palette.length, initialPaletteLength + 1);

  // Pixels assigned to new cluster
  const newClusterIdx = initialPaletteLength;
  let hasNewPixels = false;
  for (let i = 0; i < splitStage.labels.length; i++) {
    if (splitStage.labels[i] === newClusterIdx) {
      hasNewPixels = true;
      break;
    }
  }
  assert.strictEqual(hasNewPixels, true);
});

test("applyRecolor recolors specified cluster with hex and alpha", () => {
  const stage = createMockStage();
  const targetCluster = 0;
  const targetHex = "#ff8800";
  const recolored = applyRecolor(stage, targetCluster, targetHex, 200);

  assert.strictEqual(recolored.palette.length, stage.palette.length);
  assert.strictEqual(rgbToHex(recolored.palette[targetCluster]!), targetHex);

  // Labels must remain unchanged
  assert.deepStrictEqual(Array.from(recolored.labels), Array.from(stage.labels));

  // Pixels in target cluster should now match new hex and alpha
  const targetRgb = hexToRgb(targetHex);
  for (let i = 0; i < recolored.labels.length; i++) {
    if (recolored.labels[i] === targetCluster) {
      assert.strictEqual(recolored.colors[i * 4], targetRgb.r);
      assert.strictEqual(recolored.colors[i * 4 + 1], targetRgb.g);
      assert.strictEqual(recolored.colors[i * 4 + 2], targetRgb.b);
      assert.strictEqual(recolored.colors[i * 4 + 3], 200);
      assert.strictEqual(recolored.opaque[i], 200);
    }
  }
});

test("applyHide hides and unhides a cluster toggling opacity", () => {
  const stage = createMockStage();
  const targetCluster = 0;

  const hidden = applyHide(stage, targetCluster, true);
  for (let i = 0; i < hidden.labels.length; i++) {
    if (hidden.labels[i] === targetCluster) {
      assert.strictEqual(hidden.opaque[i], 0);
      assert.strictEqual(hidden.colors[i * 4 + 3], 0);
    }
  }

  const unhidden = applyHide(hidden, targetCluster, false);
  for (let i = 0; i < unhidden.labels.length; i++) {
    if (unhidden.labels[i] === targetCluster) {
      assert.strictEqual(unhidden.opaque[i], 255);
      assert.strictEqual(unhidden.colors[i * 4 + 3], 255);
    }
  }
});

test("isNetZeroEdits detects when stage matches baseStage", () => {
  const stage = createMockStage();
  assert.strictEqual(isNetZeroEdits(stage, stage), true);

  const edited = applyRecolor(stage, 0, "#00ff00");
  assert.strictEqual(isNetZeroEdits(stage, edited), false);

  const reverted = applyRecolor(edited, 0, rgbToHex(stage.palette[0]!));
  assert.strictEqual(isNetZeroEdits(stage, reverted), true);
});

test("createDimmedPreview dims non-selected clusters to dark grayscale", () => {
  const stage = createMockStage();
  const dimmed = createDimmedPreview(stage, 0);

  assert.strictEqual(dimmed.length, stage.colors.length);

  for (let i = 0; i < stage.labels.length; i++) {
    const offset = i * 4;
    if (stage.labels[i] === 0) {
      assert.strictEqual(dimmed[offset], stage.colors[offset]);
      assert.strictEqual(dimmed[offset + 1], stage.colors[offset + 1]);
      assert.strictEqual(dimmed[offset + 2], stage.colors[offset + 2]);
    } else {
      // Non-selected pixels are converted to low grayscale
      assert.strictEqual(dimmed[offset], dimmed[offset + 1]);
      assert.strictEqual(dimmed[offset + 1], dimmed[offset + 2]);
      assert.ok(dimmed[offset]! <= 60);
    }
  }
});

test("remapEditsAcrossMaxColors preserves manual edits onto new clustering", () => {
  const stage4 = createMockStage();
  const stage8 = segmentColorStage(stage4.sourceRgba!, 4, 4, {
    mode: "photo",
    maxColors: 8,
    removeBackground: false,
    opaqueAt: 128
  });

  const edits: PaletteEdit[] = [
    { kind: "recolor", cluster: 0, hex: "#123456" },
    { kind: "hide", cluster: 1, hidden: true }
  ];

  const { remappedEdits, unmappedCount } = remapEditsAcrossMaxColors(edits, stage4, stage8);
  assert.strictEqual(unmappedCount, 0);
  assert.strictEqual(remappedEdits.length, 2);
  assert.strictEqual(remappedEdits[0]!.kind, "recolor");
  assert.strictEqual((remappedEdits[0] as any).hex, "#123456");
  assert.strictEqual(remappedEdits[1]!.kind, "hide");
});

test("checkEditsParamChange remaps on maxColors change, clears on mode change", () => {
  const baseControls = controlsFor("photo");
  const stage = createMockStage();

  // Mode change: clears edits
  const modeChange = { ...baseControls, mode: "poster" as const };
  const checkMode = checkEditsParamChange(baseControls, modeChange, true);
  assert.strictEqual(checkMode.clearEdits, true);
  assert.ok(checkMode.warning !== null);

  // maxColors change: edits survive and are remapped
  const maxColorsChange = { ...baseControls, maxColors: 8 };
  const edits: PaletteEdit[] = [{ kind: "recolor", cluster: 0, hex: "#abcdef" }];
  const checkMax = checkEditsParamChange(baseControls, maxColorsChange, true, stage, stage, edits);
  assert.strictEqual(checkMax.clearEdits, false);
  assert.ok(checkMax.remappedEdits !== undefined);
  assert.strictEqual(checkMax.remappedEdits.length, 1);
});

test("checkEditsParamChange allows edits to survive downstream parameter changes", () => {
  const baseControls = controlsFor("photo");

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

  const edited = applyRecolor(stage, 0, "#ff00ff");
  const substitutedStages = buildLabRasterStages(stage.sourceRgba!, 4, 4, controls, initialStages, "backdrop", undefined, edited);

  assert.strictEqual(substitutedStages.segmentation, edited);
  assert.strictEqual(substitutedStages.colors, edited.colors);
  assert.notStrictEqual(substitutedStages.backdrop, initialStages.backdrop);
});

test("async pipeline hook substituteColors feeds edited colors downstream", async () => {
  const stage = createMockStage();
  const controls = controlsFor("photo");
  const initialStages = await buildLabRasterStagesAsync(stage.sourceRgba!, 4, 4, controls);

  const edited = applyRecolor(stage, 0, "#ff00ff");
  const substitutedStages = await buildLabRasterStagesAsync(stage.sourceRgba!, 4, 4, controls, initialStages, "backdrop", undefined, undefined, edited);

  assert.strictEqual(substitutedStages.segmentation, edited);
  assert.strictEqual(substitutedStages.colors, edited.colors);
  assert.notStrictEqual(substitutedStages.backdrop, initialStages.backdrop);
});

test("deriveSwatchColors produces real palette colors for 1..N and deterministic farthest-point colors beyond N", () => {
  const stage = createMockStage(); // 4 colors in palette: red, green, blue, yellow
  const maxLimit = 10;
  const swatches = deriveSwatchColors(stage, maxLimit);

  assert.strictEqual(swatches.length, maxLimit);
  // Swatches 1..4 match stage.palette exactly in order
  assert.strictEqual(swatches[0], rgbToHex(stage.palette[0]!));
  assert.strictEqual(swatches[1], rgbToHex(stage.palette[1]!));
  assert.strictEqual(swatches[2], rgbToHex(stage.palette[2]!));
  assert.strictEqual(swatches[3], rgbToHex(stage.palette[3]!));

  // Swatches 5..10 are valid hex strings and deterministic
  for (let i = 4; i < maxLimit; i++) {
    assert.match(swatches[i]!, /^#[0-9a-f]{6}$/i);
  }

  // Running deriveSwatchColors again yields identical results (deterministic)
  const swatches2 = deriveSwatchColors(stage, maxLimit);
  assert.deepStrictEqual(swatches, swatches2);

  // Null stage returns fallback swatches of requested length without throwing
  const fallback = deriveSwatchColors(null, 8);
  assert.strictEqual(fallback.length, 8);
});

test("getMaxColorsLimit caps count row according to lab-model mode and inputMax, never 48", () => {
  assert.strictEqual(getMaxColorsLimit("photo"), 32);
  assert.strictEqual(getMaxColorsLimit("poster"), 10);
  assert.strictEqual(getMaxColorsLimit("icon"), 8);
  assert.strictEqual(getMaxColorsLimit("logo"), 32);

  // Input max attribute overrides
  assert.strictEqual(getMaxColorsLimit("photo", 24), 24);
  assert.strictEqual(getMaxColorsLimit(undefined, 16), 16);
  assert.strictEqual(getMaxColorsLimit(undefined, undefined), 32);
  assert.notStrictEqual(getMaxColorsLimit(), 48);
});

test("apply path: planTrace and planTraceAsync substitute colors and run downstream stages", async () => {
  const stage = createMockStage();
  const controls = controlsFor("photo");
  const settings = settingsFromControls(controls);
  const png = encodeRgbaPng(4, 4, stage.sourceRgba!);

  const initialPlan = planTrace(png, settings, controls);
  assert.ok(initialPlan !== null);

  const edited = applyRecolor(stage, 0, "#00ffff");

  // Call sync planTrace with substituteColors from step "backdrop"
  const substitutedPlan = planTrace(png, settings, controls, initialPlan.rasterStages ?? null, "backdrop", undefined, edited);
  assert.ok(substitutedPlan !== null);
  assert.strictEqual(substitutedPlan.rasterStages?.segmentation, edited);
  assert.strictEqual(substitutedPlan.rasterStages?.colors, edited.colors);

  // Call async planTraceAsync with substituteColors from step "backdrop"
  const asyncPlan = await planTraceAsync(png, settings, controls, initialPlan.rasterStages ?? null, "backdrop", undefined, undefined, edited);
  assert.ok(asyncPlan !== null);
  assert.strictEqual(asyncPlan.rasterStages?.segmentation, edited);
  assert.strictEqual(asyncPlan.rasterStages?.colors, edited.colors);
});

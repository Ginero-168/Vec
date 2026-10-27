import * as childProcess from "node:child_process";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { controlsFor } from "./lab-model.ts";
import { buildLabRasterStages, CONTROL_STEPS, earliestChangedStep } from "./lab-pipeline.ts";
import { encodeRgbaPng, readRgbaPng } from "./png-alpha.ts";
import { traceRaster, traceRasterWithControls } from "./trace-pipeline.ts";
import { presetDefaults, resolveVtracer, vtracerArguments, type TracePreset, type TraceRequest } from "./trace.ts";

const PRESETS: readonly TracePreset[] = ["icon", "logo", "photo", "poster"];

test("default lab controls produce byte-identical SVG to the panel pipeline", () => {
  const binary = resolveVtracer(path.resolve("extension/bin", process.platform === "win32" ? "vtracer.exe" : "vtracer"));
  for (const preset of PRESETS) {
    const source = fixturePng(preset);
    const settings = { preset, ...presetDefaults(preset) };
    const controls = controlsFor(preset);
    const oldCalls: string[] = [];
    const labCalls: string[] = [];
    const trace = (calls: string[]) => (png: Buffer, request: TraceRequest): string => {
      const image = readRgbaPng(png);
      assert.notEqual(image, null);
      calls.push(png.toString("base64") + "\n" + vtracerArguments("in.png", "out.svg", request).join("\n"));
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vec-panel-equality-"));
      try {
        const input = path.join(directory, "input.png");
        const output = path.join(directory, "output.svg");
        fs.writeFileSync(input, png);
        const result = childProcess.spawnSync(binary, vtracerArguments(input, output, request), { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
        assert.equal(result.status, 0, result.stderr);
        return fs.readFileSync(output, "utf8");
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    };

    const panelOutput = traceRaster(source, settings, trace(oldCalls));
    const labOutput = traceRasterWithControls(source, controls, trace(labCalls));

    assert.equal(labOutput, panelOutput, preset + " SVG bytes changed");
    assert.deepEqual(labCalls, oldCalls, preset + " VTracer inputs or arguments changed");
  }
});

test("controls map to their earliest stage and downstream runs reuse prior rasters", () => {
  const controls = controlsFor("photo");
  assert.equal(CONTROL_STEPS.length, Object.keys(controls).length);
  assert.equal(earliestChangedStep(controls, { ...controls, opaqueAt: 144 }), "punch");
  assert.equal(earliestChangedStep(controls, { ...controls, sealWidth: 1.4 }), "seal");

  const source = fixtureRgba("photo");
  const fringeOffset = (11 * 28 + 14) * 4 + 3;
  source[fringeOffset] = 96;
  const stages = buildLabRasterStages(source, 28, 22, controls);
  const backdrop = buildLabRasterStages(source, 28, 22, { ...controls, backdropSpread: controls.backdropSpread + 4 }, stages, "backdrop");
  const punched = buildLabRasterStages(source, 28, 22, { ...controls, opaqueAt: 144 }, stages, "punch");
  const traced = buildLabRasterStages(source, 28, 22, controls, stages, "trace");
  assert.equal(backdrop.colors, stages.colors);
  assert.equal(backdrop.segmentation, stages.segmentation);
  assert.notEqual(backdrop.backdrop, stages.backdrop);
  assert.equal(punched.colors, stages.colors);
  assert.equal(punched.backdrop, stages.backdrop);
  assert.equal(punched.segmentation, stages.segmentation);
  assert.equal(stages.punch[fringeOffset], 0);
  const lowerCutoff = buildLabRasterStages(source, 28, 22, { ...controls, opaqueAt: 80 }, stages, "punch");
  assert.equal(lowerCutoff.punch[fringeOffset], 255);
  assert.equal(traced, stages);
});

function fixturePng(preset: TracePreset): Buffer {
  const width = 28;
  const height = 22;
  const rgba = new Uint8Array(width * height * 4);
  const colors = preset === "poster"
    ? [[20, 20, 20], [238, 235, 224], [95, 46, 30]]
    : preset === "photo"
      ? [[30, 95, 155], [205, 138, 74], [116, 165, 107], [230, 213, 174]]
      : [[235, 235, 229], [42, 100, 190], [221, 55, 60], [245, 185, 48]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colorIndex = preset === "photo"
        ? Math.min(colors.length - 1, Math.floor((x + y * 0.7) / 8))
        : x < 9 ? 0 : x < 18 ? 1 : 2;
      const color = colors[colorIndex] ?? [0, 0, 0];
      const offset = (y * width + x) * 4;
      rgba[offset] = color[0] ?? 0;
      rgba[offset + 1] = color[1] ?? 0;
      rgba[offset + 2] = color[2] ?? 0;
      const border = (preset === "icon" || preset === "logo") && (x === 0 || y === 0 || x === width - 1 || y === height - 1);
      const fringe = preset === "photo" && (x * 3 + y * 5) % 11 === 0;
      rgba[offset + 3] = border ? 0 : fringe ? 96 : 255;
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

function fixtureRgba(preset: TracePreset): Uint8Array {
  const decoded = readRgbaPng(fixturePng(preset));
  assert.notEqual(decoded, null);
  return decoded?.rgba ?? new Uint8Array();
}

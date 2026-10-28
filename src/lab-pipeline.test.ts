import * as childProcess from "node:child_process";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { controlsFor } from "./lab-model.ts";
import { buildLabRasterStages, CONTROL_STEPS, earliestChangedStep } from "./lab-pipeline.ts";
import { encodeRgbaPng, readRgbaPng } from "./png-alpha.ts";
import { createProgressReporter, type StepProgress } from "./progress.ts";
import { finishTrace, planTraceAsync, traceRaster, traceRasterWithControls, vectorStagesForPlan } from "./trace-pipeline.ts";
import { presetDefaults, resolveVtracer, vtracerArguments, type TracePreset, type TraceRequest } from "./trace.ts";

const PRESETS: readonly TracePreset[] = ["icon", "logo", "photo", "poster"];

test("default lab controls produce byte-identical SVG to sync and yielding panel pipelines", async () => {
  const binary = resolveVtracer(path.resolve("extension/bin", process.platform === "win32" ? "vtracer.exe" : "vtracer"));
  for (const preset of PRESETS) {
    const source = fixturePng(preset);
    const settings = { preset, ...presetDefaults(preset) };
    const controls = controlsFor(preset);
    const oldCalls: string[] = [];
    const labCalls: string[] = [];
    const asyncCalls: string[] = [];
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
    const progressEvents: StepProgress[] = [];
    const reporter = createProgressReporter("capture", (event) => progressEvents.push(event));
    reporter.report("capture", 1);
    const asyncPlan = await planTraceAsync(source, settings, controls, null, "colors", (step, fraction) => reporter.report(step, fraction));
    assert.notEqual(asyncPlan, null);
    reporter.report("trace", 0);
    const asyncSvgs = asyncPlan?.plates.map((plate) => trace(asyncCalls)(plate.png, plate.request)) ?? [];
    reporter.report("trace", 1);
    const asyncVectors = asyncPlan === null ? null : vectorStagesForPlan(asyncSvgs, asyncPlan, controls, reporter.report);
    reporter.finish();

    assert.equal(labOutput, panelOutput, preset + " SVG bytes changed");
    assert.equal(asyncVectors?.sealed, labOutput, preset + " async SVG bytes changed");
    assert.deepEqual(labCalls, oldCalls, preset + " VTracer inputs or arguments changed");
    assert.deepEqual(asyncCalls, labCalls, preset + " async VTracer inputs or arguments changed");
    assertProgressEvents(progressEvents, preset + " full run");
  }
});

test("controls map to their earliest stage and downstream runs reuse prior rasters", async () => {
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

  const image = fixturePng("photo");
  const settings = { preset: "photo" as const, ...presetDefaults("photo") };
  const fullEvents: StepProgress[] = [];
  const fullReporter = createProgressReporter("capture", (event) => fullEvents.push(event));
  fullReporter.report("capture", 1);
  const fullPlan = await planTraceAsync(image, settings, controls, null, "colors", (step, fraction) => fullReporter.report(step, fraction));
  assert.notEqual(fullPlan, null);
  fullReporter.report("trace", 0);
  fullReporter.report("trace", 1);
  if (fullPlan !== null) vectorStagesForPlan(["<svg/>"], fullPlan, controls, fullReporter.report);
  fullReporter.finish();
  assertProgressEvents(fullEvents, "full run");

  const middleEvents: StepProgress[] = [];
  const middleReporter = createProgressReporter("backdrop", (event) => middleEvents.push(event));
  const updatedControls = { ...controls, backdropSpread: controls.backdropSpread + 3 };
  const middlePlan = await planTraceAsync(image, settings, updatedControls, fullPlan?.rasterStages ?? null, "backdrop", (step, fraction) => middleReporter.report(step, fraction));
  assert.notEqual(middlePlan, null);
  middleReporter.report("trace", 0);
  middleReporter.report("trace", 1);
  if (middlePlan !== null) vectorStagesForPlan(["<svg/>"], middlePlan, updatedControls, middleReporter.report);
  middleReporter.finish();
  assertProgressEvents(middleEvents, "rerun from backdrop");
  assert.ok(middleEvents.every((event) => event.step !== "colors" && event.step !== "capture"), "middle rerun reported an earlier step");
});

test("yielding flat-color planning keeps SVG bytes and lets the event loop run", async () => {
  const width = 128;
  const height = 128;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const color = x < 58 ? [220, 60, 70] : x < 76 ? [40, 100, 190] : [245, 185, 50];
      rgba[offset] = color[0] ?? 0;
      rgba[offset + 1] = color[1] ?? 0;
      rgba[offset + 2] = color[2] ?? 0;
      rgba[offset + 3] = (x - 64) ** 2 + (y - 64) ** 2 < 52 ** 2 ? 255 : 0;
    }
  }
  const source = encodeRgbaPng(width, height, rgba);
  const controls = controlsFor("icon");
  const settings = { preset: "icon" as const, ...presetDefaults("icon") };
  const binary = resolveVtracer(path.resolve("extension/bin", process.platform === "win32" ? "vtracer.exe" : "vtracer"));
  const trace = (png: Buffer, request: TraceRequest): string => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vec-panel-yield-equality-"));
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
  const syncSvg = traceRasterWithControls(source, controls, trace);
  let timerTicks = 0;
  const timer = setInterval(() => { timerTicks += 1; }, 0);
  let asyncPlan: Awaited<ReturnType<typeof planTraceAsync>> = null;
  try {
    asyncPlan = await planTraceAsync(source, settings, controls);
  } finally {
    clearInterval(timer);
  }
  assert.ok(timerTicks > 0, "the fallback yielded to the event loop");
  assert.notEqual(asyncPlan, null);
  const asyncSvgs = asyncPlan?.plates.map((plate) => trace(plate.png, plate.request)) ?? [];
  const asyncSvg = asyncPlan === null ? null : finishTrace(asyncSvgs, asyncPlan, settings, controls);
  assert.equal(asyncSvg, syncSvg, "yielding SVG bytes changed");
});

test("yielding planning stops on cancellation before returning a preview plan", async () => {
  const width = 128;
  const height = 128;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = x < width / 2 ? 220 : 40;
      rgba[offset + 1] = y < height / 2 ? 60 : 100;
      rgba[offset + 2] = 70;
      rgba[offset + 3] = 255;
    }
  }
  let cancelled = false;
  const timer = setTimeout(() => { cancelled = true; }, 0);
  try {
    await assert.rejects(
      planTraceAsync(encodeRgbaPng(width, height, rgba), { preset: "icon", ...presetDefaults("icon") }, controlsFor("icon"), null, "colors", undefined, () => cancelled),
      /ยกเลิกแล้ว/
    );
  } finally {
    clearTimeout(timer);
  }
  assert.equal(cancelled, true, "cancellation was observed while planning");
});

function assertProgressEvents(events: readonly StepProgress[], label: string): void {
  assert.equal(events[0]?.percent, 0, label + " should start at 0%");
  assert.equal(events[events.length - 1]?.percent, 100, label + " should end at exactly 100%");
  for (let index = 1; index < events.length; index += 1) {
    assert.ok((events[index]?.percent ?? 0) >= (events[index - 1]?.percent ?? 0), label + " progress decreased at event " + String(index));
  }
}

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

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { controlsFor } from "../src/lab-model.ts";
import { buildLabRasterStages, fairLabVector, fitLabVector, sealLabVector } from "../src/lab-pipeline.ts";
import { encodeRgbaPng, readRgbaPng } from "../src/png-alpha.ts";
import { mergePlates } from "../src/trace-finish.ts";
import { planTrace, settingsFromControls, type TracePlan } from "../src/trace-pipeline.ts";
import { resolveVtracer, vtracerArguments } from "../src/trace.ts";

type ImageFixture = { readonly name: string; readonly preset: "icon" | "photo"; readonly png: Buffer; readonly width: number; readonly height: number; readonly rgba: Uint8Array };

async function main(): Promise<void> {
  const dockPath = path.resolve("fixtures/dock-icons.png");
  const dock = readRgbaPng(fs.readFileSync(dockPath));
  if (dock === null) throw new Error("Could not decode fixtures/dock-icons.png");
  const images: readonly ImageFixture[] = [
    { name: "512px icon", preset: "icon", ...iconFixture() },
    { name: "dock-icons.png", preset: "photo", png: fs.readFileSync(dockPath), width: dock.width, height: dock.height, rgba: dock.rgba }
  ];
  const binary = resolveVtracer(path.resolve("extension/bin", process.platform === "win32" ? "vtracer.exe" : "vtracer"));

  for (const image of images) {
    const controls = controlsFor(image.preset);
    const settings = settingsFromControls(controls);
    const captureMs = averageMs(() => image.rgba.slice());
    const rasterStarted = performance.now();
    const stages = buildLabRasterStages(image.rgba, image.width, image.height, controls);
    let colorsMs = performance.now() - rasterStarted;
    const backdropMs = averageMs(() => buildLabRasterStages(image.rgba, image.width, image.height, controls, stages, "backdrop"));
    const punchMs = averageMs(() => buildLabRasterStages(image.rgba, image.width, image.height, controls, stages, "punch"));

    const planStarted = performance.now();
    const plan = planTrace(image.png, settings, controls, stages, "trace");
    if (plan === null) throw new Error("Could not prepare " + image.name);
    const planMs = performance.now() - planStarted;
    if (controls.mode === "logo" || controls.mode === "icon") colorsMs += planMs;
    const traceStarted = performance.now();
    const svgs = await tracePlan(binary, image.name, plan);
    const traceMs = performance.now() - traceStarted;
    const traceSvg = mergePlates(svgs, plan.plates, plan.width, plan.height, null, false, false);
    const fitMs = averageMs(() => fitLabVector(traceSvg, controls, plan.droppedColor, plan.plates[0]?.borderColor ?? null));
    const fitted = fitLabVector(traceSvg, controls, plan.droppedColor, plan.plates[0]?.borderColor ?? null);
    const fairMs = averageMs(() => fairLabVector(fitted, controls));
    const faired = fairLabVector(fitted, controls);
    const sealMs = averageMs(() => sealLabVector(faired, controls));

    process.stdout.write(image.name + " · " + controls.mode + " · " + String(image.width) + "×" + String(image.height) + " · " + String(plan.plates.length) + " plate(s)\n");
    process.stdout.write("  capture " + format(captureMs) + " ms | colors " + format(colorsMs) + " ms | backdrop " + format(backdropMs) + " ms | punch " + format(punchMs) + " ms\n");
    process.stdout.write("  VTracer " + format(traceMs) + " ms | fit " + format(fitMs) + " ms | fair " + format(fairMs) + " ms | seal " + format(sealMs) + " ms\n");
  }
}

async function tracePlan(binary: string, label: string, plan: TracePlan): Promise<string[]> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vec-panel-bench-"));
  try {
    const svgs: string[] = [];
    for (let index = 0; index < plan.plates.length; index += 1) {
      const plate = plan.plates[index];
      if (plate === undefined) continue;
      const inputPath = path.join(directory, "input-" + String(index) + ".png");
      const outputPath = path.join(directory, "output-" + String(index) + ".svg");
      fs.writeFileSync(inputPath, plate.png);
      await runChild(binary, vtracerArguments(inputPath, outputPath, plate.request), label + " plate " + String(index + 1));
      svgs.push(fs.readFileSync(outputPath, "utf8"));
    }
    return svgs;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function runChild(binary: string, args: readonly string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(binary, [...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString("utf8").slice(0, 2000 - stderr.length);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(label + " failed: " + stderr.trim()));
    });
  });
}

function iconFixture(): Omit<ImageFixture, "name"> {
  const width = 512;
  const height = 512;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const inDisk = (x - 256) * (x - 256) + (y - 256) * (y - 256) < 205 * 205;
      const isCenter = x > 190 && x < 322 && y > 150 && y < 362;
      const isBase = x > 126 && x < 386 && y > 350 && y < 390;
      const color = isCenter ? [246, 188, 54] : isBase ? [45, 97, 184] : [222, 66, 72];
      rgba[offset] = color[0] ?? 0;
      rgba[offset + 1] = color[1] ?? 0;
      rgba[offset + 2] = color[2] ?? 0;
      rgba[offset + 3] = inDisk ? 255 : 0;
    }
  }
  return { png: encodeRgbaPng(width, height, rgba), width, height, rgba };
}

function averageMs(operation: () => unknown): number {
  const count = 3;
  let total = 0;
  for (let run = 0; run < count; run += 1) {
    const started = performance.now();
    operation();
    total += performance.now() - started;
  }
  return total / count;
}

function format(ms: number): string {
  return ms < 10 ? ms.toFixed(2) : ms.toFixed(1);
}

void main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});

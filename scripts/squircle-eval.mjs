#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fittedPlan, planTrace, styledTraceSvg } from "../src/trace-pipeline.ts";
import { presetDefaults, resolveVtracer, vtracerArguments } from "../src/trace.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputDirectory = path.join(root, ".eval/squircle/png");
const outputDirectory = path.join(root, ".eval/out");
const binary = resolveVtracer(path.join(root, "extension/bin", process.platform === "win32" ? "vtracer.exe" : "vtracer"));
const settings = { preset: "icon", ...presetDefaults("icon") };

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const inputs = (await readdir(inputDirectory)).filter((name) => name.endsWith(".png")).sort();
if (inputs.length === 0) throw new Error(`No PNG fixtures found in ${inputDirectory}`);

for (const [imageIndex, name] of inputs.entries()) {
  const match = /^(.+)-(\d+)-(.+)\.png$/.exec(name);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Unexpected fixture name: ${name}`);
  }
  const [, id, size, variant] = match;
  const plan = planTrace(await readFile(path.join(inputDirectory, name)), settings);
  if (plan === null || plan.plates.length === 0) throw new Error(`Could not plan trace for ${name}`);
  const svgs = [];
  for (const [plateIndex, plate] of plan.plates.entries()) {
    const prefix = `.trace-${process.pid}-${imageIndex}-${plateIndex}`;
    const pngPath = path.join(outputDirectory, `${prefix}.png`);
    const svgPath = path.join(outputDirectory, `${prefix}.svg`);
    await writeFile(pngPath, plate.png);
    try {
      await run(binary, [...vtracerArguments(pngPath, svgPath, plate.request)]);
      svgs.push(await readFile(svgPath, "utf8"));
    } finally {
      await Promise.all([rm(pngPath, { force: true }), rm(svgPath, { force: true })]);
    }
  }
  const fitted = fittedPlan(svgs, plan, settings.removeBackground, settings.preset);
  const svg = styledTraceSvg(fitted, settings);
  await writeFile(path.join(outputDirectory, `${id}__${size}-${variant}.svg`), svg);
  if ((imageIndex + 1) % 12 === 0 || imageIndex + 1 === inputs.length) {
    process.stdout.write(`Traced ${imageIndex + 1}/${inputs.length} PNGs\n`);
  }
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited ${code ?? signal}`));
    });
  });
}

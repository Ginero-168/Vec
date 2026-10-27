import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { encodeRgbaPng } from "./png-alpha.ts";
import { scoreSvg } from "./score.ts";
import { presetDefaults, vtracerArguments, type TraceRequest } from "./trace.ts";
import { traceRaster } from "./trace-pipeline.ts";

function vtracerBinary(): string {
  if (process.platform === "linux" && existsSync("/tmp/vtracer-linux")) return "/tmp/vtracer-linux";
  return path.join(process.cwd(), "extension", "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
}

test("the poster preset keeps multiple non-gray colors through final SVG output", () => {
  const width = 64;
  const height = 48;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba.set(x < width / 2 ? [230, 35, 45, 255] : [25, 70, 225, 255], offset);
    }
  }
  const settings = { preset: "poster" as const, ...presetDefaults("poster") };
  const directory = mkdtempSync(path.join(tmpdir(), "poster-pipeline-"));
  try {
    const finalSvg = traceRaster(encodeRgbaPng(width, height, rgba), settings, (png, request: TraceRequest) => {
      const inputPath = path.join(directory, "trace.png");
      const svgPath = path.join(directory, "trace.svg");
      writeFileSync(inputPath, png);
      const traced = spawnSync(vtracerBinary(), vtracerArguments(inputPath, svgPath, request), { encoding: "utf8", timeout: 30_000 });
      assert.equal(traced.error, undefined, traced.error?.message ?? "");
      assert.equal(traced.status, 0, traced.stderr.trim());
      return readFileSync(svgPath, "utf8");
    });
    assert.ok(finalSvg !== null);
    const parsed = scoreSvg(finalSvg ?? "");
    const nonGrayFills = parsed.palette.filter((fill) => {
      if (!/^#[0-9a-f]{6}$/i.test(fill)) return false;
      const red = Number.parseInt(fill.slice(1, 3), 16);
      const green = Number.parseInt(fill.slice(3, 5), 16);
      const blue = Number.parseInt(fill.slice(5, 7), 16);
      return red !== green || green !== blue;
    });
    assert.ok(parsed.paths >= 2, `Expected multiple traced shapes, found ${parsed.paths}`);
    assert.ok(new Set(nonGrayFills).size >= 2, `Expected at least two distinct non-gray path fills, found ${nonGrayFills.join(", ")}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

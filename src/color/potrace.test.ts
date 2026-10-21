import * as assert from "node:assert/strict";
import { test } from "node:test";
import { traceMask, type PotraceCommand } from "./potrace";

function rectangle(width: number, height: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * width + x] = 1;
  return mask;
}

function anchors(commands: readonly PotraceCommand[]): number {
  return commands.length;
}

test("a solid rectangle becomes four corners", () => {
  const mask = rectangle(60, 40, 4, 4, 56, 36);
  const paths = traceMask(mask, 60, 40);
  assert.equal(paths.length, 1);
  const path = paths[0];
  assert.ok(path);
  assert.ok(anchors(path.commands) <= 6, "anchors " + anchors(path.commands));
  const lines = path.commands.filter((command) => command.op === "L");
  assert.ok(lines.length >= 4, "lines " + lines.length);
});

test("a diagonal staircase collapses to a thin polygon", () => {
  const width = 40;
  const height = 40;
  const mask = new Uint8Array(width * height);
  for (let i = 2; i < 34; i++) {
    mask[i * width + i] = 1;
    mask[i * width + i + 1] = 1;
    mask[(i + 1) * width + i] = 1;
  }
  const paths = traceMask(mask, width, height);
  assert.ok(paths.length >= 1);
  const nodes = paths.reduce((sum, path) => sum + path.commands.length, 0);
  assert.ok(nodes <= 16, "staircase anchors " + nodes);
});

test("a disk is a smooth outline close to the circle", () => {
  const width = 48;
  const height = 48;
  const mask = new Uint8Array(width * height);
  const radius = 16;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x + 0.5 - 24, y + 0.5 - 24) <= radius) mask[y * width + x] = 1;
    }
  }
  const paths = traceMask(mask, width, height);
  assert.equal(paths.length, 1);
  const path = paths[0];
  assert.ok(path);
  assert.ok(path.commands.length <= 12, "circle anchors " + path.commands.length);
  let worst = 0;
  let x = path.start.x;
  let y = path.start.y;
  const consider = (px: number, py: number) => {
    worst = Math.max(worst, Math.abs(Math.hypot(px - 24, py - 24) - radius));
  };
  consider(x, y);
  for (const command of path.commands) {
    if (command.op === "C") {
      for (let step = 1; step <= 4; step++) {
        const t = step / 4;
        const u = 1 - t;
        consider(
          u * u * u * x + 3 * u * u * t * command.x1 + 3 * u * t * t * command.x2 + t * t * t * command.x,
          u * u * u * y + 3 * u * u * t * command.y1 + 3 * u * t * t * command.y2 + t * t * t * command.y
        );
      }
    }
    x = command.x;
    y = command.y;
    consider(x, y);
  }
  assert.ok(worst < 1.25, "radius error " + worst.toFixed(3));
});

test("a ring keeps its hole", () => {
  const width = 32;
  const height = 32;
  const mask = rectangle(width, height, 4, 4, 28, 28);
  for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) mask[y * width + x] = 0;
  const paths = traceMask(mask, width, height);
  assert.equal(paths.length, 2, "paths " + paths.length);
});

"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/pipeline-worker.ts
var import_node_worker_threads = require("node:worker_threads");

// src/color.ts
function srgbChannelToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function linearChannelToSrgb(channel) {
  const value = Math.min(1, Math.max(0, channel));
  const encoded = value <= 31308e-7 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}
function rgbToOklab(color) {
  const red = srgbChannelToLinear(color.r);
  const green = srgbChannelToLinear(color.g);
  const blue = srgbChannelToLinear(color.b);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  };
}
function oklabToRgb(color) {
  const l = color.L + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const m = color.L - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const s = color.L - 0.0894841775 * color.a - 1.291485548 * color.b;
  const lp = l * l * l;
  const mp = m * m * m;
  const sp = s * s * s;
  return {
    r: linearChannelToSrgb(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp),
    g: linearChannelToSrgb(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp),
    b: linearChannelToSrgb(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp)
  };
}
function labDistance2(left, right) {
  const dL = left.L - right.L;
  const da = left.a - right.a;
  const db = left.b - right.b;
  return dL * dL + da * da + db * db;
}

// src/flat-trace.ts
var UP = 8;
var CORE_TAU = 0.035;
var REGION_TOLERANCE = 0.06;
var COLOR_FLOOR = 0.035;
var OWN_COLOR = 0.05;
var DILATE_RADIUS = 3;
var SPECK_SOURCE = 1.44;
var SMOOTH_SOURCE = 0.6;
var K_MAX = 16;
function identityRaster(rgba, _width, _height) {
  return rgba;
}
function flatPlates(rgba, width, height, maxColors, preprocess = identityRaster, onProgress) {
  const boxes = subjectBoxes(rgba, width, height, (fraction) => onProgress?.(fraction * 0.04));
  onProgress?.(0.04);
  return boxes.map((box, index) => plateFor(rgba, width, height, box, maxColors, preprocess, (fraction) => onProgress?.(0.04 + (index + fraction) / boxes.length * 0.96)));
}
function subjectBoxes(rgba, width, height, onProgress) {
  const found = enclosedBoxes(rgba, width, height, onProgress);
  if (found.length <= 1) return [{ x: 0, y: 0, width, height }];
  return found;
}
function plateFor(rgba, width, height, box, maxColors, preprocess, onProgress) {
  const cropW = box.width;
  const cropH = box.height;
  const crop = new Uint8Array(cropW * cropH * 4);
  for (let y = 0; y < cropH; y += 1) {
    const from = ((box.y + y) * width + box.x) * 4;
    crop.set(rgba.subarray(from, from + cropW * 4), y * cropW * 4);
  }
  const painted = labelImage(crop, cropW, cropH, maxColors, preprocess, onProgress);
  return {
    rgba: painted.rgba,
    width: painted.width,
    height: painted.height,
    scale: UP,
    palette: painted.palette,
    originX: box.x,
    originY: box.y,
    sourceWidth: cropW,
    sourceHeight: cropH,
    borderColor: cornerColor(crop, cropW, cropH),
    cutOut: hasClearPixel(crop)
  };
}
function hasClearPixel(rgba) {
  for (let offset = 3; offset < rgba.length; offset += 4) if ((rgba[offset] ?? 0) <= CLEAR_OPACITY) return true;
  return false;
}
function cornerColor(rgba, width, height) {
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1]
  ];
  const opaque = [];
  for (const point of points) {
    const x = point[0] ?? 0;
    const y = point[1] ?? 0;
    const offset = (y * width + x) * 4;
    if ((rgba[offset + 3] ?? 0) < 250) return null;
    opaque.push({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
  }
  if (opaque.length === 0) return null;
  const mean = {
    r: opaque.reduce((sum, color) => sum + color.r, 0) / opaque.length,
    g: opaque.reduce((sum, color) => sum + color.g, 0) / opaque.length,
    b: opaque.reduce((sum, color) => sum + color.b, 0) / opaque.length
  };
  for (const color of opaque) {
    if (Math.abs(color.r - mean.r) > 18 || Math.abs(color.g - mean.g) > 18 || Math.abs(color.b - mean.b) > 18) return null;
  }
  return hex(Math.round(mean.r), Math.round(mean.g), Math.round(mean.b));
}
function labelImage(rgba, width, height, maxColors, preprocess = identityRaster, onProgress) {
  const prepared = preprocess(rgba, width, height);
  const source = prepared.length === rgba.length ? prepared : rgba;
  const count = width * height;
  const lab = new Float64Array(count * 3);
  const linear = new Float64Array(count * 3);
  const alpha = new Uint8Array(count);
  const opacity = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const color = { r: source[offset] ?? 0, g: source[offset + 1] ?? 0, b: source[offset + 2] ?? 0 };
    opacity[index] = source[offset + 3] ?? 0;
    alpha[index] = (opacity[index] ?? 0) >= 128 ? 255 : 0;
    const converted = rgbToOklab(color);
    lab[index * 3] = converted.L;
    lab[index * 3 + 1] = converted.a;
    lab[index * 3 + 2] = converted.b;
    linear[index * 3] = srgbToLinear(color.r);
    linear[index * 3 + 1] = srgbToLinear(color.g);
    linear[index * 3 + 2] = srgbToLinear(color.b);
    if (index % Math.max(1, width * 2) === 0) onProgress?.(0.04 * index / count);
  }
  let core = coreMask(lab, alpha, width, height, CORE_TAU, (fraction) => onProgress?.(0.04 + fraction * 0.1));
  if (countOf(core) < 8) core = coreMask(lab, alpha, width, height, 0.08, (fraction) => onProgress?.(0.14 + fraction * 0.1));
  const userK = maxColors > 0 ? Math.min(K_MAX, Math.max(2, Math.round(maxColors))) : 0;
  const centers = recoverThinColors(lab, alpha, core, width, height, buildPalette(lab, core, width, height, userK, (fraction) => onProgress?.(0.24 + fraction * 0.08)));
  const labels = assignLabels(linear, lab, core, alpha, opacity, width, height, centers, (fraction) => onProgress?.(0.32 + fraction * 0.54));
  const colors = fillColors(source, alpha, core, labels, width, height, centers, (fraction) => onProgress?.(0.86 + fraction * 0.02));
  const painted = paintLabels(labels, colors, width * UP, height * UP, (fraction) => onProgress?.(0.88 + fraction * 0.12));
  onProgress?.(1);
  return painted;
}
function assignLabels(linear, lab, core, alpha, opacity, width, height, centers, onProgress) {
  const count = width * height;
  const kCount = centers.length;
  const coreLabel = new Int16Array(count);
  coreLabel.fill(-1);
  for (let index = 0; index < count; index += 1) {
    if (core[index] !== 1) continue;
    coreLabel[index] = nearestLab(readLab(lab, index), centers);
    if (index % 16384 === 0) onProgress?.(0.12 * index / count);
  }
  const allow = new Uint16Array(count);
  const disk = diskOffsets(DILATE_RADIUS);
  for (let index = 0; index < count; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label < 0) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (const offset of disk) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      allow[at] = (allow[at] ?? 0) | 1 << label;
    }
    if (index % 16384 === 0) onProgress?.(0.12 + 0.16 * index / count);
  }
  const square = squareOffsets(1);
  for (let index = 0; index < count; index += 1) {
    if (alpha[index] === 0) continue;
    const color = readLab(lab, index);
    let near = 0;
    for (let label = 0; label < kCount; label += 1) {
      const center = centers[label];
      if (center === void 0) continue;
      if (Math.sqrt(labDistance2(color, center)) >= OWN_COLOR) continue;
      near |= 1 << label;
    }
    if (near === 0) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (const offset of square) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      allow[at] = (allow[at] ?? 0) | near;
    }
    if (index % 16384 === 0) onProgress?.(0.28 + 0.16 * index / count);
  }
  const nearestCore = nearestCoreLabel(coreLabel, width, height, (fraction) => onProgress?.(0.44 + fraction * 0.14));
  for (let index = 0; index < count; index += 1) {
    if ((allow[index] ?? 0) !== 0) continue;
    const label = nearestCore[index] ?? -1;
    if (label >= 0) allow[index] = 1 << label;
    if (index % 16384 === 0) onProgress?.(0.58 + 0.07 * index / count);
  }
  const upW = width * UP;
  const upH = height * UP;
  const labels = new Uint8Array(upW * upH);
  labels.fill(255);
  const tile = 48;
  for (let y0 = 0; y0 < height; y0 += tile) {
    const y1 = Math.min(height, y0 + tile);
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x] === 0) continue;
        const mask = allow[y * width + x] ?? 0;
        const bits = bitList(mask, kCount);
        for (let oy = 0; oy < UP; oy += 1) {
          for (let ox = 0; ox < UP; ox += 1) {
            const ux = x * UP + ox;
            const uy = y * UP + oy;
            const at = uy * upW + ux;
            if (bits.length === 0) continue;
            if (bits.length === 1) {
              labels[at] = bits[0] ?? 0;
              continue;
            }
            const sample = bicubicLab(linear, width, height, (ux + 0.5) / UP - 0.5, (uy + 0.5) / UP - 0.5);
            labels[at] = explain(sample, bits, centers);
          }
        }
      }
      onProgress?.(0.65 + 0.12 * (y + 1) / height);
    }
  }
  cleanLabels(labels, upW, upH, kCount, Math.floor(SPECK_SOURCE * UP * UP), (fraction) => onProgress?.(0.77 + fraction * 0.09));
  smoothLabels(labels, upW, upH, kCount, SMOOTH_SOURCE * UP, (fraction) => onProgress?.(0.86 + fraction * 0.1));
  cutTransparent(labels, opacity, width, height);
  onProgress?.(1);
  return labels;
}
var SOLID_OPACITY = 250;
var CLEAR_OPACITY = 5;
var THIN_BEND = 64;
var AXIS_SNAP = 20 * Math.PI / 180;
var AXIS_SNAP_NEAR = 30 * Math.PI / 180;
var AXIS_FLAT = 3 * Math.PI / 180;
var CORNER_SLACK = 0.1;
var CORNER_TILT = 20 * Math.PI / 180;
function planeOffset(nx, ny, area) {
  const steps = 16;
  const covered = (limit) => {
    let count = 0;
    for (let j = 0; j < steps; j += 1) {
      for (let i = 0; i < steps; i += 1) if (nx * ((i + 0.5) / steps - 0.5) + ny * ((j + 0.5) / steps - 0.5) >= limit) count += 1;
    }
    return count / (steps * steps);
  };
  let low = -1;
  let high = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const middle = (low + high) / 2;
    if (covered(middle) > area) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
function thinShape(level, bendX, bendY) {
  const mask = new Uint8Array(UP * UP);
  const alongX = Math.abs(bendX) >= Math.abs(bendY);
  const bend = alongX ? bendX : bendY;
  const coverage = level / 255;
  for (let cell = 0; cell < mask.length; cell += 1) {
    const across = Math.abs(((alongX ? cell % UP : Math.floor(cell / UP)) + 0.5) / UP - 0.5);
    if (level >= 128) mask[cell] = 1;
    else if (bend < -THIN_BEND) mask[cell] = across <= coverage / 2 ? 1 : 0;
    else if (bend > THIN_BEND) mask[cell] = across >= (1 - coverage) / 2 ? 1 : 0;
    else mask[cell] = 0;
  }
  return mask;
}
function edgeShapes(opacity, width, height, normalX, normalY) {
  const partial = (index) => (opacity[index] ?? 0) > CLEAR_OPACITY && (opacity[index] ?? 0) < SOLID_OPACITY && ((normalX[index] ?? 0) !== 0 || (normalY[index] ?? 0) !== 0);
  const offsets = /* @__PURE__ */ new Map();
  const offset = (index) => {
    const known = offsets.get(index);
    if (known !== void 0) return known;
    const value = planeOffset(normalX[index] ?? 0, normalY[index] ?? 0, (opacity[index] ?? 0) / 255);
    offsets.set(index, value);
    return value;
  };
  const shapes = /* @__PURE__ */ new Map();
  const cells = UP * UP;
  const read = (x, y) => opacity[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] ?? 0;
  const corners = [];
  const thin = [];
  const reliable = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!partial(index)) continue;
      for (let dy = -1; dy <= 1 && reliable[index] === 0; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx0 = x + dx, ny0 = y + dy;
          if (dx === 0 && dy === 0 || nx0 < 0 || ny0 < 0 || nx0 >= width || ny0 >= height) continue;
          const other = ny0 * width + nx0;
          if (partial(other) && (normalX[other] ?? 0) * (normalX[index] ?? 0) + (normalY[other] ?? 0) * (normalY[index] ?? 0) >= Math.cos(CORNER_TILT)) {
            reliable[index] = 1;
            break;
          }
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const level = opacity[index] ?? 0;
      if (level > CLEAR_OPACITY && level < SOLID_OPACITY && !partial(index)) {
        shapes.set(index, thinShape(level, read(x - 1, y) + read(x + 1, y) - 2 * level, read(x, y - 1) + read(x, y + 1) - 2 * level));
        thin.push(index);
        continue;
      }
      if (!partial(index)) continue;
      const lines = [];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx0 = x + dx, ny0 = y + dy;
          if (nx0 < 0 || ny0 < 0 || nx0 >= width || ny0 >= height) continue;
          const other = ny0 * width + nx0;
          if (!partial(other) || (dx !== 0 || dy !== 0) && reliable[other] !== 1) continue;
          const nx = normalX[other] ?? 0, ny = normalY[other] ?? 0, limit = offset(other);
          const mask = new Uint8Array(cells);
          for (let cell = 0; cell < cells; cell += 1) {
            const u = (cell % UP + 0.5) / UP - 0.5 - dx, v = (Math.floor(cell / UP) + 0.5) / UP - 0.5 - dy;
            mask[cell] = nx * u + ny * v >= limit ? 1 : 0;
          }
          if (dx === 0 && dy === 0) lines.unshift({ nx, ny, mask });
          else lines.push({ nx, ny, mask });
        }
      }
      const target = (opacity[index] ?? 0) / 255;
      const coverage = (mask) => mask.reduce((sum, value) => sum + value, 0) / cells;
      const own = lines[0];
      let best = own?.mask ?? new Uint8Array(cells);
      const neighbours = lines.slice(1);
      if (own !== void 0 && neighbours.length > 0 && reliable[index] !== 1) {
        let bestError = Number.POSITIVE_INFINITY;
        const consider = (mask) => {
          const error = Math.abs(coverage(mask) - target);
          if (error <= CORNER_SLACK && error < bestError) {
            best = mask;
            bestError = error;
          }
        };
        for (let a = 0; a < neighbours.length; a += 1) {
          for (let b = a + 1; b < neighbours.length; b += 1) {
            const left = neighbours[a], right = neighbours[b];
            if (left === void 0 || right === void 0 || left.nx * right.nx + left.ny * right.ny > Math.cos(CORNER_TILT)) continue;
            consider(left.mask.map((value, cell) => value & (right.mask[cell] ?? 0)));
            consider(left.mask.map((value, cell) => value | (right.mask[cell] ?? 0)));
          }
        }
        if (bestError === Number.POSITIVE_INFINITY) for (const line of neighbours) consider(line.mask);
      }
      shapes.set(index, best);
      if (reliable[index] !== 1) corners.push(index);
    }
  }
  const zone = new Set(thin);
  for (const index of corners) {
    const x = index % width;
    const y = (index - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx0 = x + dx, ny0 = y + dy;
        if (nx0 >= 0 && ny0 >= 0 && nx0 < width && ny0 < height) zone.add(ny0 * width + nx0);
      }
    }
  }
  for (const index of [...shapes.keys()]) if (!zone.has(index)) shapes.delete(index);
  return shapes;
}
function cutTransparent(labels, opacity, width, height) {
  if (opacity.every((value) => value === 255)) return;
  const upW = width * UP;
  const upH = height * UP;
  const read = (x, y) => opacity[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] ?? 0;
  const normalX = new Float64Array(width * height);
  const normalY = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const own = opacity[y * width + x] ?? 0;
      if (own <= CLEAR_OPACITY || own >= SOLID_OPACITY) continue;
      const gx = read(x + 1, y - 1) + 2 * read(x + 1, y) + read(x + 1, y + 1) - read(x - 1, y - 1) - 2 * read(x - 1, y) - read(x - 1, y + 1);
      const gy = read(x - 1, y + 1) + 2 * read(x, y + 1) + read(x + 1, y + 1) - read(x - 1, y - 1) - 2 * read(x, y - 1) - read(x + 1, y - 1);
      const length = Math.hypot(gx, gy);
      if (length === 0) continue;
      const stepX = Math.round(gx / length), stepY = Math.round(gy / length);
      const ahead = read(x + stepX, y + stepY), behind = read(x - stepX, y - stepY);
      if (ahead - behind < 96 || ahead < own - 8 || behind > own + 8) continue;
      const solid = (dx, dy) => read(x + dx, y + dy) >= SOLID_OPACITY;
      const across = (dx, dy) => solid(dx, dy) && solid(-dx, -dy) && !solid(dy, dx) && !solid(-dy, -dx);
      if (across(1, 0) || across(0, 1)) continue;
      normalX[y * width + x] = gx / length;
      normalY[y * width + x] = gy / length;
    }
  }
  const tiltOf = (index) => {
    const nx = normalX[index] ?? 0, ny = normalY[index] ?? 0;
    return Math.atan2(Math.min(Math.abs(nx), Math.abs(ny)), Math.max(Math.abs(nx), Math.abs(ny)));
  };
  const axisOf = (index, limit = AXIS_SNAP) => {
    const nx = normalX[index] ?? 0, ny = normalY[index] ?? 0;
    if (nx === 0 && ny === 0) return 0;
    if (tiltOf(index) > limit) return 0;
    return Math.abs(nx) >= Math.abs(ny) ? nx > 0 ? 1 : 2 : ny > 0 ? 3 : 4;
  };
  const flat = (index, axis) => {
    const nx = normalX[index] ?? 0, ny = normalY[index] ?? 0;
    return axisOf(index) === axis && Math.min(Math.abs(nx), Math.abs(ny)) <= Math.sin(AXIS_FLAT);
  };
  const snapped = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const axis = axisOf(index, AXIS_SNAP_NEAR);
      if (axis === 0) continue;
      const alongX = axis <= 2 ? 0 : 1, alongY = axis <= 2 ? 1 : 0;
      let anchored = false;
      const junction = tiltOf(index) > AXIS_SNAP;
      for (const step of junction ? [-1, 1] : [-2, -1, 0, 1, 2]) {
        const nx = x + step * alongX, ny = y + step * alongY;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (junction && read(x - step * alongX, y - step * alongY) >= (opacity[index] ?? 0)) continue;
        if (flat(ny * width + nx, axis)) anchored = true;
      }
      if (anchored) snapped.push(index, axis);
    }
  }
  for (let at = 0; at < snapped.length; at += 2) {
    const index = snapped[at] ?? 0, axis = snapped[at + 1] ?? 0;
    normalX[index] = axis === 1 ? 1 : axis === 2 ? -1 : 0;
    normalY[index] = axis === 3 ? 1 : axis === 4 ? -1 : 0;
  }
  const shape = edgeShapes(opacity, width, height, normalX, normalY);
  let pending = [];
  for (let uy = 0; uy < upH; uy += 1) {
    const sy = (uy + 0.5) / UP - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let ux = 0; ux < upW; ux += 1) {
      const sx = (ux + 0.5) / UP - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const top = read(x0, y0) * (1 - fx) + read(x0 + 1, y0) * fx;
      const bottom = read(x0, y0 + 1) * (1 - fx) + read(x0 + 1, y0 + 1) * fx;
      const at = uy * upW + ux;
      const ownIndex = Math.floor(uy / UP) * width + Math.floor(ux / UP);
      const own = opacity[ownIndex] ?? 0;
      let inside;
      if (own >= SOLID_OPACITY) inside = true;
      else if (own <= CLEAR_OPACITY) inside = false;
      else {
        const mask = shape.get(ownIndex);
        inside = mask === void 0 ? top * (1 - fy) + bottom * fy >= 128 : mask[uy % UP * UP + ux % UP] === 1;
      }
      if (!inside) labels[at] = 255;
      else if (labels[at] === 255) pending.push(at);
    }
  }
  while (pending.length > 0) {
    const assigned = [];
    const waiting = [];
    for (const at of pending) {
      const x = at % upW;
      const neighbours = [x > 0 ? at - 1 : -1, x < upW - 1 ? at + 1 : -1, at - upW, at + upW];
      const from = neighbours.find((next) => next >= 0 && next < labels.length && labels[next] !== 255);
      if (from === void 0) waiting.push(at);
      else assigned.push(at, labels[from] ?? 0);
    }
    if (assigned.length === 0) break;
    for (let index = 0; index < assigned.length; index += 2) labels[assigned[index] ?? 0] = assigned[index + 1] ?? 0;
    pending = waiting;
  }
}
function nearestCoreLabel(coreLabel, width, height, onProgress) {
  const nearest2 = new Int16Array(coreLabel.length);
  nearest2.fill(-1);
  const queue = [];
  for (let index = 0; index < coreLabel.length; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label < 0) continue;
    nearest2[index] = label;
    queue.push(index);
    if (index % 16384 === 0) onProgress?.(0.4 * index / coreLabel.length);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const label = nearest2[index] ?? -1;
    const x = index % width;
    const y = (index - x) / width;
    const steps = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const step of steps) {
      const nx = step[0] ?? 0;
      const ny = step[1] ?? 0;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      if ((nearest2[at] ?? -1) >= 0) continue;
      nearest2[at] = label;
      queue.push(at);
    }
    if (cursor % 4096 === 0) onProgress?.(0.4 + 0.6 * cursor / Math.max(1, queue.length));
  }
  onProgress?.(1);
  return nearest2;
}
function explain(sample, bits, centers) {
  let best = bits[0] ?? 0;
  let bestDistance = Infinity;
  for (const label of bits) {
    const center = centers[label];
    if (center === void 0) continue;
    const distance = Math.sqrt(labDistance2(sample, center));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = label;
    }
  }
  for (let left = 0; left < bits.length; left += 1) {
    for (let right = left + 1; right < bits.length; right += 1) {
      const a = bits[left];
      const b = bits[right];
      if (a === void 0 || b === void 0) continue;
      const first = centers[a];
      const second = centers[b];
      if (first === void 0 || second === void 0) continue;
      const projected = projectLab(sample, first, second);
      if (projected.distance < bestDistance) {
        bestDistance = projected.distance;
        best = projected.t < 0.5 ? a : b;
      }
    }
  }
  return best;
}
function fillColors(rgba, alpha, core, labels, width, height, centers, onProgress) {
  const sums = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
  const upW = width * UP;
  const mid = UP >> 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0 || core[index] !== 1) continue;
      const label = labels[(y * UP + mid) * upW + x * UP + mid] ?? 255;
      const bin = sums[label];
      if (bin === void 0) continue;
      const offset = index * 4;
      bin.r += rgba[offset] ?? 0;
      bin.g += rgba[offset + 1] ?? 0;
      bin.b += rgba[offset + 2] ?? 0;
      bin.n += 1;
    }
    onProgress?.((y + 1) / height);
  }
  return centers.map((center, index) => {
    const bin = sums[index];
    if (bin !== void 0 && bin.n > 4) return { r: Math.round(bin.r / bin.n), g: Math.round(bin.g / bin.n), b: Math.round(bin.b / bin.n) };
    return oklabToRgb(center);
  });
}
function paintLabels(labels, colors, width, height, onProgress) {
  const used = /* @__PURE__ */ new Map();
  const palette = [];
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < labels.length; index += 1) {
    if (index % 16384 === 0) onProgress?.(index / labels.length);
    const label = labels[index] ?? 255;
    if (label === 255) continue;
    let slot = used.get(label);
    if (slot === void 0) {
      const color2 = colors[label] ?? { r: 0, g: 0, b: 0 };
      const paint = hex(color2.r, color2.g, color2.b);
      slot = palette.indexOf(paint);
      if (slot < 0) {
        slot = palette.length;
        palette.push(paint);
      }
      used.set(label, slot);
    }
    const color = colors[label] ?? { r: 0, g: 0, b: 0 };
    const offset = index * 4;
    rgba[offset] = color.r;
    rgba[offset + 1] = color.g;
    rgba[offset + 2] = color.b;
    rgba[offset + 3] = 255;
  }
  onProgress?.(1);
  return { rgba, width, height, palette };
}
var THIN_TAU = 0.07;
var THIN_MIN = 3;
var BLEND_TOLERANCE = 0.03;
var THIN_DISTANCE = 0.1;
var EDGE_BLEND = 0.06;
function recoverThinColors(lab, alpha, core, width, height, centers) {
  const limit = THIN_TAU * THIN_TAU;
  const groups = /* @__PURE__ */ new Map();
  const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const betweenCenters = (color, x, y, px, py) => {
    for (let reach = 1; reach <= 2; reach += 1) {
      const ax = x + px * reach, ay = y + py * reach, bx = x - px * reach, by = y - py * reach;
      if (ax < 0 || ay < 0 || bx < 0 || by < 0 || ax >= width || bx >= width || ay >= height || by >= height) continue;
      const a = ay * width + ax, b = by * width + bx;
      if (alpha[a] === 0 || alpha[b] === 0) continue;
      const left = centers[nearestLab(readLab(lab, a), centers)] ?? zeroLab();
      const right = centers[nearestLab(readLab(lab, b), centers)] ?? zeroLab();
      if (labDistance2(left, right) === 0) continue;
      const mix = projectLab(color, left, right);
      if (mix.t > 0.1 && mix.t < 0.9 && mix.distance <= EDGE_BLEND) return true;
    }
    return false;
  };
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0 || core[index] === 1) continue;
      const color = readLab(lab, index);
      const alongStroke = axes.some(([dx, dy]) => {
        const before = (y - (dy ?? 0)) * width + x - (dx ?? 0);
        const after = (y + (dy ?? 0)) * width + x + (dx ?? 0);
        if (alpha[before] === 0 || alpha[after] === 0 || labDistance2(color, readLab(lab, before)) >= limit || labDistance2(color, readLab(lab, after)) >= limit) return false;
        const side = (y + (dx ?? 0)) * width + x - (dy ?? 0);
        const other = (y - (dx ?? 0)) * width + x + (dy ?? 0);
        if (alpha[side] === 0 || alpha[other] === 0) return true;
        const across = projectLab(color, readLab(lab, side), readLab(lab, other));
        if (across.t > 0.15 && across.t < 0.85 && across.distance <= BLEND_TOLERANCE) return false;
        return !betweenCenters(color, x, y, dy ?? 0, -(dx ?? 0));
      });
      if (!alongStroke) continue;
      const key = (Math.round(color.L / 0.05) + 40) * 1e4 + (Math.round(color.a / 0.05) + 40) * 100 + (Math.round(color.b / 0.05) + 40);
      const list = groups.get(key);
      if (list === void 0) groups.set(key, [color]);
      else list.push(color);
    }
  }
  const result = [...centers];
  const explained = (color) => result.some((center) => Math.sqrt(labDistance2(color, center)) <= THIN_DISTANCE);
  const ordered = [...groups.values()].filter((list) => list.length >= THIN_MIN).sort((left, right) => right.length - left.length);
  for (const list of ordered) {
    if (result.length >= K_MAX) break;
    const kept = list.filter((color) => !explained(color));
    if (kept.length < THIN_MIN) continue;
    const mean = kept.reduce((sum, color) => ({ L: sum.L + color.L / kept.length, a: sum.a + color.a / kept.length, b: sum.b + color.b / kept.length }), zeroLab());
    if (explained(mean)) continue;
    result.push(mean);
  }
  return result;
}
function buildPalette(lab, core, width, height, userK, onProgress) {
  const bins = /* @__PURE__ */ new Map();
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const color = readLab(lab, index);
    const key = Math.round(color.L / 8e-3) + "," + Math.round(color.a / 8e-3) + "," + Math.round(color.b / 8e-3);
    const bin = bins.get(key) ?? { x: 0, y: 0, z: 0, n: 0 };
    bin.x += color.L;
    bin.y += color.a;
    bin.z += color.b;
    bin.n += 1;
    bins.set(key, bin);
    if (index % 16384 === 0) onProgress?.(0.35 * index / core.length);
  }
  const samples = [];
  const weights = [];
  for (const bin of bins.values()) {
    if (bin.n === 0) continue;
    samples.push({ L: bin.x / bin.n, a: bin.y / bin.n, b: bin.z / bin.n });
    weights.push(Math.log1p(bin.n));
  }
  if (samples.length === 0) return [{ L: 0, a: 0, b: 0 }];
  const regions = regionMeans(lab, core, width, height, (fraction) => onProgress?.(0.35 + fraction * 0.4));
  const anchors = distinctAnchors(regions);
  onProgress?.(0.75);
  const floorK = Math.max(2, anchors.length);
  if (userK > 0) return wkmeans(samples, weights, Math.min(K_MAX, Math.max(userK, anchors.length)), anchors, (fraction) => onProgress?.(0.75 + fraction * 0.25));
  if (regions.length === 0) return wkmeans(samples, weights, Math.min(K_MAX, Math.max(2, Math.min(8, samples.length))), [], (fraction) => onProgress?.(0.75 + fraction * 0.25));
  let chosen = wkmeans(samples, weights, Math.min(floorK, samples.length), anchors, (fraction) => onProgress?.(0.75 + fraction * 0.1));
  for (let k = floorK; k <= Math.min(K_MAX, Math.max(samples.length, anchors.length)); k += 1) {
    chosen = wkmeans(samples, weights, k, anchors, (fraction) => onProgress?.(0.85 + fraction * 0.15));
    const missed = regions.some((region) => chosen.every((center) => Math.sqrt(labDistance2(center, region.mean)) > REGION_TOLERANCE));
    if (!missed) return chosen;
  }
  return chosen;
}
function distinctAnchors(regions) {
  const ordered = [...regions].sort((left, right) => right.size - left.size);
  const kept = [];
  for (const region of ordered) {
    if (kept.length >= K_MAX) break;
    if (kept.every((color) => Math.sqrt(labDistance2(color, region.mean)) > COLOR_FLOOR)) kept.push({ ...region.mean });
  }
  return kept;
}
function regionMeans(lab, core, width, height, onProgress) {
  const groups = /* @__PURE__ */ new Map();
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const color = readLab(lab, index);
    const key = (Math.round(color.L / 0.05) + 40) * 1e4 + (Math.round(color.a / 0.05) + 40) * 100 + (Math.round(color.b / 0.05) + 40);
    const list = groups.get(key);
    if (list === void 0) groups.set(key, [index]);
    else list.push(index);
    if (index % 16384 === 0) onProgress?.(0.35 * index / core.length);
  }
  const means = [];
  for (const pixels of groups.values()) {
    const member = new Uint8Array(core.length);
    for (const index of pixels) member[index] = 1;
    const labeled = components(member, width, height, (fraction) => onProgress?.(0.35 + 0.35 * fraction));
    for (let id = 1; id <= labeled.count; id += 1) {
      const size = labeled.sizes[id] ?? 0;
      if (size < 12) continue;
      let l = 0;
      let a = 0;
      let b = 0;
      const values = [];
      for (let index = 0; index < member.length; index += 1) {
        if ((labeled.ids[index] ?? 0) !== id) continue;
        const color = readLab(lab, index);
        values.push(color);
        l += color.L;
        a += color.a;
        b += color.b;
      }
      const n = values.length;
      if (n === 0) continue;
      const mean = { L: l / n, a: a / n, b: b / n };
      let varL = 0;
      let varA = 0;
      let varB = 0;
      for (const color of values) {
        varL += (color.L - mean.L) ** 2;
        varA += (color.a - mean.a) ** 2;
        varB += (color.b - mean.b) ** 2;
      }
      const spread = Math.max(Math.sqrt(varL / n), Math.sqrt(varA / n), Math.sqrt(varB / n));
      if (spread < 0.015) means.push({ mean, size });
    }
  }
  onProgress?.(1);
  return means;
}
function wkmeans(samples, weights, kCount, frozen = [], onProgress) {
  const count = samples.length;
  const pinned = Math.min(frozen.length, K_MAX);
  const k = Math.max(1, Math.min(K_MAX, Math.max(kCount, pinned, count === 0 ? pinned : 1)));
  const centers = [];
  for (let index = 0; index < pinned && centers.length < k; index += 1) {
    const seed = frozen[index] ?? zeroLab();
    centers.push({ L: seed.L, a: seed.a, b: seed.b });
  }
  if (count === 0) return centers.length > 0 ? centers : [{ L: 0, a: 0, b: 0 }];
  const distance = new Float64Array(count);
  if (centers.length === 0) {
    let first = 0;
    let bestWeight = -1;
    for (let index = 0; index < count; index += 1) {
      const weight = weights[index] ?? 0;
      if (weight > bestWeight) {
        bestWeight = weight;
        first = index;
      }
    }
    centers.push({ ...samples[first] ?? zeroLab() });
  }
  for (let index = 0; index < count; index += 1) {
    const sample = samples[index] ?? zeroLab();
    let best = Infinity;
    for (const center of centers) best = Math.min(best, Math.sqrt(labDistance2(sample, center)));
    distance[index] = best;
  }
  while (centers.length < k && centers.length < count + pinned) {
    let at = 0;
    let score = -1;
    for (let index = 0; index < count; index += 1) {
      const next = (distance[index] ?? 0) * Math.sqrt(weights[index] ?? 0);
      if (next > score) {
        score = next;
        at = index;
      }
    }
    if (score <= 0 && centers.length >= pinned) break;
    const center = samples[at] ?? zeroLab();
    centers.push({ L: center.L, a: center.a, b: center.b });
    for (let index = 0; index < count; index += 1) {
      distance[index] = Math.min(distance[index] ?? 0, Math.sqrt(labDistance2(samples[index] ?? zeroLab(), center)));
    }
  }
  const pinCount = Math.min(pinned, centers.length);
  for (let round = 0; round < 40; round += 1) {
    const bins = centers.map(() => ({ L: 0, a: 0, b: 0, w: 0 }));
    for (let index = 0; index < count; index += 1) {
      const sample = samples[index] ?? zeroLab();
      const slot = nearestLab(sample, centers);
      const bin = bins[slot];
      const weight = weights[index] ?? 0;
      if (bin === void 0) continue;
      bin.L += sample.L * weight;
      bin.a += sample.a * weight;
      bin.b += sample.b * weight;
      bin.w += weight;
    }
    for (let index = pinCount; index < centers.length; index += 1) {
      const bin = bins[index];
      if (bin === void 0 || bin.w === 0) continue;
      centers[index] = { L: bin.L / bin.w, a: bin.a / bin.w, b: bin.b / bin.w };
    }
    onProgress?.((round + 1) / 40);
  }
  return centers;
}
function cleanLabels(labels, width, height, kCount, minArea, onProgress) {
  for (let pass = 0; pass < 2; pass += 1) {
    for (let label = 0; label < kCount; label += 1) {
      const mask = new Uint8Array(labels.length);
      for (let index = 0; index < labels.length; index += 1) if (labels[index] === label) mask[index] = 1;
      const labeled = components(mask, width, height, (fraction) => onProgress?.((pass * kCount + label) / (2 * Math.max(1, kCount)) + fraction * 0.5 / Math.max(1, kCount)));
      const small = new Uint8Array(labels.length);
      let any = false;
      for (let index = 0; index < labels.length; index += 1) {
        const id = labeled.ids[index] ?? 0;
        if (id > 0 && (labeled.sizes[id] ?? 0) < minArea) {
          small[index] = 1;
          any = true;
        }
      }
      if (!any) continue;
      const replacement = nearestOutside(labels, small, width, height, (fraction) => onProgress?.((pass * kCount + label) / (2 * Math.max(1, kCount)) + 0.5 / Math.max(1, kCount) + fraction * 0.5 / Math.max(1, kCount)));
      for (let index = 0; index < labels.length; index += 1) if (small[index] === 1) labels[index] = replacement[index] ?? label;
      onProgress?.((pass * kCount + label + 1) / (2 * Math.max(1, kCount)));
    }
  }
  onProgress?.(1);
}
function nearestOutside(labels, small, width, height, onProgress) {
  const nearest2 = new Uint8Array(labels.length);
  const seen = new Uint8Array(labels.length);
  const queue = [];
  for (let index = 0; index < small.length; index += 1) {
    if (small[index] === 1) continue;
    seen[index] = 1;
    nearest2[index] = labels[index] ?? 0;
    queue.push(index);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const y = (index - x) / width;
    const around = [index - 1, index + 1, index - width, index + width];
    for (const next of around) {
      if (next < 0 || next >= labels.length || seen[next] === 1) continue;
      const nx = next % width;
      if (Math.abs(nx - x) + Math.abs((next - nx) / width - y) !== 1) continue;
      seen[next] = 1;
      nearest2[next] = nearest2[index] ?? 0;
      queue.push(next);
    }
    if (cursor % 16384 === 0) onProgress?.(cursor / Math.max(1, queue.length));
  }
  return nearest2;
}
function smoothLabels(labels, width, height, kCount, sigma, onProgress) {
  if (!(sigma > 0)) return;
  const kernel = gaussianKernel(sigma);
  const best = new Float64Array(labels.length);
  best.fill(-1);
  const next = labels.slice();
  const mask = new Float64Array(labels.length);
  const blurred = new Float64Array(labels.length);
  for (let label = 0; label < kCount; label += 1) {
    for (let index = 0; index < labels.length; index += 1) mask[index] = labels[index] === label ? 1 : 0;
    blurSeparable(mask, blurred, width, height, kernel, (fraction) => onProgress?.((label + fraction) / Math.max(1, kCount) * 0.9));
    for (let index = 0; index < labels.length; index += 1) {
      const value = blurred[index] ?? 0;
      if (value > (best[index] ?? -1)) {
        best[index] = value;
        next[index] = label;
      }
    }
    onProgress?.((label + 1) / Math.max(1, kCount));
  }
  labels.set(next);
}
var BACKDROP_LAB = 0.1;
var SUBJECT_ON_BORDER = 16;
function outsideHoldsSubject(rgba, lab, opaque, outside, width, height) {
  const corner = cornerColor(rgba, width, height);
  const backdrop = corner === null ? null : rgbToOklab({ r: parseInt(corner.slice(1, 3), 16), g: parseInt(corner.slice(3, 5), 16), b: parseInt(corner.slice(5, 7), 16) });
  if (backdrop === null && !opaque.some((value, index) => value === 0 && outside[index] === 1)) return false;
  let subject = 0;
  for (let index = 0; index < outside.length; index += 1) {
    if (outside[index] !== 1 || opaque[index] !== 1) continue;
    if (backdrop !== null && Math.sqrt(labDistance2(readLab(lab, index), backdrop)) <= BACKDROP_LAB) continue;
    subject += 1;
    if (subject > SUBJECT_ON_BORDER) return true;
  }
  return false;
}
function enclosedBoxes(rgba, width, height, onProgress) {
  const count = width * height;
  if (width < 2 || height < 2 || rgba.length < count * 4) return [];
  const lab = new Float64Array(count * 3);
  const opaque = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    opaque[index] = (rgba[offset + 3] ?? 0) >= 128 ? 1 : 0;
    const color = rgbToOklab({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
    lab[index * 3] = color.L;
    lab[index * 3 + 1] = color.a;
    lab[index * 3 + 2] = color.b;
    if (index % 16384 === 0) onProgress?.(0.2 * index / count);
  }
  const edge = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (opaque[index] !== 1) continue;
      const color = readLab(lab, index);
      let strong = false;
      for (const step of [-1, 1, -width, width]) {
        const next = index + step;
        const nx = x + (step === -1 ? -1 : step === 1 ? 1 : 0);
        const ny = y + (step === -width ? -1 : step === width ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (opaque[next] !== 1) {
          strong = true;
          break;
        }
        if (Math.sqrt(labDistance2(color, readLab(lab, next))) > COLOR_FLOOR) {
          strong = true;
          break;
        }
      }
      if (strong) edge[index] = 1;
    }
    onProgress?.(0.2 + 0.2 * (y + 1) / height);
  }
  const outside = new Uint8Array(count);
  const queue = [];
  for (let x = 0; x < width; x += 1) {
    seedOutside(0 * width + x, edge, outside, queue);
    seedOutside((height - 1) * width + x, edge, outside, queue);
  }
  for (let y = 0; y < height; y += 1) {
    seedOutside(y * width, edge, outside, queue);
    seedOutside(y * width + width - 1, edge, outside, queue);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const y = (index - x) / width;
    const steps = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const step of steps) {
      const nx = step[0] ?? 0;
      const ny = step[1] ?? 0;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      seedOutside(ny * width + nx, edge, outside, queue);
    }
    if (cursor % 16384 === 0) onProgress?.(0.4 + 0.2 * cursor / Math.max(1, queue.length));
  }
  if (outsideHoldsSubject(rgba, lab, opaque, outside, width, height)) return [];
  const object = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    if (opaque[index] === 1 && outside[index] !== 1) object[index] = 1;
    if (index % 16384 === 0) onProgress?.(0.6 + 0.1 * index / count);
  }
  const labeled = components(object, width, height, (fraction) => onProgress?.(0.7 + fraction * 0.2));
  const boxes = [];
  for (let id = 1; id <= labeled.count; id += 1) {
    if ((labeled.sizes[id] ?? 0) < 400) continue;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let index = 0; index < count; index += 1) {
      if ((labeled.ids[index] ?? 0) !== id) continue;
      const x2 = index % width;
      const y2 = (index - x2) / width;
      if (x2 < minX) minX = x2;
      if (y2 < minY) minY = y2;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
      if (index % 16384 === 0) onProgress?.(0.9 + 0.1 * (id - 1 + index / count) / Math.max(1, labeled.count));
    }
    const pad = 2;
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    boxes.push({ x, y, width: Math.min(width, maxX + 1 + pad) - x, height: Math.min(height, maxY + 1 + pad) - y });
  }
  onProgress?.(1);
  return mergeBoxes(boxes, 8);
}
function seedOutside(index, edge, outside, queue) {
  if (edge[index] === 1 || outside[index] === 1) return;
  outside[index] = 1;
  queue.push(index);
}
function mergeBoxes(boxes, gap) {
  const open = boxes.map((box) => ({ ...box }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let left = 0; left < open.length; left += 1) {
      for (let right = left + 1; right < open.length; right += 1) {
        const a = open[left];
        const b = open[right];
        if (a === void 0 || b === void 0) continue;
        const apart = a.x > b.x + b.width + gap || b.x > a.x + a.width + gap || a.y > b.y + b.height + gap || b.y > a.y + a.height + gap;
        if (apart) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        open[left] = { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
        open.splice(right, 1);
        merged = true;
        break;
      }
      if (merged) break;
    }
  }
  return open;
}
function coreMask(lab, alpha, width, height, tau, onProgress) {
  const core = new Uint8Array(width * height);
  const limit = tau * tau;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0) continue;
      const color = readLab(lab, index);
      let worst = 0;
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          const next = ny * width + nx;
          if (alpha[next] === 0) {
            flat = false;
            break;
          }
          worst = Math.max(worst, labDistance2(color, readLab(lab, next)));
          if (worst >= limit) flat = false;
        }
      }
      if (flat && worst < limit) core[index] = 1;
    }
    onProgress?.((y + 1) / height);
  }
  return core;
}
function components(mask, width, height, onProgress) {
  const ids = new Int32Array(mask.length);
  const sizes = [0];
  const stack = [];
  let visited = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || ids[start] !== 0) continue;
    const id = sizes.length;
    sizes.push(0);
    stack.push(start);
    ids[start] = id;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      sizes[id] = (sizes[id] ?? 0) + 1;
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] !== 1 || ids[next] !== 0) continue;
          ids[next] = id;
          stack.push(next);
        }
      }
      visited += 1;
      if (visited % 16384 === 0) onProgress?.(visited / mask.length);
    }
    if (start % 16384 === 0) onProgress?.(start / mask.length);
  }
  onProgress?.(1);
  return { ids, sizes: Int32Array.from(sizes), count: sizes.length - 1 };
}
function bicubicLab(linear, width, height, sx, sy) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let ky = -1; ky <= 2; ky += 1) {
    const wy = keys(fy - ky);
    const y = reflect101(y0 + ky, height);
    for (let kx = -1; kx <= 2; kx += 1) {
      const weight = wy * keys(fx - kx);
      const x = reflect101(x0 + kx, width);
      const offset = (y * width + x) * 3;
      red += (linear[offset] ?? 0) * weight;
      green += (linear[offset + 1] ?? 0) * weight;
      blue += (linear[offset + 2] ?? 0) * weight;
    }
  }
  return rgbToOklab({ r: linearToSrgb(red), g: linearToSrgb(green), b: linearToSrgb(blue) });
}
function blurSeparable(source, target, width, height, kernel, onProgress) {
  const radius = kernel.length - 1 >> 1;
  const temp = new Float64Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let tap = -radius; tap <= radius; tap += 1) sum += (source[y * width + reflect101(x + tap, width)] ?? 0) * (kernel[tap + radius] ?? 0);
      temp[y * width + x] = sum;
    }
    onProgress?.(0.5 * (y + 1) / height);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let tap = -radius; tap <= radius; tap += 1) sum += (temp[reflect101(y + tap, height) * width + x] ?? 0) * (kernel[tap + radius] ?? 0);
      target[y * width + x] = sum;
    }
    onProgress?.(0.5 + 0.5 * (y + 1) / height);
  }
}
function gaussianKernel(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let index = -radius; index <= radius; index += 1) {
    const weight = Math.exp(-(index * index) / (2 * sigma * sigma));
    kernel[index + radius] = weight;
    sum += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] = (kernel[index] ?? 0) / sum;
  return kernel;
}
function projectLab(color, left, right) {
  const dL = right.L - left.L;
  const da = right.a - left.a;
  const db = right.b - left.b;
  const length = dL * dL + da * da + db * db;
  const raw = length === 0 ? 0 : ((color.L - left.L) * dL + (color.a - left.a) * da + (color.b - left.b) * db) / length;
  const t = Math.min(1, Math.max(0, raw));
  const mixed = { L: left.L + t * dL, a: left.a + t * da, b: left.b + t * db };
  return { t, distance: Math.sqrt(labDistance2(color, mixed)) };
}
function nearestLab(color, centers) {
  let best = 0;
  let score = Infinity;
  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index];
    if (center === void 0) continue;
    const gap = labDistance2(color, center);
    if (gap < score) {
      score = gap;
      best = index;
    }
  }
  return best;
}
function bitList(mask, kCount) {
  const bits = [];
  for (let label = 0; label < kCount; label += 1) if ((mask & 1 << label) !== 0) bits.push(label);
  return bits;
}
function squareOffsets(radius) {
  const offsets = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) offsets.push({ x, y });
  }
  return offsets;
}
function diskOffsets(radius) {
  const offsets = [];
  const limit = radius * radius;
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) if (x * x + y * y <= limit) offsets.push({ x, y });
  }
  return offsets;
}
function readLab(lab, index) {
  return { L: lab[index * 3] ?? 0, a: lab[index * 3 + 1] ?? 0, b: lab[index * 3 + 2] ?? 0 };
}
function countOf(mask) {
  let count = 0;
  for (const value of mask) if (value === 1) count += 1;
  return count;
}
function zeroLab() {
  return { L: 0, a: 0, b: 0 };
}
function reflect101(index, length) {
  if (length <= 1) return 0;
  const span = length * 2 - 2;
  let wrapped = index % span;
  if (wrapped < 0) wrapped += span;
  return wrapped >= length ? span - wrapped : wrapped;
}
function keys(distance) {
  const t = Math.abs(distance);
  if (t <= 1) return (1.25 * t - 2.25) * t * t + 1;
  if (t < 2) return ((-0.75 * t + 3.75) * t - 6) * t + 3;
  return 0;
}
function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(channel) {
  const value = Math.min(1, Math.max(0, channel));
  const encoded = value <= 31308e-7 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}
function hex(red, green, blue) {
  return "#" + [red, green, blue].map((value) => Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0")).join("");
}

// src/trace.ts
function presetDefaults(preset) {
  if (preset === "photo") return { maxColors: 48, smoothness: 2, corner: 20, removeBackground: false, stacking: "stacked" };
  if (preset === "poster") return { maxColors: 10, smoothness: 2.2, corner: 16, removeBackground: false, stacking: "stacked" };
  if (preset === "icon") return { maxColors: 8, smoothness: 2, corner: 55, removeBackground: true, stacking: "cutout" };
  return { maxColors: 0, smoothness: 2.4, corner: 35, removeBackground: true, stacking: "cutout" };
}
function simplifyTolerance(smoothness) {
  const clamped = Math.min(3, Math.max(0, smoothness));
  const tolerance = 2.2 - clamped * 0.75;
  return Math.round(Math.max(0.15, tolerance) * 100) / 100;
}

// src/lab-model.ts
var SPECK = { logo: 18, icon: 12, photo: 6, poster: 28 };
var PRECISION = { logo: 6, icon: 5, photo: 8, poster: 4 };
function controlsFor(mode) {
  const defaults = presetDefaults(mode);
  const segmentColors = mode === "logo" ? 0 : Math.min(32, Math.max(2, defaults.maxColors || (mode === "photo" ? 32 : mode === "poster" ? 10 : 8)));
  return {
    mode,
    maxColors: segmentColors,
    snapBlends: mode === "logo" || mode === "icon",
    speckArea: SPECK[mode],
    removeBackground: defaults.removeBackground,
    backdropSpread: 22,
    opaqueAt: mode === "photo" || mode === "poster" ? 128 : 200,
    traceColors: defaults.maxColors > 0 ? defaults.maxColors : segmentColors,
    lockPalette: true,
    colorPrecision: PRECISION[mode],
    filterSpeckle: mode === "photo" ? 1 : 0,
    clustering: mode === "photo" ? "watershed" : "off",
    watershedDetail: 128,
    simplify: simplifyTolerance(defaults.smoothness),
    stacking: defaults.stacking,
    dropPlate: defaults.removeBackground,
    fitGeometry: true,
    smoothness: defaults.smoothness,
    corner: defaults.corner,
    seal: mode === "photo" || mode === "poster",
    sealWidth: defaults.stacking === "cutout" ? 2 : 0.8
  };
}
function traceRequest(controls, palette) {
  const locked = controls.lockPalette && palette.length > 0;
  return {
    preset: controls.mode,
    maxColors: locked ? 0 : controls.traceColors,
    smoothness: 0,
    removeBackground: controls.removeBackground,
    stacking: controls.stacking,
    palette: locked ? palette.slice(0, 32) : void 0,
    colorPrecision: controls.colorPrecision,
    filterSpeckle: controls.filterSpeckle,
    clustering: controls.clustering,
    watershedDetail: controls.watershedDetail,
    simplify: controls.simplify
  };
}
function paletteFromRaster(rgba, _ignore) {
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < rgba.length; index += 4) {
    if ((rgba[index + 3] ?? 0) < 250) continue;
    const color = "#" + byte(rgba[index] ?? 0) + byte(rgba[index + 1] ?? 0) + byte(rgba[index + 2] ?? 0);
    seen.add(color);
  }
  return [...seen].sort();
}
function byte(value) {
  return value.toString(16).padStart(2, "0");
}

// src/punch-rgba.ts
function punchRgba(rgba, width, height, opaqueAt = 128, onProgress) {
  onProgress?.(0);
  const count = width * height;
  if (rgba.length < count * 4) {
    onProgress?.(1);
    return { rgba, droppedColor: null };
  }
  const cutoff = Math.min(255, Math.max(0, opaqueAt));
  const used = /* @__PURE__ */ new Set();
  let transparent = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const alpha = rgba[offset + 3] ?? 255;
    if (alpha < cutoff) {
      transparent += 1;
      continue;
    }
    used.add((rgba[offset] ?? 0) << 16 | (rgba[offset + 1] ?? 0) << 8 | (rgba[offset + 2] ?? 0));
    if (index % 16384 === 0) onProgress?.(index / count * 0.45);
  }
  if (transparent === 0) {
    let needsFlattening = false;
    for (let index = 0; index < count; index += 1) {
      if ((rgba[index * 4 + 3] ?? 255) !== 255) {
        needsFlattening = true;
        break;
      }
    }
    if (!needsFlattening) {
      onProgress?.(1);
      return { rgba, droppedColor: null };
    }
    const opaque = new Uint8Array(rgba);
    for (let index = 0; index < count; index += 1) {
      opaque[index * 4 + 3] = 255;
      if (index % 16384 === 0) onProgress?.(0.45 + index / count * 0.55);
    }
    onProgress?.(1);
    return { rgba: opaque, droppedColor: null };
  }
  const sentinel = unusedColor(used);
  const next = new Uint8Array(count * 4);
  next.set(rgba.subarray(0, count * 4));
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    if ((next[offset + 3] ?? 255) < cutoff) {
      next[offset] = sentinel >> 16 & 255;
      next[offset + 1] = sentinel >> 8 & 255;
      next[offset + 2] = sentinel & 255;
    }
    next[offset + 3] = 255;
    if (index % 16384 === 0) onProgress?.(0.45 + index / count * 0.55);
  }
  onProgress?.(1);
  return { rgba: next, droppedColor: hex2(sentinel) };
}
function revealSentinel(rgba, droppedColor) {
  if (droppedColor === null) return rgba;
  const parsed = /^#([0-9a-f]{6})$/i.exec(droppedColor);
  if (parsed === null) return rgba;
  const value = Number.parseInt(parsed[1] ?? "", 16);
  const red = value >> 16 & 255;
  const green = value >> 8 & 255;
  const blue = value & 255;
  const next = new Uint8Array(rgba);
  for (let index = 0; index < next.length; index += 4) {
    if (next[index] === red && next[index + 1] === green && next[index + 2] === blue) next[index + 3] = 0;
  }
  return next;
}
function unusedColor(used) {
  const candidates = [16711935, 65280, 16711850, 65535, 16776960];
  for (const color of candidates) if (!used.has(color)) return color;
  for (let color = 0; color < 16777216; color += 97) if (!used.has(color)) return color;
  return 16711935;
}
function hex2(color) {
  return "#" + color.toString(16).padStart(6, "0");
}

// src/segment.ts
var MODE_CAP = { logo: 8, icon: 8, photo: 32, poster: 10 };
var SPECK_AREA = { logo: 18, icon: 12, photo: 6, poster: 28 };
function segmentRaster(rgba, width, height, options) {
  return segmentViews(rgba, width, height, options).backdrop;
}
function segmentViews(rgba, width, height, options) {
  const colors = segmentColorStage(rgba, width, height, options);
  const backdrop = segmentBackdropStage(rgba, width, height, colors, options.removeBackground, options.backdropSpread ?? 22);
  return { colors: colors.colors, backdrop: backdrop.backdrop, spread: colors.spread, paletteSize: colors.palette.length };
}
function segmentColorStage(rgba, width, height, options, onProgress) {
  let lastProgress = 0;
  const report = (fraction) => {
    lastProgress = Math.max(lastProgress, Math.min(1, fraction));
    onProgress?.(lastProgress);
  };
  const count = width * height;
  if (width < 2 || height < 2 || rgba.length < count * 4) {
    const copy = rgba.slice();
    const labels2 = new Int16Array(count);
    labels2.fill(-1);
    report(1);
    return { colors: copy, labels: labels2, punchLabels: labels2, palette: [], opaque: new Uint8Array(count), spread: 0 };
  }
  const source = rgba;
  const cutoff = Math.min(255, Math.max(0, Math.round(options.opaqueAt ?? 128)));
  report(0);
  const samples = collectSamples(source, width, height, cutoff, (fraction) => report(fraction * 0.08));
  const centroids = cluster(samples, colorCap(options), (fraction) => report(0.08 + fraction * 0.12));
  const snapBlends = options.snapBlends ?? (options.mode === "logo" || options.mode === "icon");
  const areas = new Uint32Array(centroids.length);
  for (let index = 0; index < count; index += 1) {
    if ((source[index * 4 + 3] ?? 0) < cutoff) continue;
    const label = nearest(pixelAt(source, index), centroids);
    areas[label] = (areas[label] ?? 0) + 1;
    if (index % Math.max(1, width * 4) === 0) report(0.2 + index / count * 0.12);
  }
  report(0.32);
  const palette = snapBlends ? foldBlends(centroids, areas) : centroids;
  const labels = new Int16Array(count);
  labels.fill(-1);
  for (let index = 0; index < count; index += 1) {
    if ((source[index * 4 + 3] ?? 0) < cutoff) continue;
    labels[index] = nearest(pixelAt(source, index), palette);
    if (index % Math.max(1, width * 4) === 0) report(0.32 + index / count * 0.16);
  }
  report(0.48);
  cleanupEdges(labels, width, height, (fraction) => report(0.48 + fraction * 0.12));
  mergeSpecks(labels, width, height, Math.max(0, Math.round(options.speckArea ?? SPECK_AREA[options.mode])), (fraction) => report(0.6 + fraction * 0.18));
  const punchLabels = new Int16Array(labels);
  for (let index = 0; index < count; index += 1) {
    if ((source[index * 4 + 3] ?? 0) > 0 && (punchLabels[index] ?? -1) < 0) punchLabels[index] = nearest(pixelAt(source, index), palette);
    if (index % Math.max(1, width * 4) === 0) report(0.78 + index / count * 0.1);
  }
  const opaque = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    opaque[index] = (source[index * 4 + 3] ?? 0) >= cutoff ? 255 : 0;
    if (index % Math.max(1, width * 4) === 0) report(0.88 + index / count * 0.08);
  }
  const colors = paintLabels2(labels, palette, opaque, (fraction) => report(0.96 + fraction * 0.04));
  report(1);
  return { colors, labels, punchLabels, palette, opaque, spread: borderMeasure(source, width, height)?.spread ?? 0 };
}
function segmentBackdropStage(rgba, width, height, colors, removeBackground, spreadLimit, onProgress) {
  onProgress?.(0);
  if (colors.palette.length === 0) {
    onProgress?.(1);
    return { backdrop: colors.colors.slice(), punchInput: rgba.slice() };
  }
  const alpha = colors.opaque.slice();
  const punchAlpha = new Uint8Array(width * height);
  for (let index = 0; index < punchAlpha.length; index += 1) {
    if ((colors.punchLabels[index] ?? -1) >= 0) punchAlpha[index] = rgba[index * 4 + 3] ?? 0;
    if (index % Math.max(1, width * 4) === 0) onProgress?.(index / punchAlpha.length * 0.25);
  }
  const cleared = removeBackground ? flatBackdropMask(rgba, colors.labels, width, height, colors.palette, spreadLimit) : null;
  if (cleared !== null) {
    for (let index = 0; index < cleared.length; index += 1) {
      if (cleared[index] !== 0) {
        alpha[index] = 0;
        punchAlpha[index] = 0;
      }
      if (index % Math.max(1, width * 4) === 0) onProgress?.(0.25 + index / cleared.length * 0.35);
    }
  }
  return {
    backdrop: paintLabels2(colors.labels, colors.palette, alpha, (fraction) => onProgress?.(0.6 + fraction * 0.2)),
    punchInput: paintLabelsWithAlpha(colors.punchLabels, colors.palette, punchAlpha, (fraction) => onProgress?.(0.8 + fraction * 0.2))
  };
}
function paintLabels2(labels, palette, alpha, onProgress) {
  const next = new Uint8Array(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    if ((alpha[index] ?? 0) === 0) continue;
    const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
    next[offset] = color.r;
    next[offset + 1] = color.g;
    next[offset + 2] = color.b;
    next[offset + 3] = 255;
    if (index % 16384 === 0) onProgress?.(index / alpha.length);
  }
  onProgress?.(1);
  return next;
}
function paintLabelsWithAlpha(labels, palette, alpha, onProgress) {
  const next = new Uint8Array(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    const opacity = alpha[index] ?? 0;
    if (opacity === 0) continue;
    const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
    next[offset] = color.r;
    next[offset + 1] = color.g;
    next[offset + 2] = color.b;
    next[offset + 3] = opacity;
    if (index % 16384 === 0) onProgress?.(index / alpha.length);
  }
  onProgress?.(1);
  return next;
}
function colorCap(options) {
  const requested = options.maxColors > 0 ? options.maxColors : MODE_CAP[options.mode];
  return Math.min(32, Math.max(2, requested));
}
function collectSamples(rgba, width, height, cutoff, onProgress) {
  const target = 8e3;
  const stride = Math.max(1, Math.floor(Math.sqrt(width * height / target)));
  const samples = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      if ((rgba[offset + 3] ?? 0) < cutoff) continue;
      samples.push({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
    }
    onProgress?.(y / height);
  }
  return samples.length > 0 ? samples : [{ r: 0, g: 0, b: 0 }];
}
function cluster(samples, cap, onProgress) {
  const centroids = seedCentroids(samples, cap);
  for (let round = 0; round < 8; round += 1) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const sample of samples) {
      const index = nearest(sample, centroids);
      const bin = sums[index];
      if (bin === void 0) continue;
      bin.r += sample.r;
      bin.g += sample.g;
      bin.b += sample.b;
      bin.n += 1;
    }
    for (let index = 0; index < centroids.length; index += 1) {
      const bin = sums[index];
      if (bin === void 0 || bin.n === 0) continue;
      centroids[index] = { r: Math.round(bin.r / bin.n), g: Math.round(bin.g / bin.n), b: Math.round(bin.b / bin.n) };
    }
    onProgress?.((round + 1) / 8);
  }
  return centroids;
}
function seedCentroids(samples, cap) {
  const first = samples[Math.floor(samples.length / 2)] ?? { r: 0, g: 0, b: 0 };
  const centroids = [{ ...first }];
  while (centroids.length < cap) {
    let best = 0;
    let chosen = first;
    for (const sample of samples) {
      const gap = distanceToPalette(sample, centroids);
      if (gap > best) {
        best = gap;
        chosen = sample;
      }
    }
    if (best < 16 * 16) break;
    centroids.push({ ...chosen });
  }
  return centroids;
}
function foldBlends(centroids, areas) {
  const map = centroids.map((_, index) => index);
  for (let index = 0; index < centroids.length; index += 1) {
    const color = centroids[index];
    if (color === void 0) continue;
    let host = -1;
    for (let left = 0; left < centroids.length; left += 1) {
      if (left === index) continue;
      for (let right = left + 1; right < centroids.length; right += 1) {
        if (right === index) continue;
        const a = centroids[left];
        const b = centroids[right];
        if (a === void 0 || b === void 0 || !onSegment(color, a, b)) continue;
        const fringe = areas[index] ?? 0;
        const parent = Math.min(areas[left] ?? 0, areas[right] ?? 0);
        if (fringe * 5 >= parent) continue;
        host = distance2(color, a) <= distance2(color, b) ? left : right;
      }
    }
    if (host >= 0) map[index] = host;
  }
  const kept = [];
  const remap = /* @__PURE__ */ new Map();
  for (let index = 0; index < centroids.length; index += 1) {
    let cursor = map[index] ?? index;
    const seen = /* @__PURE__ */ new Set();
    while ((map[cursor] ?? cursor) !== cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = map[cursor] ?? cursor;
    }
    const existing = remap.get(cursor);
    if (existing !== void 0) {
      remap.set(index, existing);
      continue;
    }
    const color = centroids[cursor];
    if (color === void 0) continue;
    remap.set(index, kept.length);
    remap.set(cursor, kept.length);
    kept.push(color);
  }
  return kept.length > 0 ? kept : centroids.slice();
}
function onSegment(color, a, b) {
  const abx = b.r - a.r;
  const aby = b.g - a.g;
  const abz = b.b - a.b;
  const length = abx * abx + aby * aby + abz * abz;
  if (length < 80 * 80) return false;
  const t = ((color.r - a.r) * abx + (color.g - a.g) * aby + (color.b - a.b) * abz) / length;
  if (t < 0.18 || t > 0.82) return false;
  const projected = { r: a.r + t * abx, g: a.g + t * aby, b: a.b + t * abz };
  return distance2(color, projected) < 26 * 26 && distance2(color, a) > 18 * 18 && distance2(color, b) > 18 * 18;
}
function cleanupEdges(labels, width, height, onProgress) {
  const original = new Int16Array(labels);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if ((original[index] ?? -1) < 0 || isThin(original, width, index)) continue;
        const counts = /* @__PURE__ */ new Map();
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const label = original[index + dy * width + dx] ?? -1;
            if (label < 0) continue;
            counts.set(label, (counts.get(label) ?? 0) + 1);
          }
        }
        let bestLabel = original[index] ?? 0;
        let bestCount = 0;
        for (const [label, count] of counts) {
          if (count > bestCount) {
            bestCount = count;
            bestLabel = label;
          }
        }
        if (bestCount >= 5) labels[index] = bestLabel;
      }
      onProgress?.((pass + y / height) / 2);
    }
    original.set(labels);
  }
}
function isThin(labels, width, index) {
  const label = labels[index] ?? 0;
  const left = (labels[index - 1] ?? -1) === label;
  const right = (labels[index + 1] ?? -1) === label;
  const up = (labels[index - width] ?? -1) === label;
  const down = (labels[index + width] ?? -1) === label;
  return left && right && !up && !down || up && down && !left && !right;
}
function mergeSpecks(labels, width, height, minArea, onProgress) {
  const count = width * height;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  for (let start = 0; start < count; start += 1) {
    if (start % Math.max(1, width * 8) === 0) onProgress?.(start / count);
    if (seen[start] === 1) continue;
    const label = labels[start] ?? -1;
    if (label < 0) {
      seen[start] = 1;
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    seen[start] = 1;
    let minX = start % width;
    let maxX = minX;
    let minY = Math.floor(start / width);
    let maxY = minY;
    while (head < tail) {
      const index = queue[head] ?? 0;
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= count || seen[next] === 1) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        if ((labels[next] ?? -1) !== label) continue;
        seen[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
    }
    if (start % 4096 === 0) onProgress?.(start / count);
    const area = tail;
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    const thin = Math.max(spanX, spanY) >= 8 && Math.min(spanX, spanY) <= 2 && area >= 6;
    if (area >= minArea || thin) continue;
    const around = /* @__PURE__ */ new Map();
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const index = queue[cursor] ?? 0;
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= count) continue;
        const nx = next % width;
        const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        const other = labels[next] ?? -1;
        if (other < 0 || other === label) continue;
        around.set(other, (around.get(other) ?? 0) + 1);
      }
    }
    let replacement = label;
    let votes = 0;
    for (const [other, vote] of around) {
      if (vote > votes) {
        votes = vote;
        replacement = other;
      }
    }
    if (replacement === label) continue;
    for (let cursor = 0; cursor < tail; cursor += 1) labels[queue[cursor] ?? 0] = replacement;
  }
  onProgress?.(1);
}
function borderMeasure(rgba, width, height) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let border = 0;
  const visit = (x, y) => {
    const offset = (y * width + x) * 4;
    red += rgba[offset] ?? 0;
    green += rgba[offset + 1] ?? 0;
    blue += rgba[offset + 2] ?? 0;
    border += 1;
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    if (height > 1) visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(0, y);
    if (width > 1) visit(width - 1, y);
  }
  if (border === 0) return null;
  const mean = { r: red / border, g: green / border, b: blue / border };
  let spread = 0;
  const revisit = (x, y) => {
    spread += Math.sqrt(distance2(pixelAt(rgba, y * width + x), mean));
  };
  for (let x = 0; x < width; x += 1) {
    revisit(x, 0);
    if (height > 1) revisit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    revisit(0, y);
    if (width > 1) revisit(width - 1, y);
  }
  return { mean, spread: spread / border };
}
function flatBackdropMask(rgba, labels, width, height, palette, spreadLimit) {
  const measured = borderMeasure(rgba, width, height);
  if (measured === null || measured.spread > spreadLimit) return null;
  const mean = measured.mean;
  const backdrop = nearest(mean, palette);
  const count = width * height;
  const queue = new Int32Array(count);
  const seen = new Uint8Array(count);
  let tail = 0;
  const push = (index) => {
    if (index < 0 || index >= count || seen[index] === 1) return;
    if ((labels[index] ?? -1) !== backdrop && distance2(pixelAt(rgba, index), mean) > 26 * 26) return;
    seen[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  let head = 0;
  while (head < tail) {
    const index = queue[head] ?? 0;
    head += 1;
    const x = index % width;
    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (const next of neighbors) {
      if (next < 0 || next >= count || seen[next] === 1) continue;
      const nx = next % width;
      if (Math.abs(nx - x) > 1) continue;
      push(next);
    }
  }
  const fraction = tail / count;
  if (fraction < 0.08 || fraction > 0.92) return null;
  const cleared = new Uint8Array(count);
  for (let index = 0; index < tail; index += 1) cleared[queue[index] ?? 0] = 1;
  return cleared;
}
function pixelAt(rgba, index) {
  const offset = index * 4;
  return { r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 };
}
function nearest(color, palette) {
  let best = 0;
  let score = Infinity;
  for (let index = 0; index < palette.length; index += 1) {
    const entry = palette[index];
    if (entry === void 0) continue;
    const gap = distance2(color, entry);
    if (gap < score) {
      score = gap;
      best = index;
    }
  }
  return best;
}
function distanceToPalette(color, palette) {
  let best = Infinity;
  for (const entry of palette) best = Math.min(best, distance2(color, entry));
  return best;
}
function distance2(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

// src/lab-pipeline.ts
var LAB_STEPS = ["capture", "colors", "backdrop", "punch", "trace", "fit", "fair", "seal"];
function buildLabRasterStages(source, width, height, controls, previous = null, from = "colors", onProgress) {
  if (controls.mode === "logo" || controls.mode === "icon") {
    if (previous?.mode === controls.mode && LAB_STEPS.indexOf(from) > LAB_STEPS.indexOf("colors")) return previous;
    const colors2 = source;
    return {
      mode: controls.mode,
      colors: colors2,
      backdrop: colors2,
      punchInput: source,
      punch: colors2,
      traceInput: source,
      droppedColor: null,
      spread: 0,
      paletteSize: 0,
      segmentation: null
    };
  }
  const fromIndex = LAB_STEPS.indexOf(from);
  const sameMode = previous?.mode === controls.mode;
  const canReuseColors = sameMode && previous?.segmentation !== null && previous?.segmentation !== void 0 && fromIndex > LAB_STEPS.indexOf("colors");
  if (!canReuseColors) onProgress?.("colors", 0);
  const segmentation = canReuseColors && previous !== null ? previous.segmentation : segmentColorStage(source, width, height, {
    mode: controls.mode,
    maxColors: controls.maxColors,
    snapBlends: controls.snapBlends,
    speckArea: controls.speckArea,
    removeBackground: false,
    opaqueAt: controlsFor(controls.mode).opaqueAt
  }, (fraction) => onProgress?.("colors", fraction));
  if (!canReuseColors) onProgress?.("colors", 1);
  const colors = segmentation.colors;
  const canReuseBackdrop = sameMode && previous !== null && fromIndex > LAB_STEPS.indexOf("backdrop");
  if (!canReuseBackdrop) onProgress?.("backdrop", 0);
  const backdropStage = canReuseBackdrop ? { backdrop: previous.backdrop, punchInput: previous.punchInput } : segmentBackdropStage(source, width, height, segmentation, controls.removeBackground, controls.backdropSpread, (fraction) => onProgress?.("backdrop", fraction));
  if (!canReuseBackdrop) onProgress?.("backdrop", 1);
  const backdrop = backdropStage.backdrop;
  const punchInput = backdropStage.punchInput;
  const spread = segmentation.spread;
  const paletteSize = segmentation.palette.length;
  const canReusePunch = sameMode && previous !== null && fromIndex > LAB_STEPS.indexOf("punch");
  if (canReusePunch && previous !== null) return previous;
  onProgress?.("punch", 0);
  const punched = punchRgba(punchInput, width, height, controls.opaqueAt, (fraction) => onProgress?.("punch", fraction));
  onProgress?.("punch", 1);
  return {
    mode: controls.mode,
    colors,
    backdrop,
    punchInput,
    punch: revealSentinel(punched.rgba, punched.droppedColor),
    traceInput: punched.rgba,
    droppedColor: punched.droppedColor,
    spread,
    paletteSize,
    segmentation
  };
}
function flatRasterStages(mode, source, colors) {
  return {
    mode,
    colors,
    backdrop: colors,
    punchInput: source,
    punch: colors,
    traceInput: source,
    droppedColor: null,
    spread: 0,
    paletteSize: 0,
    segmentation: null
  };
}
function flatPreviewFromPlates(plates, width, height) {
  const preview = new Uint8Array(width * height * 4);
  for (const plate of plates) {
    for (let y = 0; y < plate.sourceHeight; y += 1) {
      for (let x = 0; x < plate.sourceWidth; x += 1) {
        const sourceOffset = ((y * 8 + 4) * plate.width + x * 8 + 4) * 4;
        const targetOffset = ((plate.originY + y) * width + plate.originX + x) * 4;
        preview[targetOffset] = plate.rgba[sourceOffset] ?? 0;
        preview[targetOffset + 1] = plate.rgba[sourceOffset + 1] ?? 0;
        preview[targetOffset + 2] = plate.rgba[sourceOffset + 2] ?? 0;
        preview[targetOffset + 3] = plate.rgba[sourceOffset + 3] ?? 0;
      }
    }
  }
  return preview;
}

// src/png-alpha.ts
var zlib = __toESM(require("zlib"));
function pngSignature() {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
}
var CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
  CRC_TABLE[index] = value;
}
function punchTransparency(png, opaqueAt = 128) {
  const image = readRgbaPng(png);
  if (image === null) return { png, droppedColor: null };
  const punched = punchRgba(image.rgba, image.width, image.height, opaqueAt);
  if (punched.droppedColor === null) return { png, droppedColor: null };
  return { png: encodeRgbaPng(image.width, image.height, punched.rgba), droppedColor: punched.droppedColor };
}
function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + stride);
    raw[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, row + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    pngSignature(),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
function readRgbaPng(png) {
  if (png.length < 8 || !png.subarray(0, 8).equals(pngSignature())) return null;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const idat = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (data.length < length) return null;
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? -1;
      interlace = data[12] ?? 0;
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") transparency = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
  }
  if (!(width > 0) || !(height > 0) || bitDepth !== 8 || interlace !== 0 || idat.length === 0) return null;
  const channels = channelsOf(colorType);
  if (channels === null) return null;
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (inflated.length !== height * (1 + stride)) return null;
  const bytes = unfilter(inflated, width, height, channels);
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (colorType === 6) {
      rgba[target] = bytes[source] ?? 0;
      rgba[target + 1] = bytes[source + 1] ?? 0;
      rgba[target + 2] = bytes[source + 2] ?? 0;
      rgba[target + 3] = bytes[source + 3] ?? 255;
    } else if (colorType === 2) {
      rgba[target] = bytes[source] ?? 0;
      rgba[target + 1] = bytes[source + 1] ?? 0;
      rgba[target + 2] = bytes[source + 2] ?? 0;
      rgba[target + 3] = matchesTransparency(transparency, rgba[target] ?? 0, rgba[target + 1] ?? 0, rgba[target + 2] ?? 0) ? 0 : 255;
    } else if (colorType === 0) {
      const gray = bytes[source] ?? 0;
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = transparency !== null && transparency.length >= 2 && transparency.readUInt16BE(0) === gray ? 0 : 255;
    } else if (colorType === 4) {
      const gray = bytes[source] ?? 0;
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = bytes[source + 1] ?? 255;
    } else if (colorType === 3 && palette !== null) {
      const index = bytes[source] ?? 0;
      rgba[target] = palette[index * 3] ?? 0;
      rgba[target + 1] = palette[index * 3 + 1] ?? 0;
      rgba[target + 2] = palette[index * 3 + 2] ?? 0;
      rgba[target + 3] = transparency?.[index] ?? 255;
    } else {
      return null;
    }
  }
  return { width, height, rgba };
}
function channelsOf(colorType) {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return null;
}
function matchesTransparency(transparency, red, green, blue) {
  if (transparency === null || transparency.length < 6) return false;
  return transparency[0] === 0 && transparency[1] === red && transparency[2] === 0 && transparency[3] === green && transparency[4] === 0 && transparency[5] === blue;
}
function unfilter(data, width, height, channels) {
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[offset] ?? 0;
    offset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = data[offset] ?? 0;
      offset += 1;
      const left = x >= channels ? out[y * stride + x - channels] ?? 0 : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] ?? 0 : 0;
      const upLeft = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] ?? 0 : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      out[y * stride + x] = value & 255;
    }
  }
  return out;
}
function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonal = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
  if (upDistance <= diagonal) return up;
  return upLeft;
}
function crc32(data) {
  let crc = 4294967295;
  for (const byte2 of data) crc = (CRC_TABLE[(crc ^ byte2) & 255] ?? 0) ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}

// src/trace-pipeline.ts
function planTrace(source, settings, controls, previousStages = null, from = "colors", onProgress) {
  const decoded = readRgbaPng(source);
  if (decoded === null) return null;
  if (controls !== void 0) {
    if (settings.preset === "logo" || settings.preset === "icon") {
      onProgress?.("colors", 0);
      const plan = planFlat(decoded.rgba, decoded.width, decoded.height, settings, controls, void 0, (fraction) => onProgress?.("colors", fraction * 0.95));
      onProgress?.("colors", 1);
      onProgress?.("backdrop", 1);
      onProgress?.("punch", 1);
      return plan;
    }
    const rasterStages = buildLabRasterStages(decoded.rgba, decoded.width, decoded.height, controls, previousStages, from, onProgress);
    return planSegmentedWithControls(decoded.rgba, decoded.width, decoded.height, settings, controls, rasterStages);
  }
  if (settings.preset === "logo" || settings.preset === "icon") return planFlat(decoded.rgba, decoded.width, decoded.height, settings);
  return planSegmented(decoded.rgba, decoded.width, decoded.height, settings);
}
function planFlat(rgba, width, height, settings, controls, preparedPlates, onProgress) {
  const flat = preparedPlates ?? flatPlates(rgba, width, height, settings.maxColors, void 0, onProgress);
  const plates = flat.map((plate) => ({
    png: encodeRgbaPng(plate.width, plate.height, settings.removeBackground ? punchBorderBackdrop(plate.rgba, plate.width, plate.height, plate.borderColor, plate.scale) : plate.rgba),
    scale: plate.scale,
    originX: plate.originX,
    originY: plate.originY,
    borderColor: plate.borderColor,
    cutOut: plate.cutOut,
    request: controls === void 0 ? flatRequest(settings, plate.palette, plate.scale) : flatRequestForControls(settings, plate.palette, plate.scale, controls)
  }));
  const rasterStages = controls === void 0 ? void 0 : flatRasterStages(controls.mode, rgba, flatPreviewFromPlates([...flat], width, height));
  return {
    width,
    height,
    droppedColor: null,
    plates,
    ...rasterStages === void 0 ? {} : { rasterStages }
  };
}
var BACKDROP_TOLERANCE = 24;
var HALO_MIX = 0.35;
var HALO_RESIDUAL = 16;
function punchBorderBackdrop(rgba, width, height, sourceBorder, haloReach = 8) {
  if (sourceBorder === null) return rgba;
  const corner = cornerColor(rgba, width, height);
  if (corner === null) return rgba;
  const tr = parseInt(corner.slice(1, 3), 16), tg = parseInt(corner.slice(3, 5), 16), tb = parseInt(corner.slice(5, 7), 16);
  const halo = haloColors(rgba, [tr, tg, tb]);
  const near = (pixel) => (rgba[pixel * 4 + 3] ?? 0) >= 250 && Math.abs((rgba[pixel * 4] ?? 0) - tr) <= BACKDROP_TOLERANCE && Math.abs((rgba[pixel * 4 + 1] ?? 0) - tg) <= BACKDROP_TOLERANCE && Math.abs((rgba[pixel * 4 + 2] ?? 0) - tb) <= BACKDROP_TOLERANCE;
  const isHalo = (pixel) => (rgba[pixel * 4 + 3] ?? 0) >= 250 && halo.has((rgba[pixel * 4] ?? 0) << 16 | (rgba[pixel * 4 + 1] ?? 0) << 8 | (rgba[pixel * 4 + 2] ?? 0));
  const out = new Uint8Array(rgba);
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (pixel) => {
    if (seen[pixel] === 1 || !near(pixel)) return;
    seen[pixel] = 1;
    stack.push(pixel);
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  let punched = 0;
  while (stack.length > 0) {
    const pixel = stack.pop() ?? 0;
    out[pixel * 4 + 3] = 0;
    punched += 1;
    const x = pixel % width;
    if (x > 0) push(pixel - 1);
    if (x < width - 1) push(pixel + 1);
    if (pixel >= width) push(pixel - width);
    if (pixel < (height - 1) * width) push(pixel + width);
  }
  if (punched === width * height) return rgba;
  if (halo.size > 0) {
    let frontier = [];
    for (let pixel = 0; pixel < width * height; pixel += 1) if (seen[pixel] === 1) frontier.push(pixel);
    for (let depth = 0; depth < haloReach && frontier.length > 0; depth += 1) {
      const next = [];
      for (const pixel of frontier) {
        const x = pixel % width;
        for (const step of [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width]) {
          if (step < 0 || step >= width * height || seen[step] === 1 || !isHalo(step)) continue;
          seen[step] = 1;
          out[step * 4 + 3] = 0;
          next.push(step);
        }
      }
      frontier = next;
    }
  }
  return out;
}
function haloColors(rgba, backdrop) {
  const counts = /* @__PURE__ */ new Map();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if ((rgba[offset + 3] ?? 0) < 250) continue;
    const key = (rgba[offset] ?? 0) << 16 | (rgba[offset + 1] ?? 0) << 8 | (rgba[offset + 2] ?? 0);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (counts.size > 64) return /* @__PURE__ */ new Set();
  }
  const colors = [...counts.keys()].map((key) => [key >> 16 & 255, key >> 8 & 255, key & 255]);
  const result = /* @__PURE__ */ new Set();
  for (const color of colors) {
    for (const other of colors) {
      if (other === color) continue;
      let dot = 0;
      let length = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const span = (other[channel] ?? 0) - (backdrop[channel] ?? 0);
        dot += ((color[channel] ?? 0) - (backdrop[channel] ?? 0)) * span;
        length += span * span;
      }
      if (length < 64 * 64) continue;
      const t = dot / length;
      if (t <= 0 || t > HALO_MIX) continue;
      let residual = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const mixed = (backdrop[channel] ?? 0) + t * ((other[channel] ?? 0) - (backdrop[channel] ?? 0));
        residual += ((color[channel] ?? 0) - mixed) ** 2;
      }
      if (Math.sqrt(residual) <= HALO_RESIDUAL) {
        result.add((color[0] ?? 0) << 16 | (color[1] ?? 0) << 8 | (color[2] ?? 0));
        break;
      }
    }
  }
  return result;
}
function flatRequest(settings, palette, scale) {
  return {
    preset: settings.preset,
    maxColors: 0,
    smoothness: 0,
    removeBackground: settings.removeBackground,
    stacking: "stacked",
    palette: palette.slice(0, 32),
    colorPrecision: 8,
    filterSpeckle: Math.min(128, Math.floor(Math.sqrt(1.44) * scale)),
    clustering: "off",
    simplify: Math.round(0.3 * scale * 100) / 100
  };
}
function flatRequestForControls(settings, palette, scale, controls) {
  const request = flatRequest(settings, palette, scale);
  const defaults = controlsFor(controls.mode);
  const paletteChanged = controls.lockPalette !== defaults.lockPalette || controls.traceColors !== defaults.traceColors;
  const traceSettings = paletteChanged ? traceRequest(controls, palette) : null;
  return {
    ...request,
    ...traceSettings === null ? {} : { maxColors: traceSettings.maxColors, palette: traceSettings.palette },
    ...controls.colorPrecision === defaults.colorPrecision ? {} : { colorPrecision: controls.colorPrecision },
    ...controls.filterSpeckle === defaults.filterSpeckle ? {} : { filterSpeckle: controls.filterSpeckle },
    ...controls.clustering === defaults.clustering ? {} : { clustering: controls.clustering },
    ...controls.watershedDetail === defaults.watershedDetail ? {} : { watershedDetail: controls.watershedDetail },
    ...controls.simplify === defaults.simplify ? {} : { simplify: controls.simplify },
    stacking: controls.stacking === defaults.stacking ? request.stacking : controls.stacking
  };
}
function cappedPalette(colors, sentinel) {
  const unique = [...new Set(colors.map((color) => color.toLowerCase()))];
  const mark = sentinel?.trim().toLowerCase() ?? "";
  if (!/^#[0-9a-f]{6}$/.test(mark) || !unique.includes(mark)) return unique.slice(0, 32);
  const rest = unique.filter((color) => color !== mark);
  return [...rest.slice(0, 31), mark];
}
function planSegmented(rgba, width, height, settings) {
  const segmented = segmentRaster(rgba, width, height, {
    mode: settings.preset,
    maxColors: settings.maxColors,
    removeBackground: settings.removeBackground,
    opaqueAt: settings.preset === "photo" || settings.preset === "poster" ? 128 : 200
  });
  const punched = punchTransparency(encodeRgbaPng(width, height, segmented), settings.preset === "photo" || settings.preset === "poster" ? 128 : 200);
  const decoded = readRgbaPng(punched.png);
  const palette = decoded === null ? [] : cappedPalette(paletteFromRaster(decoded.rgba, punched.droppedColor), punched.droppedColor);
  const locked = palette.length > 0;
  return {
    width,
    height,
    droppedColor: punched.droppedColor,
    plates: [
      {
        png: punched.png,
        scale: 1,
        originX: 0,
        originY: 0,
        borderColor: cornerColor(rgba, width, height),
        cutOut: hasClearPixel(rgba),
        request: {
          preset: settings.preset,
          maxColors: locked ? 0 : settings.maxColors,
          smoothness: settings.smoothness,
          removeBackground: settings.removeBackground,
          stacking: settings.stacking,
          palette: locked ? palette : void 0
        }
      }
    ]
  };
}
function planSegmentedWithControls(rgba, width, height, settings, controls, stages) {
  const png = encodeRgbaPng(width, height, stages.traceInput);
  const palette = cappedPalette(paletteFromRaster(stages.traceInput, stages.droppedColor), stages.droppedColor);
  const request = traceRequest(controls, palette);
  return {
    width,
    height,
    droppedColor: stages.droppedColor,
    rasterStages: stages,
    plates: [{
      png,
      scale: 1,
      originX: 0,
      originY: 0,
      borderColor: cornerColor(rgba, width, height),
      cutOut: hasClearPixel(rgba),
      request: {
        ...request,
        removeBackground: settings.removeBackground
      }
    }]
  };
}

// src/progress.ts
var LAB_STEP_WEIGHTS = {
  capture: 1,
  colors: 12864,
  backdrop: 3,
  punch: 1,
  trace: 696,
  fit: 43,
  fair: 3.5,
  seal: 1
};
function createProgressReporter(from, onProgress) {
  const start = LAB_STEPS.indexOf(from);
  const activeSteps = LAB_STEPS.slice(start);
  const totalWeight = activeSteps.reduce((sum, step) => sum + LAB_STEP_WEIGHTS[step], 0);
  let completedWeight = 0;
  let lastPercent = 0;
  let finished = false;
  const firstStep = activeSteps[0] ?? from;
  onProgress({ step: firstStep, fraction: 0, percent: 0 });
  const report = (step, fraction) => {
    if (finished) return;
    const index = LAB_STEPS.indexOf(step);
    if (index < start) return;
    const safeFraction = Math.min(1, Math.max(0, fraction));
    let weightBefore = 0;
    for (let cursor = start; cursor < index; cursor += 1) {
      const previousStep = LAB_STEPS[cursor];
      if (previousStep !== void 0) weightBefore += LAB_STEP_WEIGHTS[previousStep];
    }
    const percent = Math.max(lastPercent, (weightBefore + LAB_STEP_WEIGHTS[step] * safeFraction) / totalWeight * 100);
    lastPercent = percent;
    onProgress({ step, fraction: safeFraction, percent: lastPercent });
  };
  return {
    report,
    finish: () => {
      if (finished) return;
      finished = true;
      const finalStep = LAB_STEPS[LAB_STEPS.length - 1] ?? "seal";
      onProgress({ step: finalStep, fraction: 1, percent: 100 });
    }
  };
}

// src/pipeline-worker.ts
if (import_node_worker_threads.parentPort === null) throw new Error("Pipeline worker requires a worker thread");
import_node_worker_threads.parentPort.on("message", (input) => {
  try {
    const progress = createProgressReporter(input.from, (event) => import_node_worker_threads.parentPort?.postMessage({ kind: "progress", progress: event }));
    const plan = planTrace(Buffer.from(input.sourcePng), input.settings, input.controls, input.previousStages, input.from, progress.report);
    import_node_worker_threads.parentPort?.postMessage({ kind: "plan", plan });
  } catch (error) {
    import_node_worker_threads.parentPort?.postMessage({ kind: "error", error: error instanceof Error ? error.message : String(error) });
  }
});

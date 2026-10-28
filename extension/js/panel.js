"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
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

  // src/panel.ts
  var childProcess = __toESM(__require("child_process"));
  var crypto = __toESM(__require("crypto"));
  var fs = __toESM(__require("fs"));
  var os = __toESM(__require("os"));
  var path = __toESM(__require("path"));

  // src/edit.ts
  var ARG_COUNT = { m: 2, l: 2, h: 1, v: 1, c: 6, z: 0 };
  var sampledCubics = /* @__PURE__ */ new WeakMap();
  function shapePattern() {
    return /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;
  }
  function fairTolerance(smoothness) {
    const clamped = Math.min(3, Math.max(0, Number.isFinite(smoothness) ? smoothness : 0));
    return Math.round((0.4 + clamped * 2.2) * 100) / 100;
  }
  function relaxPaths(svg, tolerance = 0.15) {
    const limit = Math.min(0.5, Math.max(0.05, Number.isFinite(tolerance) ? tolerance : 0.15));
    return svg.replace(shapePattern(), (tag) => {
      if (!/^<path\b/i.test(tag)) return tag;
      const quoted = readD(tag);
      if (quoted === null) return tag;
      const parsed = parsePath(quoted.value);
      if (parsed === null || parsed.length === 0) return tag;
      const relaxed = parsed.map((subpath) => relaxSubpath(subpath, limit));
      const next = serialize(relaxed);
      if (next === quoted.value) return tag;
      return tag.slice(0, quoted.start) + next + tag.slice(quoted.end);
    });
  }
  function relaxSubpath(subpath, tolerance) {
    const cubics = subpath.cubics.slice();
    let guard = cubics.length;
    let merged = true;
    while (merged && cubics.length > 1 && guard > 0) {
      merged = false;
      guard -= 1;
      const last = subpath.closed ? cubics.length : cubics.length - 1;
      for (let index = 0; index < last; index += 1) {
        const nextIndex = (index + 1) % cubics.length;
        if (nextIndex === 0) continue;
        const first = cubics[index];
        const second = cubics[nextIndex];
        if (first === void 0 || second === void 0) continue;
        const fitted = fitSamples(sampleChain([first, second]), tolerance, outgoing(first), incoming(second), 0);
        const replacement = fitted?.[0];
        if (fitted === null || fitted.length !== 1 || replacement === void 0) continue;
        cubics.splice(index, 2, replacement);
        merged = true;
        break;
      }
    }
    return { cubics, closed: subpath.closed };
  }
  function fairPaths(svg, options) {
    const tolerance = options.tolerance ?? fairTolerance(options.smoothness);
    const minTurn = 90 - Math.min(90, Math.max(0, Number.isFinite(options.cornerDegrees) ? options.cornerDegrees : 0));
    return svg.replace(shapePattern(), (tag) => {
      if (!/^<path\b/i.test(tag)) return tag;
      const quoted = readD(tag);
      if (quoted === null) return tag;
      const parsed = parsePath(quoted.value);
      if (parsed === null || parsed.length === 0) return tag;
      const faired = parsed.map((subpath) => fairSubpath(subpath, tolerance, minTurn));
      const next = serialize(faired);
      if (next === quoted.value) return tag;
      return tag.slice(0, quoted.start) + next + tag.slice(quoted.end);
    });
  }
  function listAnchors(svg) {
    const anchors = [];
    let pathIndex = 0;
    for (const tag of svg.match(shapePattern()) ?? []) {
      if (!/^<path\b/i.test(tag)) continue;
      const data = readD(tag)?.value ?? "";
      const parsed = parsePath(data);
      if (parsed === null) {
        pathIndex += 1;
        continue;
      }
      const locations = anchorLocations(parsed);
      for (let anchorIndex = 0; anchorIndex < locations.length; anchorIndex += 1) {
        const point2 = pointOf(parsed, locations[anchorIndex]);
        if (point2 === null) continue;
        anchors.push({ pathIndex, anchorIndex, x: point2.x, y: point2.y });
      }
      pathIndex += 1;
    }
    return anchors;
  }
  function moveAnchor(svg, pathIndex, anchorIndex, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return svg;
    let seen = 0;
    return svg.replace(shapePattern(), (tag) => {
      if (!/^<path\b/i.test(tag)) return tag;
      const current = seen;
      seen += 1;
      if (current !== pathIndex) return tag;
      const quoted = readD(tag);
      if (quoted === null) return tag;
      const parsed = parsePath(quoted.value);
      if (parsed === null) return tag;
      const locations = anchorLocations(parsed);
      const loc = locations[anchorIndex];
      if (loc === void 0) return tag;
      const moved = applyMove(parsed, loc, x, y);
      if (moved === null) return tag;
      return tag.slice(0, quoted.start) + serialize(moved) + tag.slice(quoted.end);
    });
  }
  function removeShape(svg, index) {
    const tags = svg.match(shapePattern()) ?? [];
    if (index < 0 || index >= tags.length || tags.length < 2) return svg;
    let seen = 0;
    return svg.replace(shapePattern(), (tag) => {
      const current = seen;
      seen += 1;
      return current === index ? "" : tag;
    });
  }
  function expandPrimitives(svg) {
    return svg.replace(shapePattern(), (tag) => primitivePath(tag) ?? tag);
  }
  function paintDisc(rgba, width, height, x, y, radius, color) {
    const next = new Uint8Array(rgba);
    const rgb = parseHex(color);
    if (rgb === null || !(radius > 0) || width <= 0 || height <= 0) return next;
    const radiusSquared = radius * radius;
    const left = Math.max(0, Math.floor(x - radius));
    const right = Math.min(width - 1, Math.ceil(x + radius));
    const top = Math.max(0, Math.floor(y - radius));
    const bottom = Math.min(height - 1, Math.ceil(y + radius));
    for (let py = top; py <= bottom; py += 1) {
      for (let px = left; px <= right; px += 1) {
        const dx = px + 0.5 - x;
        const dy = py + 0.5 - y;
        if (dx * dx + dy * dy > radiusSquared) continue;
        const offset = (py * width + px) * 4;
        next[offset] = rgb[0];
        next[offset + 1] = rgb[1];
        next[offset + 2] = rgb[2];
        next[offset + 3] = 255;
      }
    }
    return next;
  }
  function paletteFromRaster(rgba) {
    const colors = [];
    const seen = /* @__PURE__ */ new Set();
    for (let index = 0; index < rgba.length; index += 4) {
      if ((rgba[index + 3] ?? 0) < 128) continue;
      const color = "#" + byte(rgba[index]) + byte(rgba[index + 1]) + byte(rgba[index + 2]);
      if (seen.has(color)) continue;
      if (colors.length === 32) return null;
      seen.add(color);
      colors.push(color);
    }
    return colors;
  }
  function parseBatchFields(parts) {
    if (parts.length < 3) throw new Error("\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
    const count = Number(parts[2]);
    if (!Number.isInteger(count) || count < 0 || count > 12) throw new Error("\u0E08\u0E33\u0E19\u0E27\u0E19\u0E20\u0E32\u0E1E\u0E15\u0E48\u0E2D\u0E0A\u0E38\u0E14\u0E15\u0E49\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E40\u0E01\u0E34\u0E19 12");
    if (parts.length !== 3 + count * 8) throw new Error("\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
    const items = [];
    for (let index = 0; index < count; index += 1) {
      const base = 3 + index * 8;
      const uuid = parts[base] ?? "";
      const itemType = parts[base + 2];
      if (!uuid) throw new Error("\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E21\u0E35 UUID");
      if (itemType !== "PlacedItem" && itemType !== "RasterItem") throw new Error("\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A\u0E20\u0E32\u0E1E raster");
      const left = finite(parts[base + 4], "left");
      const top = finite(parts[base + 5], "top");
      const right = finite(parts[base + 6], "right");
      const bottom = finite(parts[base + 7], "bottom");
      if (right <= left || top <= bottom) throw new Error("\u0E02\u0E19\u0E32\u0E14\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
      items.push({
        uuid,
        name: parts[base + 1] ?? "",
        itemType,
        embedded: parts[base + 3] === "1",
        bounds: [left, top, right, bottom]
      });
    }
    return { documentName: parts[0] ?? "", documentIdentity: parts[1] ?? "", items };
  }
  function finite(raw, label) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("\u0E04\u0E48\u0E32\u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: " + label);
    return value;
  }
  function byte(value) {
    return (value ?? 0).toString(16).padStart(2, "0");
  }
  function parseHex(color) {
    const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
    if (match === null) return null;
    const hex3 = match[1] ?? "";
    return [Number.parseInt(hex3.slice(0, 2), 16), Number.parseInt(hex3.slice(2, 4), 16), Number.parseInt(hex3.slice(4, 6), 16)];
  }
  function readD(tag) {
    const match = /\bd\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    if (match === null || match[1] === void 0 || match.index === void 0) return null;
    const value = match[2] ?? "";
    const open = match.index + match[0].indexOf(match[1]);
    return { value, start: open + 1, end: open + 1 + value.length };
  }
  function fairSubpath(subpath, tolerance, minTurn) {
    if (subpath.cubics.length < 2) return subpath;
    const points = outlinePoints(subpath);
    const locked = new Set(protectedStarts(subpath.cubics, subpath.closed, minTurn));
    if (!subpath.closed) {
      locked.add(0);
      locked.add(points.length - 1);
    }
    const kept = subpath.closed ? simplifyClosed(points, tolerance, locked) : simplifyOpen(points, tolerance, locked);
    const cubics = [];
    for (let index = 0; index < kept.length; index += 1) {
      const from = kept[index] ?? 0;
      const to = kept[subpath.closed ? (index + 1) % kept.length : index + 1];
      if (to === void 0) continue;
      const chain = cubicsBetween(subpath.cubics, from, to, subpath.closed);
      const start2 = points[from];
      const end = points[to];
      if (chain.length > 1 && start2 !== void 0 && end !== void 0) cubics.push(straightCubic(start2, end));
      else cubics.push(...fitChain(chain, tolerance));
    }
    return { cubics: cubics.length > 0 ? cubics : subpath.cubics, closed: subpath.closed };
  }
  function outlinePoints(subpath) {
    const points = subpath.cubics.map((cubic) => cubic.p0);
    const last = subpath.cubics[subpath.cubics.length - 1]?.p3;
    const first = points[0];
    if (last !== void 0 && (first === void 0 || !subpath.closed || distance(first, last) >= 0.05)) points.push(last);
    return points;
  }
  function simplifyOpen(points, epsilon, locked) {
    const seeds = uniqueSorted([0, points.length - 1, ...locked]);
    const keep = new Set(seeds);
    for (let index = 0; index < seeds.length - 1; index += 1) keepFar(points, seeds[index] ?? 0, seeds[index + 1] ?? 0, epsilon, keep);
    return uniqueSorted(keep);
  }
  function simplifyClosed(points, epsilon, locked) {
    let seeds = uniqueSorted(locked);
    if (seeds.length === 0) seeds = diameterIndices(points);
    else if (seeds.length === 1) seeds = uniqueSorted([seeds[0] ?? 0, farthestIndex(points, seeds[0] ?? 0)]);
    const keep = new Set(seeds);
    for (let index = 0; index < seeds.length; index += 1) {
      keepFar(points, seeds[index] ?? 0, seeds[(index + 1) % seeds.length] ?? 0, epsilon, keep);
    }
    return uniqueSorted(keep);
  }
  function keepFar(points, from, to, epsilon, keep) {
    const chain = indexSpan(from, to, points.length);
    if (chain.length < 3) return;
    const start2 = points[from];
    const end = points[to];
    if (start2 === void 0 || end === void 0) return;
    let worst = 0;
    let at = -1;
    for (let index = 1; index < chain.length - 1; index += 1) {
      const pointIndex = chain[index] ?? 0;
      const point2 = points[pointIndex];
      if (point2 === void 0) continue;
      const gap = distanceToSegment(point2, start2, end);
      if (gap > worst) {
        worst = gap;
        at = pointIndex;
      }
    }
    if (at < 0 || worst <= epsilon) return;
    keep.add(at);
    keepFar(points, from, at, epsilon, keep);
    keepFar(points, at, to, epsilon, keep);
  }
  function indexSpan(from, to, count) {
    const span = [from];
    if (count <= 0) return span;
    let cursor = from;
    while (cursor !== to && span.length <= count) {
      cursor = (cursor + 1) % count;
      span.push(cursor);
    }
    return span;
  }
  function diameterIndices(points) {
    let best = 0;
    let left = 0;
    let right = points.length > 1 ? 1 : 0;
    for (let start2 = 0; start2 < points.length; start2 += 1) {
      const origin = points[start2];
      if (origin === void 0) continue;
      for (let index = start2 + 1; index < points.length; index += 1) {
        const point2 = points[index];
        if (point2 === void 0) continue;
        const gap = distance(origin, point2);
        if (gap > best) {
          best = gap;
          left = start2;
          right = index;
        }
      }
    }
    return uniqueSorted([left, right]);
  }
  function farthestIndex(points, origin) {
    const start2 = points[origin];
    if (start2 === void 0) return origin;
    let best = 0;
    let at = origin;
    for (let index = 0; index < points.length; index += 1) {
      const point2 = points[index];
      if (point2 === void 0) continue;
      const gap = distance(start2, point2);
      if (gap > best) {
        best = gap;
        at = index;
      }
    }
    return at;
  }
  function uniqueSorted(values) {
    return Array.from(new Set(values)).filter((value) => Number.isInteger(value) && value >= 0).sort((left, right) => left - right);
  }
  function cubicsBetween(cubics, from, to, closed) {
    if (!closed) return cubics.slice(from, to);
    if (to > from) return cubics.slice(from, to);
    return cubics.slice(from).concat(cubics.slice(0, to));
  }
  function protectedStarts(cubics, closed, minTurn) {
    const stairs = stairRunIndices(cubics.map((_, index) => {
      const previous = cubics[closed ? (index - 1 + cubics.length) % cubics.length : index - 1];
      const next = cubics[index];
      return previous !== void 0 && next !== void 0 && isStairJoint(previous, next);
    }), closed);
    const starts = [];
    for (let index = 0; index < cubics.length; index += 1) {
      if (stairs.has(index)) continue;
      const previous = cubics[closed ? (index - 1 + cubics.length) % cubics.length : index - 1];
      const next = cubics[index];
      if (previous === void 0 || next === void 0) continue;
      if (isCorner(previous, next, minTurn)) starts.push(index);
    }
    return starts;
  }
  function stairRunIndices(flags, closed) {
    const skip = /* @__PURE__ */ new Set();
    const count = flags.length;
    const minimum = closed ? 5 : 3;
    const mark = (run2) => {
      if (run2.length < minimum) return;
      for (const index of run2) skip.add(index);
    };
    if (!closed) {
      let run2 = [];
      for (let index = 0; index < count; index += 1) {
        if (flags[index] === true) run2.push(index);
        else {
          mark(run2);
          run2 = [];
        }
      }
      mark(run2);
      return skip;
    }
    let gap = -1;
    for (let index = 0; index < count; index += 1) {
      if (flags[index] !== true) {
        gap = index;
        break;
      }
    }
    if (gap < 0) {
      if (count >= 5) for (let index = 0; index < count; index += 1) skip.add(index);
      return skip;
    }
    let run = [];
    for (let step = 1; step <= count; step += 1) {
      const index = (gap + step) % count;
      if (flags[index] === true) run.push(index);
      else {
        mark(run);
        run = [];
      }
    }
    mark(run);
    return skip;
  }
  function isStairJoint(previous, next) {
    if (chord(previous) > 24 || chord(next) > 24) return false;
    const turn = turnDegrees(incoming(previous), outgoing(next));
    return turn >= 60 && turn <= 120;
  }
  function isStairChain(chain) {
    if (chain.length < 3) return false;
    for (let index = 1; index < chain.length; index += 1) {
      const previous = chain[index - 1];
      const next = chain[index];
      if (previous === void 0 || next === void 0 || !isStairJoint(previous, next)) return false;
    }
    return true;
  }
  function isCorner(previous, next, minTurn) {
    const longer = Math.max(chord(previous), chord(next));
    if (!(longer > 3)) return false;
    return turnDegrees(incoming(previous), outgoing(next)) >= minTurn;
  }
  function fitChain(chain, tolerance) {
    if (chain.length <= 1) return chain.slice();
    const limit = isStairChain(chain) && tolerance >= 1 ? Math.max(tolerance, 6) : tolerance;
    const samples = sampleChain(chain);
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === void 0 || last === void 0 || distance(first, last) < 0.05) return chain.slice();
    const fitted = fitSamples(samples, limit, outgoing(chain[0] ?? line(first, last)), incoming(chain[chain.length - 1] ?? line(first, last)), 0);
    if (fitted === null || fitted.length === 0 || fitted.length >= chain.length) return chain.slice();
    return fitted;
  }
  function fitSamples(samples, tolerance, tanStart, tanEnd, depth) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === void 0 || last === void 0) return null;
    if (distance(first, last) < 0.05) return [];
    if (maxSegmentDistance(samples, first, last) <= tolerance) return [straightCubic(first, last)];
    const cubic = fitCubic(samples, tanStart, tanEnd);
    const worst = farthest(samples, cubic);
    if (worst.distance <= tolerance) return [cubic];
    const index = splitIndex(samples, worst.index);
    if (depth >= 12 || index <= 0 || index >= samples.length - 1) return null;
    const tangent = tangentAt(samples, index);
    const left = fitSamples(samples.slice(0, index + 1), tolerance, tanStart, tangent, depth + 1);
    const right = fitSamples(samples.slice(index), tolerance, tangent, tanEnd, depth + 1);
    if (left === null || right === null) return null;
    return [...left, ...right];
  }
  function sampleChain(chain) {
    const samples = [];
    chain.forEach((cubic, index) => {
      if (index === 0) samples.push(cubic.p0);
      for (const t of [0.25, 0.5, 0.75, 1]) samples.push(bezier(cubic, t));
    });
    return samples;
  }
  function splitIndex(samples, errorIndex) {
    const last = samples.length - 1;
    if (errorIndex >= 3 && errorIndex <= last - 3) return errorIndex;
    const first = samples[0];
    const end = samples[last];
    if (first === void 0 || end === void 0) return Math.max(1, Math.floor(last / 2));
    let bulge = 0;
    let at = Math.max(1, Math.floor(last / 2));
    for (let index = 2; index <= last - 2; index += 1) {
      const point2 = samples[index];
      if (point2 === void 0) continue;
      const error = distanceToSegment(point2, first, end);
      if (error > bulge) {
        bulge = error;
        at = index;
      }
    }
    return at;
  }
  function farthest(samples, cubic) {
    let distanceWorst = 0;
    let index = 0;
    const curveSamples = sampleCubic(cubic);
    for (let sampleIndex = 1; sampleIndex < samples.length - 1; sampleIndex += 1) {
      const point2 = samples[sampleIndex];
      if (point2 === void 0) continue;
      const error = distanceToCubicSamples(point2, curveSamples);
      if (error > distanceWorst) {
        distanceWorst = error;
        index = sampleIndex;
      }
    }
    return { distance: distanceWorst, index };
  }
  function maxSegmentDistance(samples, start2, end) {
    let worst = 0;
    for (const point2 of samples) worst = Math.max(worst, distanceToSegment(point2, start2, end));
    return worst;
  }
  function distanceToSegment(point2, start2, end) {
    const dx = end.x - start2.x;
    const dy = end.y - start2.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-8) return distance(point2, start2);
    const t = Math.min(1, Math.max(0, ((point2.x - start2.x) * dx + (point2.y - start2.y) * dy) / lengthSquared));
    return distance(point2, { x: start2.x + dx * t, y: start2.y + dy * t });
  }
  function sampleCubic(cubic) {
    const cached = sampledCubics.get(cubic);
    if (cached !== void 0) return cached;
    const samples = [];
    for (let step = 0; step <= 24; step += 1) samples.push(bezier(cubic, step / 24));
    sampledCubics.set(cubic, samples);
    return samples;
  }
  function distanceToCubicSamples(point2, samples) {
    let bestSquared = Infinity;
    for (const sample of samples) {
      const dx = point2.x - sample.x;
      const dy = point2.y - sample.y;
      const squared = dx * dx + dy * dy;
      if (squared < bestSquared) bestSquared = squared;
    }
    return Math.sqrt(bestSquared);
  }
  function tangentAt(samples, index) {
    const previous = samples[Math.max(0, index - 1)] ?? { x: 0, y: 0 };
    const next = samples[Math.min(samples.length - 1, index + 1)] ?? previous;
    return { x: next.x - previous.x, y: next.y - previous.y };
  }
  function straightCubic(start2, end) {
    return {
      p0: start2,
      p1: { x: start2.x + (end.x - start2.x) / 3, y: start2.y + (end.y - start2.y) / 3 },
      p2: { x: start2.x + 2 * (end.x - start2.x) / 3, y: start2.y + 2 * (end.y - start2.y) / 3 },
      p3: end
    };
  }
  function fitCubic(samples, tanStart, tanEnd) {
    const start2 = samples[0];
    const end = samples[samples.length - 1];
    if (start2 === void 0 || end === void 0) return straightCubic(start2 ?? { x: 0, y: 0 }, end ?? { x: 0, y: 0 });
    const fallback = cubicFromTangents(start2, end, tanStart, tanEnd);
    const startDir = unit(tanStart);
    const endDir = unit(tanEnd);
    if (startDir === null || endDir === null || samples.length < 4) return fallback;
    const parameters = chordParameters(samples);
    const solved = solveCubic(samples, parameters, start2, end, startDir, endDir);
    const refined = solved === null ? null : solveCubic(samples, projectParameters(samples, solved), start2, end, startDir, endDir);
    let best = fallback;
    for (const next of [solved, refined]) {
      if (next !== null && cubicError(samples, next) < cubicError(samples, best)) best = next;
    }
    return best;
  }
  function cubicError(samples, cubic) {
    let worst = 0;
    const curveSamples = sampleCubic(cubic);
    for (const sample of samples) worst = Math.max(worst, distanceToCubicSamples(sample, curveSamples));
    return worst;
  }
  function chordParameters(samples) {
    const lengths = [0];
    let total = 0;
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const next = samples[index];
      total += previous === void 0 || next === void 0 ? 0 : distance(previous, next);
      lengths.push(total);
    }
    if (total < 1e-6) return samples.map((_, index) => samples.length <= 1 ? 0 : index / (samples.length - 1));
    return lengths.map((length) => length / total);
  }
  function solveCubic(samples, parameters, start2, end, startDir, endDir) {
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let d0 = 0;
    let d1 = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const t = parameters[index] ?? 0;
      if (sample === void 0) continue;
      const u = 1 - t;
      const b1 = 3 * u * u * t;
      const b2 = 3 * u * t * t;
      const baseX = (u * u * u + b1) * start2.x + (b2 + t * t * t) * end.x;
      const baseY = (u * u * u + b1) * start2.y + (b2 + t * t * t) * end.y;
      const ux = b1 * startDir.x;
      const uy = b1 * startDir.y;
      const vx = -b2 * endDir.x;
      const vy = -b2 * endDir.y;
      const rx = sample.x - baseX;
      const ry = sample.y - baseY;
      c00 += ux * ux + uy * uy;
      c01 += ux * vx + uy * vy;
      c11 += vx * vx + vy * vy;
      d0 += ux * rx + uy * ry;
      d1 += vx * rx + vy * ry;
    }
    const det = c00 * c11 - c01 * c01;
    if (Math.abs(det) < 1e-8) return null;
    const alpha = (d0 * c11 - c01 * d1) / det;
    const beta = (c00 * d1 - c01 * d0) / det;
    const limit = distance(start2, end) * 3;
    if (!(alpha > 0.05) || !(beta > 0.05) || alpha > limit || beta > limit) return null;
    return {
      p0: start2,
      p1: { x: start2.x + startDir.x * alpha, y: start2.y + startDir.y * alpha },
      p2: { x: end.x - endDir.x * beta, y: end.y - endDir.y * beta },
      p3: end
    };
  }
  function projectParameters(samples, cubic) {
    return samples.map((sample, index) => {
      if (index === 0) return 0;
      if (index === samples.length - 1) return 1;
      let bestT = index / (samples.length - 1);
      let best = Infinity;
      for (let step = 0; step <= 16; step += 1) {
        const t = step / 16;
        const error = distance(sample, bezier(cubic, t));
        if (error < best) {
          best = error;
          bestT = t;
        }
      }
      return bestT;
    });
  }
  function cubicFromTangents(start2, end, tanStart, tanEnd) {
    const handle = distance(start2, end) / 3;
    const startDir = unit(tanStart) ?? unit({ x: end.x - start2.x, y: end.y - start2.y }) ?? { x: 1, y: 0 };
    const endDir = unit(tanEnd) ?? startDir;
    return {
      p0: start2,
      p1: { x: start2.x + startDir.x * handle, y: start2.y + startDir.y * handle },
      p2: { x: end.x - endDir.x * handle, y: end.y - endDir.y * handle },
      p3: end
    };
  }
  function bezier(cubic, t) {
    const u = 1 - t;
    return {
      x: u * u * u * cubic.p0.x + 3 * u * u * t * cubic.p1.x + 3 * u * t * t * cubic.p2.x + t * t * t * cubic.p3.x,
      y: u * u * u * cubic.p0.y + 3 * u * u * t * cubic.p1.y + 3 * u * t * t * cubic.p2.y + t * t * t * cubic.p3.y
    };
  }
  function outgoing(cubic) {
    const handle = { x: cubic.p1.x - cubic.p0.x, y: cubic.p1.y - cubic.p0.y };
    return lengthOf(handle) > 1e-6 ? handle : { x: cubic.p3.x - cubic.p0.x, y: cubic.p3.y - cubic.p0.y };
  }
  function incoming(cubic) {
    const handle = { x: cubic.p3.x - cubic.p2.x, y: cubic.p3.y - cubic.p2.y };
    return lengthOf(handle) > 1e-6 ? handle : { x: cubic.p3.x - cubic.p0.x, y: cubic.p3.y - cubic.p0.y };
  }
  function chord(cubic) {
    return distance(cubic.p0, cubic.p3);
  }
  function turnDegrees(incomingDir, outgoingDir) {
    const a = unit(incomingDir);
    const b = unit(outgoingDir);
    if (a === null || b === null) return 0;
    const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y));
    return Math.acos(dot) * 180 / Math.PI;
  }
  function unit(point2) {
    const length = lengthOf(point2);
    if (length < 1e-6) return null;
    return { x: point2.x / length, y: point2.y / length };
  }
  function lengthOf(point2) {
    return Math.hypot(point2.x, point2.y);
  }
  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function line(start2, end) {
    return straightCubic(start2, end);
  }
  function anchorLocations(subpaths) {
    const locations = [];
    subpaths.forEach((subpath, subIndex) => {
      if (subpath.cubics.length === 0) return;
      locations.push({ subIndex, kind: "start", cubicIndex: 0 });
      subpath.cubics.forEach((cubic, cubicIndex) => {
        const start2 = subpath.cubics[0]?.p0;
        const closing = subpath.closed && start2 !== void 0 && cubicIndex === subpath.cubics.length - 1 && distance(cubic.p3, start2) < 0.05;
        if (!closing) locations.push({ subIndex, kind: "end", cubicIndex });
      });
    });
    return locations;
  }
  function pointOf(subpaths, loc) {
    if (loc === void 0) return null;
    const subpath = subpaths[loc.subIndex];
    const cubic = subpath?.cubics[loc.cubicIndex];
    if (subpath === void 0 || cubic === void 0) return null;
    return loc.kind === "start" ? cubic.p0 : cubic.p3;
  }
  function applyMove(subpaths, loc, x, y) {
    const current = pointOf(subpaths, loc);
    if (current === null) return null;
    const dx = x - current.x;
    const dy = y - current.y;
    return subpaths.map((subpath, subIndex) => {
      if (subIndex !== loc.subIndex) return subpath;
      const cubics = subpath.cubics.map((cubic) => ({
        p0: { ...cubic.p0 },
        p1: { ...cubic.p1 },
        p2: { ...cubic.p2 },
        p3: { ...cubic.p3 }
      }));
      if (loc.kind === "start") {
        const first = cubics[0];
        if (first === void 0) return subpath;
        first.p0 = shift(first.p0, dx, dy);
        first.p1 = shift(first.p1, dx, dy);
        const last = cubics[cubics.length - 1];
        if (subpath.closed && last !== void 0 && distance(last.p3, current) < 0.05) {
          last.p2 = shift(last.p2, dx, dy);
          last.p3 = shift(last.p3, dx, dy);
        }
      } else {
        const cubic = cubics[loc.cubicIndex];
        if (cubic === void 0) return subpath;
        cubic.p2 = shift(cubic.p2, dx, dy);
        cubic.p3 = shift(cubic.p3, dx, dy);
        const next = cubics[loc.cubicIndex + 1];
        if (next !== void 0) {
          next.p0 = shift(next.p0, dx, dy);
          next.p1 = shift(next.p1, dx, dy);
        }
      }
      return { cubics, closed: subpath.closed };
    });
  }
  function shift(point2, dx, dy) {
    return { x: point2.x + dx, y: point2.y + dy };
  }
  function serialize(subpaths) {
    return subpaths.map((subpath) => {
      if (subpath.cubics.length === 0) return "";
      const commands = ["M" + pair(subpath.cubics[0]?.p0 ?? { x: 0, y: 0 })];
      for (const cubic of subpath.cubics) commands.push("C" + pair(cubic.p1) + " " + pair(cubic.p2) + " " + pair(cubic.p3));
      if (subpath.closed) commands.push("Z");
      return commands.join("");
    }).join("");
  }
  function pair(point2) {
    return fmt(point2.x) + "," + fmt(point2.y);
  }
  function fmt(value) {
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }
  function parsePath(data) {
    const tokens = tokenize(data);
    if (tokens === null) return null;
    const subpaths = [];
    let current = [];
    let closed = false;
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let drawing = false;
    const commit = () => {
      if (!drawing) return;
      subpaths.push({ cubics: current, closed });
      current = [];
      closed = false;
      drawing = false;
    };
    for (const token of tokens) {
      const op = token.cmd.toLowerCase();
      const relative = token.cmd === op;
      const at = (index) => token.args[index] ?? 0;
      if (op === "m") {
        commit();
        cx = relative ? cx + at(0) : at(0);
        cy = relative ? cy + at(1) : at(1);
        sx = cx;
        sy = cy;
        drawing = true;
      } else if (op === "l") {
        const x = relative ? cx + at(0) : at(0);
        const y = relative ? cy + at(1) : at(1);
        current.push(straightCubic({ x: cx, y: cy }, { x, y }));
        cx = x;
        cy = y;
      } else if (op === "h") {
        const x = relative ? cx + at(0) : at(0);
        current.push(straightCubic({ x: cx, y: cy }, { x, y: cy }));
        cx = x;
      } else if (op === "v") {
        const y = relative ? cy + at(0) : at(0);
        current.push(straightCubic({ x: cx, y: cy }, { x: cx, y }));
        cy = y;
      } else if (op === "c") {
        const p1 = relative ? { x: cx + at(0), y: cy + at(1) } : { x: at(0), y: at(1) };
        const p2 = relative ? { x: cx + at(2), y: cy + at(3) } : { x: at(2), y: at(3) };
        const p3 = relative ? { x: cx + at(4), y: cy + at(5) } : { x: at(4), y: at(5) };
        current.push({ p0: { x: cx, y: cy }, p1, p2, p3 });
        cx = p3.x;
        cy = p3.y;
      } else if (op === "z") {
        if (Math.hypot(cx - sx, cy - sy) >= 0.05) current.push(straightCubic({ x: cx, y: cy }, { x: sx, y: sy }));
        cx = sx;
        cy = sy;
        closed = true;
        commit();
      }
    }
    commit();
    return subpaths;
  }
  function tokenize(data) {
    const tokens = [];
    let index = 0;
    let cmd = "";
    let args = [];
    while (index < data.length) {
      const char = data[index] ?? "";
      if (/[A-Za-z]/.test(char)) {
        if (!/[MmLlHhVvCcZz]/.test(char)) return null;
        if (args.length > 0) return null;
        cmd = char;
        args = [];
        index += 1;
        if (char === "Z" || char === "z") {
          tokens.push({ cmd: char, args: [] });
          cmd = "";
        }
        continue;
      }
      if (char === "," || /\s/.test(char)) {
        index += 1;
        continue;
      }
      if (cmd === "") return null;
      const number = readNumber(data, index);
      if (number === null) return null;
      args.push(number.value);
      index = number.next;
      const count = ARG_COUNT[cmd.toLowerCase()];
      if (count === void 0) return null;
      if (args.length === count) {
        tokens.push({ cmd, args });
        args = [];
        if (cmd === "M") cmd = "L";
        else if (cmd === "m") cmd = "l";
      }
    }
    return args.length === 0 ? tokens : null;
  }
  function readNumber(data, index) {
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(data.slice(index));
    if (match === null) return null;
    const raw = match[0];
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return { value, next: index + raw.length };
  }
  function primitivePath(tag) {
    const name = (/^<([a-z]+)/i.exec(tag)?.[1] ?? "").toLowerCase();
    if (name !== "circle" && name !== "ellipse" && name !== "rect") return null;
    const attrs = /^<(?:circle|ellipse|rect)\b([^>]*)\/?>/i.exec(tag)?.[1] ?? "";
    const numberAttr = (key) => {
      const raw = readAttr(attrs, key);
      if (raw === null) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    let data = "";
    if (name === "rect") {
      const width = numberAttr("width");
      const height = numberAttr("height");
      if (width === null || height === null || !(width > 0) || !(height > 0)) return null;
      const x = numberAttr("x") ?? 0;
      const y = numberAttr("y") ?? 0;
      data = "M" + fmt(x) + "," + fmt(y) + "H" + fmt(x + width) + "V" + fmt(y + height) + "H" + fmt(x) + "Z";
    } else {
      const rx = name === "circle" ? numberAttr("r") : numberAttr("rx");
      const ry = name === "circle" ? rx : numberAttr("ry");
      if (rx === null || ry === null || !(rx > 0) || !(ry > 0)) return null;
      const cx = numberAttr("cx") ?? 0;
      const cy = numberAttr("cy") ?? 0;
      data = ellipsePath(cx, cy, rx, ry);
    }
    const kept = ["fill", "stroke", "stroke-width", "stroke-linejoin", "opacity", "transform", "fill-rule", "id"].map((key) => {
      const value = readAttr(attrs, key);
      return value === null ? "" : " " + key + '="' + value.replace(/"/g, "") + '"';
    }).join("");
    return '<path d="' + data + '"' + kept + "/>";
  }
  function ellipsePath(cx, cy, rx, ry) {
    const k = 0.5522847498;
    const curves = [
      [cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry],
      [cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy],
      [cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry],
      [cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy]
    ];
    return "M" + fmt(cx + rx) + "," + fmt(cy) + curves.map((row) => "C" + row.map((value) => fmt(value)).join(",")).join("") + "Z";
  }
  function readAttr(attrs, name) {
    const match = new RegExp("\\b" + name + `\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
    if (match === null) return null;
    return match[1] ?? match[2] ?? "";
  }
  function sharpenCorners(svg, fillet = 1.25, minTurn = 35, curl = fillet) {
    return sharpenWith(svg, fillet, minTurn, curl, null);
  }
  function sharpenConfirmed(svg, fillet, minTurn, curl, confirm) {
    return sharpenWith(svg, fillet, minTurn, curl, confirm);
  }
  function sharpenWith(svg, fillet, minTurn, curl, confirm) {
    return svg.replace(shapePattern(), (tag) => {
      if (!/^<path\b/i.test(tag)) return tag;
      const quoted = readD(tag);
      if (quoted === null) return tag;
      const parsed = parsePath(quoted.value);
      if (parsed === null || parsed.length === 0) return tag;
      const fill = /\bfill="([^"]*)"/i.exec(tag)?.[1] ?? "";
      let flat = null;
      const inside = (x, y) => insideFlat(flat ??= flatten(parsed), x, y);
      const check = confirm === null ? null : (cap) => confirm(fill, cap, inside);
      const sharpened = parsed.map((subpath) => sharpenSubpath(subpath, fillet, minTurn, curl, check));
      const next = serialize(sharpened);
      if (next === quoted.value) return tag;
      return tag.slice(0, quoted.start) + next + tag.slice(quoted.end);
    });
  }
  function flatten(subpaths) {
    return subpaths.map((subpath) => subpath.cubics.flatMap((cubic) => [0, 1, 2, 3, 4, 5, 6, 7].map((step) => bezier(cubic, step / 8))));
  }
  function insideFlat(rings, x, y) {
    let winding2 = 0;
    for (const points of rings) {
      for (let index = 0; index < points.length; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        if (a === void 0 || b === void 0) continue;
        const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
        if (a.y <= y && b.y > y && side > 0) winding2 += 1;
        else if (a.y > y && b.y <= y && side < 0) winding2 -= 1;
      }
    }
    return winding2 !== 0;
  }
  function sharpenSubpath(subpath, fillet, minTurn, curl, check) {
    if (!subpath.closed || subpath.cubics.length < 4) return subpath;
    const cubics = subpath.cubics.map((cubic) => ({ p0: { ...cubic.p0 }, p1: { ...cubic.p1 }, p2: { ...cubic.p2 }, p3: { ...cubic.p3 } }));
    const turnLimit = minTurn * Math.PI / 180;
    let index = 0;
    while (index < cubics.length && cubics.length >= 4) {
      let replaced = false;
      let run = 0;
      let length = 0;
      while (!replaced && run < 4 && cubics.length - run >= 3) {
        const piece = cubics[(index + run) % cubics.length];
        if (piece === void 0) break;
        length += distance(piece.p0, piece.p3);
        run += 1;
        if (length > fillet) break;
        const before = cubics[(index - 1 + cubics.length) % cubics.length];
        const after = cubics[(index + run) % cubics.length];
        if (before === void 0 || after === void 0 || before === after) break;
        const into = incoming(before);
        const out = outgoing(after);
        if (angleBetween(into, out) < turnLimit) continue;
        if (distance(before.p0, before.p3) < 2 * length || distance(after.p0, after.p3) < 2 * length) continue;
        const meet = intersectLines(before.p3, into, after.p0, out);
        if (meet === null || distance(meet, before.p3) > 2 * fillet || distance(meet, after.p0) > 2 * fillet) continue;
        if (check !== null) {
          const cap = [];
          for (let piece2 = 0; piece2 < run; piece2 += 1) {
            const cubic = cubics[(index + piece2) % cubics.length];
            if (cubic !== void 0) for (let step = 0; step < 8; step += 1) cap.push(bezier(cubic, step / 8));
          }
          cap.push({ ...after.p0 }, { ...meet });
          if (!check(cap)) continue;
        }
        before.p2 = { x: before.p2.x + meet.x - before.p3.x, y: before.p2.y + meet.y - before.p3.y };
        before.p3 = { ...meet };
        after.p1 = { x: after.p1.x + meet.x - after.p0.x, y: after.p1.y + meet.y - after.p0.y };
        after.p0 = { ...meet };
        for (let removed = 0; removed < run; removed += 1) {
          const at = index % cubics.length;
          cubics.splice(at, 1);
          if (at < index) index -= 1;
        }
        replaced = true;
      }
      if (!replaced) index += 1;
    }
    if (curl > 0) for (let joint = 0; joint < cubics.length; joint += 1) sharpenJoint(cubics, joint, curl, turnLimit, check);
    return { cubics, closed: subpath.closed };
  }
  var STRAIGHT_TOLERANCE = 0.15;
  function sharpenJoint(cubics, joint, fillet, turnLimit, check) {
    const before = cubics[(joint - 1 + cubics.length) % cubics.length];
    const after = cubics[joint];
    if (before === void 0 || after === void 0 || before === after) return;
    const tail = straightBody(reverseCubic(before));
    const head = straightBody(after);
    if (tail === null || head === null) return;
    const corner = after.p0;
    const from = bezier(before, 1 - tail.t);
    const to = bezier(after, head.t);
    if (distance(from, corner) + distance(corner, to) < 0.05) return;
    const into = { x: -tail.direction.x, y: -tail.direction.y };
    if (angleBetween(into, head.direction) < turnLimit) return;
    const reach = 3 * fillet;
    if (tail.length < Math.max(reach, 2 * distance(from, corner)) || head.length < Math.max(reach, 2 * distance(corner, to))) return;
    const meet = intersectLines(from, into, to, head.direction);
    if (meet === null || distance(meet, corner) > fillet) return;
    if ((meet.x - from.x) * into.x + (meet.y - from.y) * into.y < -0.05) return;
    if ((to.x - meet.x) * head.direction.x + (to.y - meet.y) * head.direction.y < -0.05) return;
    if (check !== null) {
      const cap = [];
      for (let step = 0; step <= 8; step += 1) cap.push(bezier(before, 1 - tail.t + tail.t * step / 8));
      for (let step = 1; step <= 8; step += 1) cap.push(bezier(after, head.t * step / 8));
      cap.push({ ...meet });
      if (!check(cap)) return;
    }
    const kept = splitCubic(before, 1 - tail.t)[0];
    const rest = splitCubic(after, head.t)[1];
    before.p0 = kept.p0;
    before.p1 = kept.p1;
    before.p2 = { x: kept.p2.x + meet.x - kept.p3.x, y: kept.p2.y + meet.y - kept.p3.y };
    before.p3 = { ...meet };
    after.p0 = { ...meet };
    after.p1 = { x: rest.p1.x + meet.x - rest.p0.x, y: rest.p1.y + meet.y - rest.p0.y };
    after.p2 = rest.p2;
    after.p3 = rest.p3;
  }
  function straightBody(cubic) {
    const end = bezier(cubic, 1);
    const anchor = bezier(cubic, 0.75);
    const aim = bezier(cubic, 0.45);
    const span = { x: aim.x - anchor.x, y: aim.y - anchor.y };
    const size = lengthOf(span);
    if (size < 0.5) return null;
    const unit2 = { x: span.x / size, y: span.y / size };
    const off = (point2) => Math.abs((point2.x - anchor.x) * unit2.y - (point2.y - anchor.y) * unit2.x);
    for (let step = 16; step >= 8; step -= 1) if (off(bezier(cubic, step / 20)) > STRAIGHT_TOLERANCE) return null;
    let t = 0.4;
    for (let step = 39; step >= 0; step -= 1) {
      const at = step / 100;
      if (off(bezier(cubic, at)) > STRAIGHT_TOLERANCE) break;
      t = at;
    }
    return { t, direction: { x: -unit2.x, y: -unit2.y }, length: distance(bezier(cubic, t), end) };
  }
  function reverseCubic(cubic) {
    return { p0: cubic.p3, p1: cubic.p2, p2: cubic.p1, p3: cubic.p0 };
  }
  function splitCubic(cubic, t) {
    const mix = (a2, b2) => ({ x: a2.x + (b2.x - a2.x) * t, y: a2.y + (b2.y - a2.y) * t });
    const a = mix(cubic.p0, cubic.p1), b = mix(cubic.p1, cubic.p2), c = mix(cubic.p2, cubic.p3);
    const d = mix(a, b), e = mix(b, c), f = mix(d, e);
    return [{ p0: cubic.p0, p1: a, p2: d, p3: f }, { p0: f, p1: e, p2: c, p3: cubic.p3 }];
  }
  function angleBetween(left, right) {
    const dot = left.x * right.x + left.y * right.y;
    const scale = lengthOf(left) * lengthOf(right);
    if (!(scale > 0)) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / scale)));
  }
  function intersectLines(a, da, b, db) {
    const cross = da.x * db.y - da.y * db.x;
    if (Math.abs(cross) < 1e-9) return null;
    const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / cross;
    return { x: a.x + da.x * t, y: a.y + da.y * t };
  }
  var FIT_WINDOW = 1.5;
  var FIT_MIN_TURN = 40;
  var FIT_SIDE = [1.25, 1.75, 2.25, 2.75, 3.25, 3.75];
  var FIT_SPLIT = 3.75;
  var FIT_BEND_MAX = 2.5;
  var FIT_STRAIGHT_TURN = 12;
  var FIT_SCALES = [1, 0.6];
  var FIT_RESIDUAL = 0.3;
  var FIT_REACH = 2.5;
  var FIT_CONTRAST = 48;
  var FIT_EXPOSED_AREA = 0.1;
  var FIT_FOLLOW = 0.75;
  var FIT_JOIN = 1;
  var FIT_PAIR_GAP = [2, 6];
  var FIT_PAIR_CLEAR = 0.75;
  function fitRasterCorners(svg, colourAt, confirm) {
    const shapes = [];
    const pattern = shapePattern();
    for (let match = pattern.exec(svg); match !== null; match = pattern.exec(svg)) {
      const tag = match[0];
      const fill = (/\bfill="([^"]*)"/i.exec(tag)?.[1] ?? "").toLowerCase();
      const shape = { tag, at: match.index, fill, subpaths: null, quoted: null, changed: false, rings: null, primitive: null };
      if (/^<path\b/i.test(tag)) {
        const quoted = readD(tag);
        const parsed = quoted === null ? null : parsePath(quoted.value);
        if (quoted !== null && parsed !== null && parsed.length > 0) {
          shape.quoted = quoted;
          shape.subpaths = parsed.map((subpath) => ({ cubics: [...subpath.cubics], closed: subpath.closed }));
        }
      } else shape.primitive = primitiveInside(tag);
      shapes.push(shape);
    }
    for (let order = 0; order < shapes.length; order += 1) {
      const shape = shapes[order];
      const subpaths = shape?.subpaths;
      if (shape === void 0 || subpaths === null || subpaths === void 0) continue;
      const under = shapes.slice(0, order).filter((other) => other.fill !== shape.fill && (other.subpaths !== null || other.primitive !== null));
      for (let index = 0; index < subpaths.length; index += 1) {
        for (let guard = 0; guard < 16; guard += 1) {
          const subpath = subpaths[index];
          if (subpath === void 0) break;
          const rings = flatten(subpaths);
          const inside = (x, y) => insideFlat(rings, x, y);
          const covers = (next2, cap, away, corner) => {
            if (under.length === 0) return true;
            const nextRings = flatten(subpaths.map((other, at) => at === index ? next2 : other));
            const after = (x, y) => insideFlat(nextRings, x, y);
            const exposed = exposedShapes(cap, inside, after, under, away);
            if (exposed.length === 0) return true;
            const edits = [];
            for (const below of exposed) {
              const followed = below.subpaths === null ? null : followCorner(below.subpaths, corner);
              if (followed === null) continue;
              edits.push({ shape: below, subpaths: followed });
            }
            const trial = new Map(edits.map((edit) => [edit.shape, flatten(edit.subpaths)]));
            const still = exposedShapes(cap, inside, after, under, away, trial).filter((below) => trial.has(below));
            if (still.length > 0) return false;
            for (const edit of edits) {
              edit.shape.subpaths = edit.subpaths;
              edit.shape.rings = trial.get(edit.shape) ?? null;
              edit.shape.changed = true;
            }
            return true;
          };
          const next = fitOneCorner(subpath, colourAt, (cap) => confirm(shape.fill, cap, inside), inside, covers);
          if (next === null) break;
          subpaths[index] = next;
          shape.changed = true;
        }
      }
      shape.rings = flatten(subpaths);
    }
    let out = "";
    let cursor = 0;
    for (const shape of shapes) {
      if (!shape.changed || shape.subpaths === null || shape.quoted === null) continue;
      out += svg.slice(cursor, shape.at) + shape.tag.slice(0, shape.quoted.start) + serialize(shape.subpaths) + shape.tag.slice(shape.quoted.end);
      cursor = shape.at + shape.tag.length;
    }
    return out + svg.slice(cursor);
  }
  function shapeInside(shape, rings, x, y) {
    if (shape.primitive !== null) return shape.primitive(x, y);
    const flat = rings ?? shape.rings;
    return flat !== null && insideFlat(flat, x, y);
  }
  function exposedShapes(cap, before, after, under, away, trial = /* @__PURE__ */ new Map()) {
    const xs = cap.map((point2) => point2.x);
    const ys = cap.map((point2) => point2.y);
    const step = 0.125;
    const area = /* @__PURE__ */ new Map();
    for (let y = Math.floor(Math.min(...ys)) - 1 + step / 2; y < Math.max(...ys) + 1; y += step) {
      for (let x = Math.floor(Math.min(...xs)) - 1 + step / 2; x < Math.max(...xs) + 1; x += step) {
        if (!before(x, y) || after(x, y)) continue;
        let shown;
        for (let at = under.length - 1; at >= 0 && shown === void 0; at -= 1) {
          const shape = under[at];
          if (shape !== void 0 && shapeInside(shape, trial.get(shape), x, y)) shown = shape;
        }
        if (shown === void 0) continue;
        const theirs = rgbOf(shown.fill);
        if (theirs !== null && distanceRgb(theirs, away) <= FIT_CONTRAST) continue;
        area.set(shown, (area.get(shown) ?? 0) + step * step);
      }
    }
    return [...area].filter(([, value]) => value > FIT_EXPOSED_AREA).map(([shape]) => shape);
  }
  function followCorner(subpaths, corner) {
    for (let index = 0; index < subpaths.length; index += 1) {
      const subpath = subpaths[index];
      if (subpath === void 0 || !subpath.closed || subpath.cubics.length < 2) continue;
      const list = stations(subpath.cubics);
      const last = list[list.length - 1];
      const first = list[0];
      if (last === void 0 || first === void 0) continue;
      const total = last.at + distance(last.point, first.point);
      const nearest2 = (point2) => {
        let best = null;
        for (const station of list) if (best === null || distance(station.point, point2) < distance(best.point, point2)) best = station;
        return best !== null && distance(best.point, point2) <= FIT_FOLLOW ? best : null;
      };
      const start2 = nearest2(corner.start);
      const end = nearest2(corner.end);
      if (start2 === null || end === null) continue;
      const forward = ((end.at - start2.at) % total + total) % total;
      const reversed = forward > total / 2;
      const from = reversed ? end : start2;
      const to = reversed ? start2 : end;
      const vertices = reversed ? [...corner.vertices].reverse() : corner.vertices;
      const next = spliceCorner(subpath, from, to, vertices[0] ?? corner.start, (a, b) => {
        const points = [a, ...vertices, b];
        return points.slice(1).map((point2, at) => line(points[at], point2));
      });
      if (next === null) return null;
      return subpaths.map((other, at) => at === index ? next : other);
    }
    return null;
  }
  function rgbOf(fill) {
    const match = /^#([0-9a-f]{6})$/i.exec(fill);
    if (match?.[1] === void 0) return null;
    const value = Number.parseInt(match[1], 16);
    return [value >> 16 & 255, value >> 8 & 255, value & 255];
  }
  function distanceRgb(a, b) {
    return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
  }
  function primitiveInside(tag) {
    if (/\btransform=/i.test(tag)) return null;
    const number = (name) => {
      const match = new RegExp("\\b" + name + '="([^"]*)"', "i").exec(tag);
      const value = match?.[1] === void 0 ? Number.NaN : Number.parseFloat(match[1]);
      return Number.isFinite(value) ? value : null;
    };
    if (/^<circle\b/i.test(tag)) {
      const cx = number("cx") ?? 0;
      const cy = number("cy") ?? 0;
      const r = number("r");
      return r === null ? null : (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    }
    if (/^<ellipse\b/i.test(tag)) {
      const cx = number("cx") ?? 0;
      const cy = number("cy") ?? 0;
      const rx = number("rx");
      const ry = number("ry");
      return rx === null || ry === null || rx <= 0 || ry <= 0 ? null : (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    }
    const left = number("x") ?? 0;
    const top = number("y") ?? 0;
    const width = number("width");
    const height = number("height");
    return width === null || height === null ? null : (x, y) => x >= left && x <= left + width && y >= top && y <= top + height;
  }
  function stations(cubics) {
    const out = [];
    let at = 0;
    let previous = null;
    cubics.forEach((cubic, index) => {
      const steps = Math.max(2, Math.ceil(chord(cubic) / 0.2));
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        const point2 = bezier(cubic, t);
        if (previous !== null) at += distance(previous, point2);
        out.push({ point: point2, cubic: index, t, at });
        previous = point2;
      }
    });
    return out;
  }
  function fitOneCorner(subpath, colourAt, check, inside, covers) {
    if (!subpath.closed || subpath.cubics.length < 2) return null;
    const list = stations(subpath.cubics);
    const last = list[list.length - 1];
    const first = list[0];
    if (last === void 0 || first === void 0) return null;
    const total = last.at + distance(last.point, first.point);
    if (total < 4 * FIT_SPLIT * Math.min(...FIT_SCALES)) return null;
    const pointAt = (at) => {
      const wrapped = (at % total + total) % total;
      let low = 0;
      let high = list.length - 1;
      while (low < high) {
        const middle = low + high + 1 >> 1;
        if ((list[middle]?.at ?? 0) <= wrapped) low = middle;
        else high = middle - 1;
      }
      return list[low] ?? first;
    };
    const turnAt = (station) => {
      const back = pointAt(station.at - FIT_WINDOW).point;
      const ahead = pointAt(station.at + FIT_WINDOW).point;
      const into = unit({ x: station.point.x - back.x, y: station.point.y - back.y });
      const out = unit({ x: ahead.x - station.point.x, y: ahead.y - station.point.y });
      return into === null || out === null ? 0 : angleBetween(into, out) * 180 / Math.PI;
    };
    const breaks = list.filter((station) => {
      if (station.t !== 0) return false;
      const previous = subpath.cubics[(station.cubic - 1 + subpath.cubics.length) % subpath.cubics.length];
      const current = subpath.cubics[station.cubic];
      return previous !== void 0 && current !== void 0 && angleBetween(incoming(previous), outgoing(current)) >= 30 * Math.PI / 180;
    }).map((station) => station.at);
    const turns = list.map(turnAt);
    const localTurn = (at) => {
      const here = pointAt(at).point;
      const back = pointAt(at - 0.5).point;
      const ahead = pointAt(at + 0.5).point;
      const into = unit({ x: here.x - back.x, y: here.y - back.y });
      const out = unit({ x: ahead.x - here.x, y: ahead.y - here.y });
      return into === null || out === null ? 0 : angleBetween(into, out) * 180 / Math.PI;
    };
    const candidates = [];
    for (let index = 0; index < list.length; index += 1) {
      const turn = turns[index] ?? 0;
      if (turn < FIT_MIN_TURN) continue;
      let peak = true;
      for (let other = 0; other < list.length && peak; other += 1) {
        const gap = Math.abs((list[other]?.at ?? 0) - (list[index]?.at ?? 0));
        if (other !== index && Math.min(gap, total - gap) <= 1 && (turns[other] ?? 0) > turn) peak = false;
      }
      if (peak) candidates.push(index);
    }
    for (const index of candidates) {
      const centre = list[index];
      if (centre === void 0) continue;
      if (breaks.some((at) => Math.min(Math.abs(at - centre.at), total - Math.abs(at - centre.at)) <= 1)) continue;
      const bendEnd = (sign) => {
        for (let reach = 0; reach <= FIT_BEND_MAX; reach += 0.125) if (localTurn(centre.at + sign * reach) < FIT_STRAIGHT_TURN) return reach;
        return FIT_BEND_MAX;
      };
      const bendBefore = bendEnd(-1);
      const bendAfter = bendEnd(1);
      for (const scale of FIT_SCALES) {
        const spanBefore = bendBefore + FIT_SPLIT * scale;
        const spanAfter = bendAfter + FIT_SPLIT * scale;
        if (total < 2 * (spanBefore + spanAfter)) continue;
        const before = sideLine(centre.at, -1, FIT_SIDE.map((offset) => bendBefore + offset * scale), pointAt, colourAt, inside);
        const after = sideLine(centre.at, 1, FIT_SIDE.map((offset) => bendAfter + offset * scale), pointAt, colourAt, inside);
        if (before === null || after === null) continue;
        if (angleBetween(before.direction, after.direction) < 35 * Math.PI / 180) continue;
        const meet = intersectLines(before.origin, before.direction, after.origin, after.direction);
        if (meet === null || distance(meet, centre.point) > FIT_REACH * scale + Math.max(bendBefore, bendAfter)) continue;
        const start2 = pointAt(centre.at - spanBefore);
        const end = pointAt(centre.at + spanAfter);
        if ((meet.x - start2.point.x) * before.direction.x + (meet.y - start2.point.y) * before.direction.y <= 0) continue;
        if ((end.point.x - meet.x) * after.direction.x + (end.point.y - meet.y) * after.direction.y <= 0) continue;
        const cap = [];
        for (let at = centre.at - spanBefore; at <= centre.at + spanAfter; at += 0.2) cap.push(pointAt(at).point);
        cap.push(end.point, { ...meet });
        if (!check(cap)) continue;
        const onLine = (point2, side) => {
          const t = (point2.x - side.origin.x) * side.direction.x + (point2.y - side.origin.y) * side.direction.y;
          return { x: side.origin.x + side.direction.x * t, y: side.origin.y + side.direction.y * t };
        };
        let middle = null;
        let vertices = [meet];
        const lead = Math.min(FIT_JOIN, 0.5 * distance(start2.point, meet));
        const trail = Math.min(FIT_JOIN, 0.5 * distance(end.point, meet));
        const inPoint = onLine(pointAt(centre.at - spanBefore + lead).point, before);
        const outPoint = onLine(pointAt(centre.at + spanAfter - trail).point, after);
        const startTangent = unit({ x: pointAt(centre.at - spanBefore + 0.2).point.x - start2.point.x, y: pointAt(centre.at - spanBefore + 0.2).point.y - start2.point.y });
        const endTangent = unit({ x: end.point.x - pointAt(centre.at + spanAfter - 0.2).point.x, y: end.point.y - pointAt(centre.at + spanAfter - 0.2).point.y });
        if (startTangent !== null && endTangent !== null) {
          const ease = (from, fromTangent, to, toTangent) => {
            const k = distance(from, to) / 3;
            return { p0: from, p1: { x: from.x + fromTangent.x * k, y: from.y + fromTangent.y * k }, p2: { x: to.x - toTangent.x * k, y: to.y - toTangent.y * k }, p3: to };
          };
          middle = (from, to) => [ease(from, startTangent, inPoint, before.direction), line(inPoint, meet), line(meet, outPoint), ease(outPoint, after.direction, to, endTangent)];
          vertices = [inPoint, meet, outPoint];
        }
        const next = spliceCorner(subpath, start2, end, meet, middle);
        if (next === null) return null;
        const away = before.away.map((value, channel) => (value + after.away[channel]) / 2);
        if (!covers(next, cap, away, { start: start2.point, end: end.point, vertices })) continue;
        return next;
      }
    }
    const bendFrom = (at, sign) => {
      for (let reach = 0; reach <= FIT_BEND_MAX; reach += 0.125) if (localTurn(at + sign * reach) < FIT_STRAIGHT_TURN) return reach;
      return FIT_BEND_MAX;
    };
    const pairs = [];
    for (const index of candidates) {
      const here = list[index];
      if (here === void 0) continue;
      for (const other of candidates) {
        const there = list[other];
        if (there !== void 0 && there !== here) pairs.push([here, there]);
      }
      for (let gap = FIT_PAIR_GAP[0]; gap <= FIT_PAIR_GAP[1]; gap += 0.5) {
        pairs.push([here, pointAt(here.at + gap)], [pointAt(here.at - gap), here]);
      }
    }
    for (const [first2, second] of pairs) {
      const gap = ((second.at - first2.at) % total + total) % total;
      if (gap < FIT_PAIR_GAP[0] || gap > FIT_PAIR_GAP[1]) continue;
      if (breaks.some((at) => [first2.at, second.at].some((corner) => Math.min(Math.abs(at - corner), total - Math.abs(at - corner)) <= 1))) continue;
      const bendBefore = bendFrom(first2.at, -1);
      const bendAfter = bendFrom(first2.at + gap, 1);
      const inner = gap - 2 * FIT_PAIR_CLEAR;
      if (inner < 1) continue;
      const middleOffsets = [0, 0.25, 0.5, 0.75, 1].map((share) => FIT_PAIR_CLEAR + share * inner);
      const middle = sideLine(first2.at, 1, middleOffsets, pointAt, colourAt, inside);
      if (middle === null) continue;
      for (const scale of FIT_SCALES) {
        const spanBefore = bendBefore + FIT_SPLIT * scale;
        const spanAfter = bendAfter + FIT_SPLIT * scale;
        if (total < 2 * (spanBefore + spanAfter + gap)) continue;
        const before = sideLine(first2.at, -1, FIT_SIDE.map((offset) => bendBefore + offset * scale), pointAt, colourAt, inside);
        const after = sideLine(first2.at + gap, 1, FIT_SIDE.map((offset) => bendAfter + offset * scale), pointAt, colourAt, inside);
        if (before === null || after === null) continue;
        if (angleBetween(before.direction, middle.direction) < 35 * Math.PI / 180) continue;
        if (angleBetween(middle.direction, after.direction) < 35 * Math.PI / 180) continue;
        const turnOf = (a, b) => a.x * b.y - a.y * b.x;
        if (turnOf(before.direction, middle.direction) * turnOf(middle.direction, after.direction) <= 0) continue;
        const one = intersectLines(before.origin, before.direction, middle.origin, middle.direction);
        const two = intersectLines(middle.origin, middle.direction, after.origin, after.direction);
        if (one === null || two === null) continue;
        if (distance(one, first2.point) > FIT_REACH * scale + bendBefore || distance(two, second.point) > FIT_REACH * scale + bendAfter) continue;
        const start2 = pointAt(first2.at - spanBefore);
        const end = pointAt(first2.at + gap + spanAfter);
        const ahead = (from, to, direction) => (to.x - from.x) * direction.x + (to.y - from.y) * direction.y > 0;
        if (!ahead(start2.point, one, before.direction) || !ahead(one, two, middle.direction) || !ahead(two, end.point, after.direction)) continue;
        const cap = [];
        for (let at = first2.at - spanBefore; at <= first2.at + gap + spanAfter; at += 0.2) cap.push(pointAt(at).point);
        cap.push(end.point, { ...two }, { ...one });
        if (!check(cap)) continue;
        const next = spliceCorner(subpath, start2, end, one, (from, to) => [line(from, one), line(one, two), line(two, to)]);
        if (next === null) continue;
        const away = [0, 1, 2].map((channel) => (before.away[channel] + after.away[channel]) / 2);
        if (!covers(next, cap, away, { start: start2.point, end: end.point, vertices: [one, two] })) continue;
        return next;
      }
    }
    return null;
  }
  function sideLine(centre, side, offsets, pointAt, colourAt, inside) {
    const snapped = [];
    const outside = [0, 0, 0];
    for (const offset of offsets) {
      const here = pointAt(centre + side * offset).point;
      const a = pointAt(centre + side * offset - 0.3).point;
      const b = pointAt(centre + side * offset + 0.3).point;
      const tangent = unit({ x: b.x - a.x, y: b.y - a.y });
      if (tangent === null) return null;
      let normal = { x: tangent.y, y: -tangent.x };
      const outA = inside(here.x + normal.x * 0.6, here.y + normal.y * 0.6);
      const outB = inside(here.x - normal.x * 0.6, here.y - normal.y * 0.6);
      if (outA === outB) return null;
      if (outA) normal = { x: -normal.x, y: -normal.y };
      const ink = colourAt(here.x - normal.x * 2, here.y - normal.y * 2);
      const away = colourAt(here.x + normal.x * 2, here.y + normal.y * 2);
      if (ink === null || away === null) return null;
      const span = [away[0] - ink[0], away[1] - ink[1], away[2] - ink[2]];
      const spanSquared = span[0] ** 2 + span[1] ** 2 + span[2] ** 2;
      if (spanSquared < FIT_CONTRAST ** 2) return null;
      for (let channel = 0; channel < 3; channel += 1) outside[channel] += away[channel] / offsets.length;
      const mix = (k) => {
        const colour = colourAt(here.x + normal.x * k, here.y + normal.y * k);
        if (colour === null) return null;
        return ((colour[0] - ink[0]) * span[0] + (colour[1] - ink[1]) * span[1] + (colour[2] - ink[2]) * span[2]) / spanSquared;
      };
      let crossing = null;
      for (let step = 0; step <= 12 && crossing === null; step += 1) {
        for (const sign of [1, -1]) {
          const k0 = sign * step * 0.125;
          const k1 = k0 + 0.125;
          const m0 = mix(k0);
          const m1 = mix(k1);
          if (m0 === null || m1 === null) continue;
          if ((m0 - 0.5) * (m1 - 0.5) <= 0 && m0 !== m1) {
            crossing = k0 + (0.5 - m0) / (m1 - m0) * 0.125;
            break;
          }
        }
      }
      if (crossing === null) return null;
      snapped.push({ x: here.x + normal.x * crossing, y: here.y + normal.y * crossing });
    }
    const mean = snapped.reduce((sum, point2) => ({ x: sum.x + point2.x / snapped.length, y: sum.y + point2.y / snapped.length }), { x: 0, y: 0 });
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const point2 of snapped) {
      xx += (point2.x - mean.x) ** 2;
      xy += (point2.x - mean.x) * (point2.y - mean.y);
      yy += (point2.y - mean.y) ** 2;
    }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    let direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const residual = Math.sqrt(snapped.reduce((sum, point2) => sum + ((point2.x - mean.x) * direction.y - (point2.y - mean.y) * direction.x) ** 2, 0) / snapped.length);
    if (residual > FIT_RESIDUAL) return null;
    const firstPoint = snapped[0];
    const lastPoint = snapped[snapped.length - 1];
    if (firstPoint === void 0 || lastPoint === void 0) return null;
    const travel = side < 0 ? { x: firstPoint.x - lastPoint.x, y: firstPoint.y - lastPoint.y } : { x: lastPoint.x - firstPoint.x, y: lastPoint.y - firstPoint.y };
    if (travel.x * direction.x + travel.y * direction.y < 0) direction = { x: -direction.x, y: -direction.y };
    return { origin: mean, direction, away: [outside[0], outside[1], outside[2]] };
  }
  function spliceCorner(subpath, start2, end, meet, middle = null) {
    const corner = (from, to) => middle === null ? [line(from, meet), line(meet, to)] : middle(from, to);
    const count = subpath.cubics.length;
    const rotated = [...subpath.cubics.slice(start2.cubic), ...subpath.cubics.slice(0, start2.cubic)];
    const endIndex = (end.cubic - start2.cubic + count) % count;
    if (endIndex === 0 && end.t <= start2.t) return null;
    const head = rotated[0];
    const tail = rotated[endIndex];
    if (head === void 0 || tail === void 0) return null;
    const cubics = [];
    if (endIndex === 0) {
      const [kept, rest] = splitCubic(head, start2.t);
      const [, after] = splitCubic(rest, (end.t - start2.t) / (1 - start2.t));
      if (start2.t > 0) cubics.push(kept);
      cubics.push(...corner(kept.p3, after.p0), after);
      for (let index = 1; index < count; index += 1) {
        const cubic = rotated[index];
        if (cubic !== void 0) cubics.push(cubic);
      }
    } else {
      const kept = splitCubic(head, start2.t)[0];
      const after = splitCubic(tail, end.t)[1];
      if (start2.t > 0) cubics.push(kept);
      cubics.push(...corner(kept.p3, after.p0));
      if (end.t < 1) cubics.push(after);
      for (let index = endIndex + 1; index < count; index += 1) {
        const cubic = rotated[index];
        if (cubic !== void 0) cubics.push(cubic);
      }
    }
    return { cubics, closed: true };
  }

  // src/png-alpha.ts
  var zlib = __toESM(__require("zlib"));

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
    return { rgba: next, droppedColor: hex(sentinel) };
  }
  async function punchRgbaAsync(rgba, width, height, opaqueAt = 128, onProgress, shouldCancel) {
    if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    let lastYield = Date.now();
    const cooperate2 = async () => {
      if (Date.now() - lastYield < 20) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = Date.now();
      if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    };
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
      if (alpha < cutoff) transparent += 1;
      else used.add((rgba[offset] ?? 0) << 16 | (rgba[offset + 1] ?? 0) << 8 | (rgba[offset + 2] ?? 0));
      if (index % 8192 === 0) {
        onProgress?.(0.45 * index / count);
        await cooperate2();
      }
    }
    if (transparent === 0) {
      let needsFlattening = false;
      for (let index = 0; index < count; index += 1) {
        if ((rgba[index * 4 + 3] ?? 255) !== 255) {
          needsFlattening = true;
          break;
        }
        if (index % 8192 === 0) await cooperate2();
      }
      if (!needsFlattening) {
        onProgress?.(1);
        return { rgba, droppedColor: null };
      }
      const opaque = new Uint8Array(rgba);
      for (let index = 0; index < count; index += 1) {
        opaque[index * 4 + 3] = 255;
        if (index % 8192 === 0) {
          onProgress?.(0.45 + 0.55 * index / count);
          await cooperate2();
        }
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
      if (index % 8192 === 0) {
        onProgress?.(0.45 + 0.55 * index / count);
        await cooperate2();
      }
    }
    onProgress?.(1);
    return { rgba: next, droppedColor: hex(sentinel) };
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
  function hex(color) {
    return "#" + color.toString(16).padStart(6, "0");
  }

  // src/png-alpha.ts
  function pngSignature() {
    return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  }
  var CRC_TABLE = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
    CRC_TABLE[index] = value;
  }
  function readPngDimensions(png) {
    if (png.length < 33 || !png.subarray(0, 8).equals(pngSignature())) return null;
    if (png.readUInt32BE(8) !== 13 || png.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width === 0 || height === 0) return null;
    return { width, height };
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
    for (const byte3 of data) crc = (CRC_TABLE[(crc ^ byte3) & 255] ?? 0) ^ crc >>> 8;
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

  // src/score.ts
  var ARG_COUNT2 = {
    m: 2,
    l: 2,
    h: 1,
    v: 1,
    c: 6,
    s: 4,
    q: 4,
    t: 2,
    a: 7,
    z: 0
  };
  function holeNote(holes) {
    if (!Number.isInteger(holes) || holes <= 0) return null;
    return "\u0E21\u0E35\u0E23\u0E39 " + String(holes) + " \u0E08\u0E38\u0E14";
  }
  function shapeNote(facts) {
    const parts = [];
    if (facts.circles > 0) parts.push("\u0E27\u0E07\u0E01\u0E25\u0E21 " + String(facts.circles));
    if (facts.ellipses > 0) parts.push("\u0E27\u0E07\u0E23\u0E35 " + String(facts.ellipses));
    const sharpRects = Math.max(0, facts.rects - facts.roundRects);
    if (sharpRects > 0) parts.push("\u0E2A\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E35\u0E48\u0E22\u0E21 " + String(sharpRects));
    if (facts.roundRects > 0) parts.push("\u0E2A\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E35\u0E48\u0E22\u0E21\u0E21\u0E38\u0E21\u0E21\u0E19 " + String(facts.roundRects));
    return parts.length === 0 ? null : parts.join(" \xB7 ");
  }
  function scoreSvg(svg) {
    const palette = [];
    const seen = /* @__PURE__ */ new Set();
    let paths = 0;
    let anchors = 0;
    let holes = 0;
    let circles = 0;
    let ellipses = 0;
    let rects = 0;
    let roundRects = 0;
    for (const tag of pathTags(svg)) {
      const name = elementName(tag.source);
      const attrs = tagAttrs(tag.source);
      const fill = normalizeFill(fillOf(attrs));
      if (name === "path") {
        const data = readAttr2(attrs, "d");
        if (data === null || data.trim() === "") continue;
        paths += 1;
        rememberFill(fill, seen, palette);
        const measured = measurePath(data);
        anchors += measured.anchors;
        holes += measured.holes;
        continue;
      }
      if (measurePrimitive(name, attrs) === null) continue;
      paths += 1;
      anchors += 4;
      rememberFill(fill, seen, palette);
      if (name === "circle") circles += 1;
      else if (name === "ellipse") ellipses += 1;
      else if (name === "rect") {
        rects += 1;
        const rx = Number(readAttr2(attrs, "rx") ?? "0");
        const ry = Number(readAttr2(attrs, "ry") ?? "0");
        if (Number.isFinite(rx) && rx > 0.5 || Number.isFinite(ry) && ry > 0.5) roundRects += 1;
      }
    }
    return { paths, anchors, holes, colors: palette.length, palette, circles, ellipses, rects, roundRects };
  }
  function rememberFill(fill, seen, palette) {
    if (fill === null || seen.has(fill)) return;
    seen.add(fill);
    palette.push(fill);
  }
  function dropCanvasBackground(svg, borderColor) {
    if (borderColor === void 0 || borderColor === null || borderColor.trim() === "") return svg;
    const border = normalizeFill(borderColor);
    if (border === null) return svg;
    const size = canvasSize(svg);
    if (size === null) return svg;
    const matches = pathTags(svg);
    if (matches.length < 2) return svg;
    const sources = matches.map((tag) => tag.source);
    for (let index = sources.length - 1; index >= 0; index -= 1) {
      const split = borderSplit(sources[index] ?? "", border, size.width, size.height);
      if (split === null) continue;
      sources[index] = split.kept;
      if (split.holes.length === 0) continue;
      const under = canvasPlateBelow(sources, index, size.width, size.height, border);
      if (under < 0) continue;
      sources[under] = shapeWithData(sources[under] ?? "", split.holes.join(" "));
    }
    let result = svg;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const tag = matches[index];
      const next = sources[index] ?? "";
      if (tag === void 0 || next === tag.source) continue;
      result = result.slice(0, tag.index) + next + result.slice(tag.index + tag.length);
    }
    return result;
  }
  function borderSplit(source, border, width, height) {
    const attrs = tagAttrs(source);
    const fill = normalizeFill(fillOf(attrs));
    if (fill === null || !samePaint(fill, border)) return null;
    if (elementName(source) !== "path") {
      const measured = measureTag({ index: 0, length: source.length, source });
      if (measured === null || edgesTouched(measured, width, height) < 3) return null;
      return { kept: "", holes: [] };
    }
    const data = readAttr2(attrs, "d");
    if (data === null) return null;
    const parts = pathSubpaths(data);
    const pieces = parts.map((part) => ({ part, measured: measurePath(part) }));
    const shells = pieces.filter((piece) => edgesTouched(piece.measured, width, height) >= 3);
    if (shells.length === 0) return null;
    const holes = [];
    const kept = pieces.filter((piece) => {
      if (shells.includes(piece)) return false;
      const sign = winding(piece.measured.samples);
      const center = centroid(piece.measured.samples);
      for (const shell of shells) {
        if (winding(shell.measured.samples) === sign) continue;
        if (pointInPoly(center, shell.measured.samples)) {
          holes.push(piece.part);
          return false;
        }
      }
      return true;
    });
    if (kept.length === pieces.length) return null;
    if (kept.length === 0) return { kept: "", holes };
    const quoted = '"' + data + '"';
    const at = source.indexOf(quoted);
    if (at < 0) return { kept: "", holes };
    return { kept: source.slice(0, at + 1) + kept.map((piece) => piece.part).join(" ") + source.slice(at + quoted.length - 1), holes };
  }
  function canvasPlateBelow(sources, before, width, height, border) {
    for (let index = before - 1; index >= 0; index -= 1) {
      const source = sources[index] ?? "";
      if (source === "") continue;
      const fill = normalizeFill(fillOf(tagAttrs(source)));
      if (fill === null || samePaint(fill, border)) continue;
      const data = readAttr2(tagAttrs(source), "d");
      if (data !== null) {
        if (pathSubpaths(data).some((part) => edgesTouched(measurePath(part), width, height) >= 3)) return index;
        continue;
      }
      const measured = measureTag({ index: 0, length: source.length, source });
      if (measured !== null && edgesTouched(measured, width, height) >= 3) return index;
    }
    return -1;
  }
  function shapeWithData(tag, data) {
    if (elementName(tag) === "path" && /\bd="/.test(tag)) return tag.replace(/\bd="[^"]*"/, 'd="' + data + '"');
    const fill = fillOf(tagAttrs(tag)) ?? "#000";
    return '<path d="' + data + '" fill="' + fill.replace(/"/g, "") + '"/>';
  }
  function pathSubpaths(data) {
    const commands = tokenize2(data);
    const groups = [];
    let current = "";
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    const text = (value) => String(Math.round(value * 100) / 100);
    for (const command of commands) {
      const op = command.cmd.toLowerCase();
      const relative = command.cmd === op;
      const args = command.args;
      const at = (index, base) => relative ? base + (args[index] ?? 0) : args[index] ?? 0;
      if (op === "m") {
        if (current !== "") groups.push(current);
        x = at(0, x);
        y = at(1, y);
        startX = x;
        startY = y;
        current = "M" + text(x) + " " + text(y);
      } else if (op === "l") {
        x = at(0, x);
        y = at(1, y);
        current += "L" + text(x) + " " + text(y);
      } else if (op === "h") {
        x = at(0, x);
        current += "H" + text(x);
      } else if (op === "v") {
        y = at(0, y);
        current += "V" + text(y);
      } else if (op === "c") {
        const curve = [at(0, x), at(1, y), at(2, x), at(3, y), at(4, x), at(5, y)];
        x = curve[4] ?? x;
        y = curve[5] ?? y;
        current += "C" + curve.map((value) => text(value)).join(" ");
      } else if (op === "z") {
        x = startX;
        y = startY;
        current += "Z";
      }
    }
    if (current !== "") groups.push(current);
    return groups;
  }
  function winding(samples) {
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const current = samples[index];
      const next = samples[(index + 1) % samples.length];
      if (current === void 0 || next === void 0) continue;
      sum += current.x * next.y - next.x * current.y;
    }
    return Math.sign(sum);
  }
  function edgesTouched(measured, width, height) {
    let left = false;
    let right = false;
    let top = false;
    let bottom = false;
    for (const point2 of measured.samples) {
      if (point2.x <= 1) left = true;
      if (point2.y <= 1) top = true;
      if (point2.x >= width - 1) right = true;
      if (point2.y >= height - 1) bottom = true;
    }
    return Number(left) + Number(right) + Number(top) + Number(bottom);
  }
  function samePaint(fill, border) {
    if (fill === border) return true;
    const left = rgbOf2(fill);
    const right = rgbOf2(border);
    if (left === null || right === null) return false;
    return Math.abs(left[0] - right[0]) <= 18 && Math.abs(left[1] - right[1]) <= 18 && Math.abs(left[2] - right[2]) <= 18;
  }
  function rgbOf2(fill) {
    const match = /^#([0-9a-f]{6})$/i.exec(fill);
    if (match === null) return null;
    const hex3 = match[1] ?? "";
    return [Number.parseInt(hex3.slice(0, 2), 16), Number.parseInt(hex3.slice(2, 4), 16), Number.parseInt(hex3.slice(4, 6), 16)];
  }
  function dropFill(svg, fill) {
    const target = normalizeFill(fill);
    if (target === null) return svg;
    const tags = pathTags(svg);
    const matches = tags.filter((tag) => normalizeFill(fillOf(tagAttrs(tag.source))) === target);
    if (matches.length === 0 || matches.length >= tags.length) return svg;
    let result = svg;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const tag = matches[index];
      if (tag === void 0) continue;
      result = result.slice(0, tag.index) + result.slice(tag.index + tag.length);
    }
    return result;
  }
  function fitShapes(svg) {
    const tags = pathTags(svg);
    if (tags.length === 0) return svg;
    const box = /viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
    const canvas = box === null ? null : { x: Number(box[1]), y: Number(box[2]), width: Number(box[3]), height: Number(box[4]) };
    const touching = canvas === null ? [] : tags.map((tag) => {
      const data = elementName(tag.source) === "path" ? readAttr2(tagAttrs(tag.source), "d") : null;
      if (data === null) return false;
      const measured = measurePath(data);
      if (measured.area < 0.02 * canvas.width * canvas.height) return false;
      return measured.minX <= canvas.x + 0.05 || measured.minY <= canvas.y + 0.05 || measured.maxX >= canvas.x + canvas.width - 0.05 || measured.maxY >= canvas.y + canvas.height - 0.05;
    });
    const touchCount = touching.filter(Boolean).length;
    let result = "";
    let cursor = 0;
    for (const [index, tag] of tags.entries()) {
      result += svg.slice(cursor, tag.index);
      result += fittedMarkup(tag, touching[index] === true && touchCount === 1 ? canvas : null) ?? tag.source;
      cursor = tag.index + tag.length;
    }
    return result + svg.slice(cursor);
  }
  function unifyNearFills(svg) {
    const tags = pathTags(svg);
    const area = /* @__PURE__ */ new Map();
    const fills = tags.map((tag) => {
      const attrs = tagAttrs(tag.source);
      const fill = readAttr2(attrs, "fill");
      const data = readAttr2(attrs, "d");
      if (fill === null || !/^#[0-9a-f]{6}$/i.test(fill) || data === null) return null;
      const key = fill.toUpperCase();
      area.set(key, (area.get(key) ?? 0) + Math.abs(measurePath(data).area));
      return key;
    });
    if (area.size < 2) return svg;
    const rgb = (hex3) => [1, 3, 5].map((at) => parseInt(hex3.slice(at, at + 2), 16));
    const target = /* @__PURE__ */ new Map();
    const ranked = [...area.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    for (const [rank, key] of ranked.entries()) {
      const own = rgb(key);
      const into = ranked.slice(0, rank).find((other) => target.get(other) === void 0 && rgb(other).every((value, channel) => Math.abs(value - (own[channel] ?? 0)) <= NEAR_FILL));
      if (into !== void 0) target.set(key, into);
    }
    if (target.size === 0) return svg;
    let result = "";
    let cursor = 0;
    for (const [index, tag] of tags.entries()) {
      const into = fills[index] === null ? void 0 : target.get(fills[index] ?? "");
      result += svg.slice(cursor, tag.index);
      result += into === void 0 ? tag.source : tag.source.replace(/fill="[^"]*"/i, 'fill="' + into + '"');
      cursor = tag.index + tag.length;
    }
    return result + svg.slice(cursor);
  }
  var NEAR_FILL = 2;
  function sealGaps(svg, strokeWidth = 0.8) {
    const width = Math.round(Math.min(4, Math.max(0.8, strokeWidth)) * 10) / 10;
    return svg.replace(/<(path|circle|ellipse|rect)\b([^>]*?)\s*(\/?)\s*>/gi, (full, name, attrs, slash) => {
      if (/\bstroke\s*=/i.test(attrs)) return full;
      const fill = fillOf(attrs);
      const paint = normalizeFill(fill);
      if (fill === null || paint === null) return full;
      return "<" + name + attrs + ' stroke="' + fill.replace(/"/g, "") + '" stroke-width="' + String(width) + '" stroke-linejoin="round"' + (slash === "/" ? "/" : "") + ">";
    });
  }
  function fittedMarkup(tag, canvas = null) {
    if (elementName(tag.source) !== "path") return null;
    const attrs = tagAttrs(tag.source);
    const data = readAttr2(attrs, "d");
    if (data === null) return null;
    const measured = measurePath(data);
    if (measured.loops !== 1 || measured.samples.length < 4) return null;
    const fill = fillOf(attrs);
    const fillAttr = fill === null ? "" : ' fill="' + fill.replace(/"/g, "") + '"';
    const rect = fitRect(measured);
    if (rect !== null) return '<rect x="' + fmt2(rect.x) + '" y="' + fmt2(rect.y) + '" width="' + fmt2(rect.width) + '" height="' + fmt2(rect.height) + '"' + fillAttr + "/>";
    const round = fitRoundRect(measured);
    if (round !== null) return '<rect x="' + fmt2(round.x) + '" y="' + fmt2(round.y) + '" width="' + fmt2(round.width) + '" height="' + fmt2(round.height) + '" rx="' + fmt2(round.r) + '" ry="' + fmt2(round.r) + '"' + fillAttr + "/>";
    const circle = fitCircle(measured, canvas);
    if (circle !== null) return '<circle cx="' + fmt2(circle.cx) + '" cy="' + fmt2(circle.cy) + '" r="' + fmt2(circle.r) + '"' + fillAttr + "/>";
    const ellipse = fitEllipse(measured);
    if (ellipse !== null) return '<ellipse cx="' + fmt2(ellipse.cx) + '" cy="' + fmt2(ellipse.cy) + '" rx="' + fmt2(ellipse.rx) + '" ry="' + fmt2(ellipse.ry) + '"' + fillAttr + "/>";
    return null;
  }
  function fitRect(measured) {
    const width = measured.maxX - measured.minX;
    const height = measured.maxY - measured.minY;
    if (!(width >= 2) || !(height >= 2)) return null;
    const tolerance = Math.max(0.6, Math.min(width, height) * 0.02);
    let left = false;
    let right = false;
    let top = false;
    let bottom = false;
    for (const point2 of measured.samples) {
      const nearLeft = Math.abs(point2.x - measured.minX);
      const nearRight = Math.abs(point2.x - measured.maxX);
      const nearTop = Math.abs(point2.y - measured.minY);
      const nearBottom = Math.abs(point2.y - measured.maxY);
      if (Math.min(nearLeft, nearRight, nearTop, nearBottom) > tolerance) return null;
      if (nearLeft <= tolerance) left = true;
      if (nearRight <= tolerance) right = true;
      if (nearTop <= tolerance) top = true;
      if (nearBottom <= tolerance) bottom = true;
    }
    const boxArea = width * height;
    if (!left || !right || !top || !bottom || !(boxArea > 0) || measured.area / boxArea < 0.92) return null;
    return { x: measured.minX, y: measured.minY, width, height };
  }
  function fitRoundRect(measured) {
    const width = measured.maxX - measured.minX;
    const height = measured.maxY - measured.minY;
    const small = Math.min(width, height);
    if (!(width >= 6) || !(height >= 6)) return null;
    const maxRadius = small * 0.45;
    if (!(maxRadius >= 2)) return null;
    const limit = Math.max(0.9, small * 0.01);
    let best = null;
    for (let radius = 2; radius <= maxRadius + 1e-6; radius += 0.25) {
      const scored = roundRectError(measured, radius);
      if (scored === null) continue;
      if (best === null || scored < best.error) best = { r: radius, error: scored };
    }
    if (best === null || best.error > limit) return null;
    const expected = width * height - (4 - Math.PI) * best.r * best.r;
    if (!(expected > 0) || Math.abs(measured.area - expected) / expected > 0.08) return null;
    const flatShort = small - 2 * best.r;
    if (flatShort < Math.max(4, small * 0.12)) return null;
    const ratio = width / height;
    if (ratio > 0.92 && ratio < 1.08 && best.r > small * 0.3) return null;
    return { x: measured.minX, y: measured.minY, width, height, r: best.r };
  }
  function roundRectError(measured, radius) {
    const halfW = (measured.maxX - measured.minX) / 2;
    const halfH = (measured.maxY - measured.minY) / 2;
    const cx = (measured.minX + measured.maxX) / 2;
    const cy = (measured.minY + measured.maxY) / 2;
    let maxError = 0;
    let arc = false;
    let side = false;
    for (const point2 of measured.samples) {
      const qx = Math.abs(point2.x - cx) - (halfW - radius);
      const qy = Math.abs(point2.y - cy) - (halfH - radius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      maxError = Math.max(maxError, Math.abs(outside + inside - radius));
      if (qx > 0.4 && qy > 0.4) arc = true;
      if (qx <= 0.4 && qy > radius * 0.4 || qy <= 0.4 && qx > radius * 0.4) side = true;
    }
    return arc && side ? maxError : null;
  }
  function fitCircle(measured, canvas = null) {
    const points = measured.samples;
    if (points.length < 8) return null;
    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let sumY2 = 0;
    let sumXY = 0;
    let sumX3 = 0;
    let sumY3 = 0;
    let sumX2Y = 0;
    let sumXY2 = 0;
    for (const point2 of points) {
      const x = point2.x;
      const y = point2.y;
      const x2 = x * x;
      const y2 = y * y;
      sumX += x;
      sumY += y;
      sumX2 += x2;
      sumY2 += y2;
      sumXY += x * y;
      sumX3 += x2 * x;
      sumY3 += y2 * y;
      sumX2Y += x2 * y;
      sumXY2 += x * y2;
    }
    const count = points.length;
    const a = count * sumX2 - sumX * sumX;
    const b = count * sumXY - sumX * sumY;
    const c = count * sumY2 - sumY * sumY;
    const d = 0.5 * (count * sumX3 + count * sumXY2 - sumX * sumX2 - sumX * sumY2);
    const e = 0.5 * (count * sumX2Y + count * sumY3 - sumY * sumX2 - sumY * sumY2);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-6) return null;
    const cx = (d * c - b * e) / denom;
    const cy = (a * e - b * d) / denom;
    let radius = 0;
    for (const point2 of points) radius += Math.hypot(point2.x - cx, point2.y - cy);
    radius /= count;
    if (!(radius > 1.5)) return null;
    let maxError = 0;
    for (const point2 of points) maxError = Math.max(maxError, Math.abs(Math.hypot(point2.x - cx, point2.y - cy) - radius));
    if (maxError > Math.max(1.25, radius * 0.04)) return null;
    const expected = Math.PI * radius * radius;
    if (Math.abs(measured.area - expected) / expected > 0.12) return null;
    const areaRadius = Math.sqrt(measured.area / Math.PI);
    let chosen = Math.abs(areaRadius - radius) <= radius * 6e-3 ? areaRadius : radius;
    let centreX = cx, centreY = cy;
    if (canvas !== null) {
      const edge = 0.05;
      const left = measured.minX <= canvas.x + edge, right = measured.maxX >= canvas.x + canvas.width - edge;
      const top = measured.minY <= canvas.y + edge, bottom = measured.maxY >= canvas.y + canvas.height - edge;
      if (left && right) centreX = canvas.x + canvas.width / 2;
      if (top && bottom) centreY = canvas.y + canvas.height / 2;
      if (left) chosen = Math.max(chosen, centreX - canvas.x);
      if (top) chosen = Math.max(chosen, centreY - canvas.y);
      if (right) chosen = Math.max(chosen, canvas.x + canvas.width - centreX);
      if (bottom) chosen = Math.max(chosen, canvas.y + canvas.height - centreY);
    }
    return { cx: centreX, cy: centreY, r: chosen };
  }
  function fitEllipse(measured) {
    const rx = (measured.maxX - measured.minX) / 2;
    const ry = (measured.maxY - measured.minY) / 2;
    if (!(rx >= 2) || !(ry >= 2)) return null;
    const ratio = rx / ry;
    if (ratio > 0.92 && ratio < 1.08) return null;
    const cx = (measured.minX + measured.maxX) / 2;
    const cy = (measured.minY + measured.maxY) / 2;
    let maxError = 0;
    for (const point2 of measured.samples) {
      maxError = Math.max(maxError, Math.abs(Math.hypot((point2.x - cx) / rx, (point2.y - cy) / ry) - 1));
    }
    if (maxError > 0.04) return null;
    const expected = Math.PI * rx * ry;
    if (!(expected > 0) || Math.abs(measured.area - expected) / expected > 0.12) return null;
    return { cx, cy, rx, ry };
  }
  function fmt2(value) {
    return String(Math.round(value * 100) / 100);
  }
  function groupPathsByFill(svg) {
    const matches = pathTags(svg);
    if (matches.length < 2) return svg;
    const placed = [];
    for (const tag of matches) {
      const measured = measureTag(tag);
      const attrs = tagAttrs(tag.source);
      placed.push({
        tag,
        fill: normalizeFill(fillOf(attrs)) ?? "none",
        minX: measured?.minX ?? 0,
        minY: measured?.minY ?? 0,
        maxX: measured?.maxX ?? 0,
        maxY: measured?.maxY ?? 0
      });
    }
    for (let left = 0; left < placed.length; left += 1) {
      for (let right = left + 1; right < placed.length; right += 1) {
        const a = placed[left];
        const b = placed[right];
        if (a === void 0 || b === void 0 || a.fill === b.fill) continue;
        if (boxesOverlap(a, b)) return svg;
      }
    }
    const first = matches[0];
    const last = matches[matches.length - 1];
    if (first === void 0 || last === void 0) return svg;
    const buckets = /* @__PURE__ */ new Map();
    for (const item of placed) {
      const group = buckets.get(item.fill);
      if (group === void 0) buckets.set(item.fill, [item.tag.source]);
      else group.push(item.tag.source);
    }
    const grouped = Array.from(buckets, ([fill, tags]) => {
      const id = "color-" + fill.replace(/[^0-9a-z]+/gi, "");
      return '<g id="' + id + '">' + tags.join("") + "</g>";
    }).join("");
    return svg.slice(0, first.index) + grouped + svg.slice(last.index + last.length);
  }
  function pathTags(svg) {
    const found = [];
    const pattern = /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;
    let match = pattern.exec(svg);
    while (match !== null) {
      found.push({ index: match.index, length: match[0].length, source: match[0] });
      match = pattern.exec(svg);
    }
    return found;
  }
  function elementName(tag) {
    return (/^<([a-z]+)/i.exec(tag)?.[1] ?? "").toLowerCase();
  }
  function tagAttrs(tag) {
    const match = /^<(?:path|circle|ellipse|rect)\b([^>]*)>/i.exec(tag);
    return match?.[1] ?? "";
  }
  function canvasSize(svg) {
    const tag = /<svg\b([^>]*)>/i.exec(svg);
    if (tag === null) return null;
    const attrs = tag[1] ?? "";
    const width = lengthOf2(readAttr2(attrs, "width"));
    const height = lengthOf2(readAttr2(attrs, "height"));
    if (width !== null && height !== null) return { width, height };
    const viewBox = readAttr2(attrs, "viewBox");
    if (viewBox === null) return null;
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    const boxWidth = parts[2];
    const boxHeight = parts[3];
    if (boxWidth === void 0 || boxHeight === void 0 || !(boxWidth > 0) || !(boxHeight > 0)) return null;
    return { width: boxWidth, height: boxHeight };
  }
  function lengthOf2(value) {
    if (value === null) return null;
    const match = /^([0-9]*\.?[0-9]+)/.exec(value.trim());
    if (match === null) return null;
    const parsed = Number(match[1]);
    return parsed > 0 ? parsed : null;
  }
  function measureTag(tag) {
    const name = elementName(tag.source);
    const attrs = tagAttrs(tag.source);
    if (name !== "path") return measurePrimitive(name, attrs);
    const data = readAttr2(attrs, "d");
    if (data === null || data.trim() === "") return null;
    return measurePath(data);
  }
  function measurePrimitive(name, attrs) {
    const numberAttr = (key) => {
      const raw = readAttr2(attrs, key);
      if (raw === null) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    if (name === "circle") {
      const radius = numberAttr("r");
      if (radius === null || !(radius > 0)) return null;
      const cx = numberAttr("cx") ?? 0;
      const cy = numberAttr("cy") ?? 0;
      return bounds(cx - radius, cy - radius, cx + radius, cy + radius, Math.PI * radius * radius);
    }
    if (name === "ellipse") {
      const rx = numberAttr("rx");
      const ry = numberAttr("ry");
      if (rx === null || ry === null || !(rx > 0) || !(ry > 0)) return null;
      const cx = numberAttr("cx") ?? 0;
      const cy = numberAttr("cy") ?? 0;
      return bounds(cx - rx, cy - ry, cx + rx, cy + ry, Math.PI * rx * ry);
    }
    if (name === "rect") {
      const width = numberAttr("width");
      const height = numberAttr("height");
      if (width === null || height === null || !(width > 0) || !(height > 0)) return null;
      const x = numberAttr("x") ?? 0;
      const y = numberAttr("y") ?? 0;
      return bounds(x, y, x + width, y + height, width * height);
    }
    return null;
  }
  function bounds(minX, minY, maxX, maxY, area) {
    return {
      anchors: 4,
      holes: 0,
      area,
      minX,
      minY,
      maxX,
      maxY,
      loops: 1,
      samples: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY }
      ]
    };
  }
  function boxesOverlap(a, b) {
    const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const height = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
    if (width <= 0.5 || height <= 0.5) return false;
    const areaA = Math.max(0, a.maxX - a.minX) * Math.max(0, a.maxY - a.minY);
    const areaB = Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
    const smaller = Math.min(areaA, areaB);
    return smaller > 0 && width * height / smaller > 0.15;
  }
  function readAttr2(attrs, name) {
    const pattern = new RegExp("\\b" + name + `\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
    const match = pattern.exec(attrs);
    if (match === null) return null;
    return match[1] ?? match[2] ?? "";
  }
  function fillOf(attrs) {
    const direct = readAttr2(attrs, "fill");
    if (direct !== null) return direct;
    const style = readAttr2(attrs, "style");
    if (style === null) return null;
    const match = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(style);
    const paint = match?.[1];
    return paint === void 0 ? null : paint.trim();
  }
  function normalizeFill(fill) {
    if (fill === null) return "#000000";
    const value = fill.trim().toLowerCase();
    if (value === "" || value === "none") return null;
    const short = /^#([0-9a-f]{3})$/.exec(value);
    if (short !== null) {
      const hex3 = short[1] ?? "";
      return "#" + hex3[0] + hex3[0] + hex3[1] + hex3[1] + hex3[2] + hex3[2];
    }
    return value;
  }
  function measurePath(data) {
    const commands = tokenize2(data);
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let prevControl = null;
    let anchors = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let open = [];
    const subs = [];
    function track(point2) {
      if (point2.x < minX) minX = point2.x;
      if (point2.y < minY) minY = point2.y;
      if (point2.x > maxX) maxX = point2.x;
      if (point2.y > maxY) maxY = point2.y;
    }
    function finish() {
      if (open.length === 0) return;
      subs.push({ points: open, area: signedArea(open) });
      open = [];
    }
    function addAnchor(x, y, curve) {
      const closing = open.length > 0 && Math.hypot(x - sx, y - sy) < 0.05;
      if (!closing) anchors += 1;
      if (!curve && (!closing || open.length === 0)) {
        const point2 = { x, y };
        open.push(point2);
        track(point2);
      }
      cx = x;
      cy = y;
    }
    for (const command of commands) {
      const op = command.cmd.toLowerCase();
      const relative = command.cmd === op;
      const args = command.args;
      if (op !== "c" && op !== "s" && op !== "q" && op !== "t") prevControl = null;
      if (op === "m") {
        finish();
        const x = relative ? cx + (args[0] ?? 0) : args[0] ?? 0;
        const y = relative ? cy + (args[1] ?? 0) : args[1] ?? 0;
        sx = x;
        sy = y;
        addAnchor(x, y, false);
      } else if (op === "l") {
        addAnchor(relative ? cx + (args[0] ?? 0) : args[0] ?? 0, relative ? cy + (args[1] ?? 0) : args[1] ?? 0, false);
      } else if (op === "h") {
        addAnchor(relative ? cx + (args[0] ?? 0) : args[0] ?? 0, cy, false);
      } else if (op === "v") {
        addAnchor(cx, relative ? cy + (args[0] ?? 0) : args[0] ?? 0, false);
      } else if (op === "c" || op === "s" || op === "q" || op === "t") {
        const start2 = { x: cx, y: cy };
        const cubic = curveControls(op, relative, args, start2, prevControl);
        for (const t of [0.25, 0.5, 0.75, 1]) {
          const point2 = bezier2(start2, cubic.p1, cubic.p2, cubic.p3, t);
          open.push(point2);
          track(point2);
        }
        prevControl = cubic.control;
        addAnchor(cubic.p3.x, cubic.p3.y, true);
      } else if (op === "a") {
        const end = arcEnd(relative, args, cx, cy);
        addAnchor(end.x, end.y, false);
      } else if (op === "z") {
        if (Math.hypot(cx - sx, cy - sy) >= 0.05) {
          const point2 = { x: sx, y: sy };
          open.push(point2);
          track(point2);
        }
        cx = sx;
        cy = sy;
        finish();
      }
    }
    finish();
    const area = subs.reduce((sum, sub) => sum + Math.abs(sub.area), 0);
    return {
      anchors,
      holes: countHoles(subs),
      area,
      minX,
      minY,
      maxX,
      maxY,
      loops: subs.length,
      samples: subs.flatMap((sub) => sub.points)
    };
  }
  function curveControls(op, relative, args, start2, prevControl) {
    const abs = (index, axis) => {
      const value = args[index] ?? 0;
      return relative ? start2[axis] + value : value;
    };
    if (op === "c") {
      const p1 = { x: abs(0, "x"), y: abs(1, "y") };
      const p2 = { x: abs(2, "x"), y: abs(3, "y") };
      const p32 = { x: abs(4, "x"), y: abs(5, "y") };
      return { p1, p2, p3: p32, control: p2 };
    }
    if (op === "s") {
      const p1 = reflect(prevControl, start2);
      const p2 = { x: abs(0, "x"), y: abs(1, "y") };
      const p32 = { x: abs(2, "x"), y: abs(3, "y") };
      return { p1, p2, p3: p32, control: p2 };
    }
    if (op === "q") {
      const control2 = { x: abs(0, "x"), y: abs(1, "y") };
      const p32 = { x: abs(2, "x"), y: abs(3, "y") };
      return { p1: control2, p2: control2, p3: p32, control: control2 };
    }
    const control = reflect(prevControl, start2);
    const p3 = { x: abs(0, "x"), y: abs(1, "y") };
    return { p1: control, p2: control, p3, control };
  }
  function reflect(control, point2) {
    if (control === null) return point2;
    return { x: point2.x * 2 - control.x, y: point2.y * 2 - control.y };
  }
  function arcEnd(relative, args, cx, cy) {
    const x = args[5] ?? 0;
    const y = args[6] ?? 0;
    return { x: relative ? cx + x : x, y: relative ? cy + y : y };
  }
  function bezier2(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    };
  }
  function countHoles(subs) {
    let outer = null;
    for (const sub of subs) {
      if (outer === null || Math.abs(sub.area) > Math.abs(outer.area)) outer = sub;
    }
    if (outer === null || Math.abs(outer.area) < 0.5) return 0;
    const sign = Math.sign(outer.area);
    let holes = 0;
    for (const sub of subs) {
      if (sub === outer || Math.abs(sub.area) < 0.5 || Math.sign(sub.area) === sign) continue;
      const center = centroid(sub.points);
      if (pointInPoly(center, outer.points)) holes += 1;
    }
    return holes;
  }
  function signedArea(points) {
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      if (current === void 0 || next === void 0) continue;
      sum += current.x * next.y - next.x * current.y;
    }
    return sum / 2;
  }
  function centroid(points) {
    let x = 0;
    let y = 0;
    for (const point2 of points) {
      x += point2.x;
      y += point2.y;
    }
    const count = points.length || 1;
    return { x: x / count, y: y / count };
  }
  function pointInPoly(point2, poly) {
    let inside = false;
    for (let index = 0, previous = poly.length - 1; index < poly.length; previous = index, index += 1) {
      const current = poly[index];
      const prior = poly[previous];
      if (current === void 0 || prior === void 0) continue;
      const crosses = current.y > point2.y !== prior.y > point2.y;
      if (!crosses) continue;
      const x = (prior.x - current.x) * (point2.y - current.y) / (prior.y - current.y) + current.x;
      if (point2.x < x) inside = !inside;
    }
    return inside;
  }
  function tokenize2(data) {
    const commands = [];
    let index = 0;
    let cmd = "";
    while (index < data.length) {
      index = skipSeparators(data, index);
      if (index >= data.length) break;
      const char = data[index] ?? "";
      if (/[A-Za-z]/.test(char)) {
        cmd = char;
        index += 1;
        if (cmd === "z" || cmd === "Z") {
          commands.push({ cmd, args: [] });
          continue;
        }
      }
      if (cmd === "") break;
      const count = ARG_COUNT2[cmd.toLowerCase()] ?? 0;
      if (count === 0) break;
      const args = [];
      let cursor = index;
      for (let slot = 0; slot < count; slot += 1) {
        const number = readNumber2(data, cursor);
        if (number === null) break;
        args.push(number.value);
        cursor = number.index;
      }
      if (args.length < count) break;
      commands.push({ cmd, args });
      if (cmd === "M") cmd = "L";
      else if (cmd === "m") cmd = "l";
      index = cursor;
    }
    return commands;
  }
  function skipSeparators(data, index) {
    let cursor = index;
    while (cursor < data.length) {
      const char = data[cursor] ?? "";
      if (char !== "," && char !== " " && char !== "\n" && char !== "	" && char !== "\r") break;
      cursor += 1;
    }
    return cursor;
  }
  function readNumber2(data, index) {
    let cursor = index;
    while (cursor < data.length) {
      const char = data[cursor] ?? "";
      if (char !== "," && char !== " " && char !== "\n" && char !== "	" && char !== "\r") break;
      cursor += 1;
    }
    const match = /^[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/.exec(data.slice(cursor));
    if (match === null) return null;
    const raw = match[0] ?? "";
    return { value: Number(raw), index: cursor + raw.length };
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
  function resolveVtracer(fallback) {
    const override = process.env.VTRACER_BIN?.trim();
    return override ? override : fallback;
  }
  function clampInt(value, min, max) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }
  function vtracerArguments(input, output, request) {
    const simplify = request.simplify ?? simplifyTolerance(request.smoothness);
    const args = [
      input,
      output,
      "--mode",
      "spline",
      "--optimize",
      "1",
      "--hierarchical",
      request.stacking,
      "--simplify",
      Math.min(2.5, Math.max(0.15, simplify)).toFixed(2)
    ];
    if (request.maxColors > 0) args.push("--max-colors", String(Math.round(request.maxColors)));
    if (request.palette !== void 0 && request.palette.length > 0 && request.palette.length <= 32) {
      args.push("--palette", request.palette.join(","));
    }
    const precision = request.colorPrecision ?? (request.preset === "photo" ? 8 : request.preset === "poster" ? 4 : request.preset === "icon" ? 5 : 6);
    const speckle = request.filterSpeckle ?? (request.preset === "photo" ? 1 : 0);
    args.push("--preset", request.preset === "photo" ? "photo" : "poster", "--color-precision", String(clampInt(precision, 1, 8)), "--filter-speckle", String(clampInt(speckle, 0, 128)));
    const watershed = request.clustering === "watershed" || request.clustering === void 0 && request.preset === "photo";
    if (watershed) args.push("--clustering", "watershed", "--watershed-detail", String(clampInt(request.watershedDetail ?? 128, 1, 512)));
    return args;
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
  function paletteFromRaster2(rgba, _ignore) {
    const seen = /* @__PURE__ */ new Set();
    for (let index = 0; index < rgba.length; index += 4) {
      if ((rgba[index + 3] ?? 0) < 250) continue;
      const color = "#" + byte2(rgba[index] ?? 0) + byte2(rgba[index + 1] ?? 0) + byte2(rgba[index + 2] ?? 0);
      seen.add(color);
    }
    return [...seen].sort();
  }
  function byte2(value) {
    return value.toString(16).padStart(2, "0");
  }

  // src/preset-state.ts
  var PRESET_CONTROL_FIELDS = [
    "maxColors",
    "snapBlends",
    "speckArea",
    "removeBackground",
    "backdropSpread",
    "opaqueAt",
    "traceColors",
    "lockPalette",
    "colorPrecision",
    "filterSpeckle",
    "clustering",
    "watershedDetail",
    "simplify",
    "stacking",
    "dropPlate",
    "fitGeometry",
    "smoothness",
    "corner",
    "seal",
    "sealWidth"
  ];
  var PRESET_PRESENTATION = [
    { preset: "logo", label: "\u0E42\u0E25\u0E42\u0E01\u0E49", detail: "\u0E2A\u0E35\u0E41\u0E1A\u0E19 \xB7 \u0E15\u0E31\u0E14\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07", thumbnail: "img/presets/logo.svg" },
    { preset: "icon", label: "\u0E44\u0E2D\u0E04\u0E2D\u0E19", detail: "\u0E02\u0E2D\u0E1A\u0E04\u0E21 \xB7 \u0E23\u0E39\u0E1B\u0E17\u0E23\u0E07\u0E0A\u0E31\u0E14", thumbnail: "img/presets/icon.svg" },
    { preset: "photo", label: "\u0E20\u0E32\u0E1E\u0E16\u0E48\u0E32\u0E22", detail: "\u0E2B\u0E25\u0E32\u0E22\u0E2A\u0E35 \xB7 \u0E40\u0E01\u0E47\u0E1A\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14", thumbnail: "img/presets/photo.svg" },
    { preset: "poster", label: "\u0E42\u0E1B\u0E2A\u0E40\u0E15\u0E2D\u0E23\u0E4C", detail: "\u0E2A\u0E35\u0E08\u0E33\u0E01\u0E31\u0E14 \xB7 \u0E40\u0E2A\u0E49\u0E19\u0E40\u0E14\u0E48\u0E19", thumbnail: "img/presets/poster.svg" }
  ];
  function emptyPresetState() {
    return { kind: "unselected" };
  }
  function selectPreset(preset) {
    const controls = controlsFor(preset);
    return { kind: "selected", preset, defaults: controls, controls };
  }
  function updatePresetControls(state, controls) {
    if (state.kind === "unselected") return state;
    return { ...state, controls: { ...controls, mode: state.preset } };
  }
  function modifiedPresetControls(state) {
    if (state.kind === "unselected") return [];
    return PRESET_CONTROL_FIELDS.filter((field) => state.controls[field] !== state.defaults[field]);
  }
  function modifiedPresetControlCount(state) {
    return modifiedPresetControls(state).length;
  }
  function resetPresetControl(state, field) {
    if (state.kind === "unselected") return state;
    return { ...state, controls: { ...state.controls, [field]: state.defaults[field] } };
  }
  function resetPresetControls(state) {
    if (state.kind === "unselected") return state;
    return { ...state, controls: state.defaults };
  }
  function hasPresetEdits(state) {
    return modifiedPresetControlCount(state) > 0;
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
    const colors = paintLabels(labels, palette, opaque, (fraction) => report(0.96 + fraction * 0.04));
    report(1);
    return { colors, labels, punchLabels, palette, opaque, spread: borderMeasure(source, width, height)?.spread ?? 0 };
  }
  async function segmentColorStageAsync(rgba, width, height, options, onProgress, shouldCancel) {
    if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    const work = { lastYield: Date.now() };
    const cooperate2 = async () => {
      if (Date.now() - work.lastYield < 20) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
      work.lastYield = Date.now();
      if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    };
    let last = 0;
    const report = (fraction) => {
      last = Math.max(last, Math.min(1, fraction));
      onProgress?.(last);
    };
    const count = width * height;
    if (width < 2 || height < 2 || rgba.length < count * 4) {
      const labels2 = new Int16Array(count);
      labels2.fill(-1);
      report(1);
      return { colors: rgba.slice(), labels: labels2, punchLabels: labels2, palette: [], opaque: new Uint8Array(count), spread: 0 };
    }
    const cutoff = Math.min(255, Math.max(0, Math.round(options.opaqueAt ?? 128)));
    const samples = collectSamples(rgba, width, height, cutoff);
    const centroids = await clusterAsync(samples, colorCap(options), cooperate2, (fraction) => report(fraction * 0.15));
    const snapBlends = options.snapBlends ?? (options.mode === "logo" || options.mode === "icon");
    const areas = new Uint32Array(centroids.length);
    for (let index = 0; index < count; index += 1) {
      if ((rgba[index * 4 + 3] ?? 0) >= cutoff) {
        const label = nearest(pixelAt(rgba, index), centroids);
        areas[label] = (areas[label] ?? 0) + 1;
      }
      if (index % Math.max(1, width * 4) === 0) {
        report(0.15 + index / count * 0.13);
        await cooperate2();
      }
    }
    const palette = snapBlends ? foldBlends(centroids, areas) : centroids;
    const labels = new Int16Array(count);
    labels.fill(-1);
    for (let index = 0; index < count; index += 1) {
      if ((rgba[index * 4 + 3] ?? 0) >= cutoff) labels[index] = nearest(pixelAt(rgba, index), palette);
      if (index % Math.max(1, width * 4) === 0) {
        report(0.28 + index / count * 0.18);
        await cooperate2();
      }
    }
    await cleanupEdgesAsync(labels, width, height, cooperate2, (fraction) => report(0.46 + fraction * 0.12));
    await mergeSpecksAsync(labels, width, height, Math.max(0, Math.round(options.speckArea ?? SPECK_AREA[options.mode])), cooperate2, (fraction) => report(0.58 + fraction * 0.18));
    const punchLabels = new Int16Array(labels);
    for (let index = 0; index < count; index += 1) {
      if ((rgba[index * 4 + 3] ?? 0) > 0 && (punchLabels[index] ?? -1) < 0) punchLabels[index] = nearest(pixelAt(rgba, index), palette);
      if (index % Math.max(1, width * 4) === 0) {
        report(0.76 + index / count * 0.1);
        await cooperate2();
      }
    }
    const opaque = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      opaque[index] = (rgba[index * 4 + 3] ?? 0) >= cutoff ? 255 : 0;
      if (index % Math.max(1, width * 4) === 0) {
        report(0.86 + index / count * 0.08);
        await cooperate2();
      }
    }
    const colors = await paintLabelsAsync(labels, palette, opaque, cooperate2, (fraction) => report(0.94 + fraction * 0.06));
    report(1);
    return { colors, labels, punchLabels, palette, opaque, spread: borderMeasure(rgba, width, height)?.spread ?? 0 };
  }
  async function clusterAsync(samples, cap, cooperate2, onProgress) {
    const centroids = seedCentroids(samples, cap);
    for (let round = 0; round < 8; round += 1) {
      const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        if (sample === void 0) continue;
        const slot = nearest(sample, centroids);
        const bin = sums[slot];
        if (bin !== void 0) {
          bin.r += sample.r;
          bin.g += sample.g;
          bin.b += sample.b;
          bin.n += 1;
        }
        if (index % 1024 === 0) await cooperate2();
      }
      for (let index = 0; index < centroids.length; index += 1) {
        const bin = sums[index];
        if (bin === void 0 || bin.n === 0) continue;
        centroids[index] = { r: Math.round(bin.r / bin.n), g: Math.round(bin.g / bin.n), b: Math.round(bin.b / bin.n) };
      }
      onProgress((round + 1) / 8);
    }
    return centroids;
  }
  async function cleanupEdgesAsync(labels, width, height, cooperate2, onProgress) {
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
              if (label >= 0) counts.set(label, (counts.get(label) ?? 0) + 1);
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
        if (y % 4 === 0) await cooperate2();
        onProgress((pass + y / height) / 2);
      }
      original.set(labels);
    }
  }
  async function mergeSpecksAsync(labels, width, height, minArea, cooperate2, onProgress) {
    const count = width * height;
    const seen = new Uint8Array(count);
    const queue = new Int32Array(count);
    for (let start2 = 0; start2 < count; start2 += 1) {
      if (seen[start2] === 1) continue;
      const label = labels[start2] ?? -1;
      if (label < 0) {
        seen[start2] = 1;
        continue;
      }
      let head = 0;
      let tail = 0;
      queue[tail] = start2;
      tail += 1;
      seen[start2] = 1;
      let minX = start2 % width;
      let maxX = minX;
      let minY = Math.floor(start2 / width);
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
          if (Math.abs(nx - x) > 1 || (labels[next] ?? -1) !== label) continue;
          seen[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
        if (head % 4096 === 0) await cooperate2();
      }
      const area = tail;
      const spanX = maxX - minX + 1;
      const spanY = maxY - minY + 1;
      const thin = Math.max(spanX, spanY) >= 8 && Math.min(spanX, spanY) <= 2 && area >= 6;
      if (area < minArea && !thin) {
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
            if (other >= 0 && other !== label) around.set(other, (around.get(other) ?? 0) + 1);
          }
          if (cursor % 4096 === 0) await cooperate2();
        }
        let replacement = label;
        let votes = 0;
        for (const [other, vote] of around) {
          if (vote > votes) {
            votes = vote;
            replacement = other;
          }
        }
        if (replacement !== label) {
          for (let cursor = 0; cursor < tail; cursor += 1) {
            labels[queue[cursor] ?? 0] = replacement;
            if (cursor % 4096 === 0) await cooperate2();
          }
        }
      }
      if (start2 % 4096 === 0) {
        onProgress(start2 / count);
        await cooperate2();
      }
    }
    onProgress(1);
  }
  async function paintLabelsAsync(labels, palette, alpha, cooperate2, onProgress) {
    const next = new Uint8Array(alpha.length * 4);
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4;
      if ((alpha[index] ?? 0) !== 0) {
        const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
        next[offset] = color.r;
        next[offset + 1] = color.g;
        next[offset + 2] = color.b;
        next[offset + 3] = 255;
      }
      if (index % 16384 === 0) {
        onProgress(index / alpha.length);
        await cooperate2();
      }
    }
    onProgress(1);
    return next;
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
      backdrop: paintLabels(colors.labels, colors.palette, alpha, (fraction) => onProgress?.(0.6 + fraction * 0.2)),
      punchInput: paintLabelsWithAlpha(colors.punchLabels, colors.palette, punchAlpha, (fraction) => onProgress?.(0.8 + fraction * 0.2))
    };
  }
  async function segmentBackdropStageAsync(rgba, width, height, colors, removeBackground, spreadLimit, onProgress, shouldCancel) {
    if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    let lastYield = Date.now();
    const cooperate2 = async () => {
      if (Date.now() - lastYield < 20) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = Date.now();
      if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    };
    onProgress?.(0);
    if (colors.palette.length === 0) {
      onProgress?.(1);
      return { backdrop: colors.colors.slice(), punchInput: rgba.slice() };
    }
    const alpha = colors.opaque.slice();
    const punchAlpha = new Uint8Array(width * height);
    for (let index = 0; index < punchAlpha.length; index += 1) {
      if ((colors.punchLabels[index] ?? -1) >= 0) punchAlpha[index] = rgba[index * 4 + 3] ?? 0;
      if (index % 8192 === 0) {
        onProgress?.(0.2 * index / punchAlpha.length);
        await cooperate2();
      }
    }
    const cleared = removeBackground ? await flatBackdropMaskAsync(rgba, colors.labels, width, height, colors.palette, spreadLimit, cooperate2) : null;
    if (cleared !== null) {
      for (let index = 0; index < cleared.length; index += 1) {
        if (cleared[index] !== 0) {
          alpha[index] = 0;
          punchAlpha[index] = 0;
        }
        if (index % 8192 === 0) {
          onProgress?.(0.2 + 0.3 * index / cleared.length);
          await cooperate2();
        }
      }
    }
    const backdrop = await paintLabelsAsync(colors.labels, colors.palette, alpha, cooperate2, (fraction) => onProgress?.(0.5 + fraction * 0.25));
    const punchInput = await paintLabelsWithAlphaAsync(colors.punchLabels, colors.palette, punchAlpha, cooperate2, (fraction) => onProgress?.(0.75 + fraction * 0.25));
    onProgress?.(1);
    return { backdrop, punchInput };
  }
  async function flatBackdropMaskAsync(rgba, labels, width, height, palette, spreadLimit, cooperate2) {
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
      if (head % 4096 === 0) await cooperate2();
    }
    const fraction = tail / count;
    if (fraction < 0.08 || fraction > 0.92) return null;
    const cleared = new Uint8Array(count);
    for (let index = 0; index < tail; index += 1) {
      cleared[queue[index] ?? 0] = 1;
      if (index % 8192 === 0) await cooperate2();
    }
    return cleared;
  }
  async function paintLabelsWithAlphaAsync(labels, palette, alpha, cooperate2, onProgress) {
    const next = new Uint8Array(alpha.length * 4);
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4;
      const opacity = alpha[index] ?? 0;
      if (opacity !== 0) {
        const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
        next[offset] = color.r;
        next[offset + 1] = color.g;
        next[offset + 2] = color.b;
        next[offset + 3] = opacity;
      }
      if (index % 8192 === 0) {
        onProgress(index / alpha.length);
        await cooperate2();
      }
    }
    onProgress(1);
    return next;
  }
  function paintLabels(labels, palette, alpha, onProgress) {
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
    for (let start2 = 0; start2 < count; start2 += 1) {
      if (start2 % Math.max(1, width * 8) === 0) onProgress?.(start2 / count);
      if (seen[start2] === 1) continue;
      const label = labels[start2] ?? -1;
      if (label < 0) {
        seen[start2] = 1;
        continue;
      }
      let head = 0;
      let tail = 0;
      queue[tail] = start2;
      tail += 1;
      seen[start2] = 1;
      let minX = start2 % width;
      let maxX = minX;
      let minY = Math.floor(start2 / width);
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
      if (start2 % 4096 === 0) onProgress?.(start2 / count);
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

  // src/svg-scale.ts
  var COMMAND = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  var NUMBER = /[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
  function translateSvg(svg, dx, dy) {
    if (dx === 0 && dy === 0) return svg;
    return svg.replace(/\bd="([^"]*)"/g, (_full, data) => 'd="' + translatePath(data, dx, dy) + '"');
  }
  function translatePath(data, dx, dy) {
    return data.replace(COMMAND, (_full, command, rest) => {
      const numbers = rest.match(NUMBER);
      if (numbers === null || command === command.toLowerCase()) return command + rest;
      const kind = command.toLowerCase();
      if (kind === "z") return command;
      if (kind === "h") return command + numbers.map((value) => format(Number(value) + dx)).join(" ");
      if (kind === "v") return command + numbers.map((value) => format(Number(value) + dy)).join(" ");
      if (kind === "a") {
        const moved2 = [];
        for (let index = 0; index + 6 < numbers.length; index += 7) {
          moved2.push(
            numbers[index] ?? "0",
            numbers[index + 1] ?? "0",
            numbers[index + 2] ?? "0",
            numbers[index + 3] ?? "0",
            numbers[index + 4] ?? "0",
            format(Number(numbers[index + 5]) + dx),
            format(Number(numbers[index + 6]) + dy)
          );
        }
        return command + moved2.join(" ");
      }
      const moved = [];
      for (let index = 0; index < numbers.length; index += 2) {
        moved.push(format(Number(numbers[index]) + dx), format(Number(numbers[index + 1]) + dy));
      }
      return command + moved.join(" ");
    });
  }
  function scaleSvg(svg, factor) {
    if (factor === 1) return svg;
    const sized = svg.replace(/\b(width|height)="([0-9.]+)"/g, (_full, name, value) => name + '="' + format(Number(value) * factor) + '"').replace(/viewBox="([^"]+)"/g, (_full, value) => 'viewBox="' + value.trim().split(/[\s,]+/).map((part) => format(Number(part) * factor)).join(" ") + '"');
    return sized.replace(/\bd="([^"]*)"/g, (_full, data) => 'd="' + scalePath(data, factor) + '"');
  }
  function scalePath(data, factor) {
    return data.replace(COMMAND, (_full, command, rest) => {
      const numbers = rest.match(NUMBER);
      if (numbers === null) return command;
      const kind = command.toLowerCase();
      if (kind === "z") return command;
      if (kind === "a") {
        const scaled = [];
        for (let index = 0; index + 6 < numbers.length; index += 7) {
          scaled.push(
            format(Number(numbers[index]) * factor),
            format(Number(numbers[index + 1]) * factor),
            numbers[index + 2] ?? "0",
            numbers[index + 3] ?? "0",
            numbers[index + 4] ?? "0",
            format(Number(numbers[index + 5]) * factor),
            format(Number(numbers[index + 6]) * factor)
          );
        }
        return command + scaled.join(" ");
      }
      return command + numbers.map((value) => format(Number(value) * factor)).join(" ");
    });
  }
  function format(value) {
    if (!Number.isFinite(value)) return "0";
    const rounded = Math.round(value * 1e3) / 1e3;
    return String(rounded);
  }

  // src/trace-finish.ts
  var SHAPE = /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;
  function mergePlates(svgs, plates, width, height, droppedColor, removeBackground, fitGeometry = true) {
    const drawings = [];
    for (let index = 0; index < svgs.length; index += 1) {
      const plate = plates[index];
      const svg = svgs[index];
      if (plate === void 0 || svg === void 0) continue;
      let next = scaleSvg(svg, 1 / plate.scale);
      if (droppedColor !== null) next = dropFill(next, droppedColor);
      if (removeBackground) next = dropCanvasBackground(next, plate.borderColor);
      next = translateSvg(next, plate.originX, plate.originY);
      drawings.push((next.match(SHAPE) ?? []).join(""));
    }
    const merged = '<svg xmlns="http://www.w3.org/2000/svg" width="' + String(width) + '" height="' + String(height) + '" viewBox="0 0 ' + String(width) + " " + String(height) + '">' + drawings.join("") + "</svg>";
    const size = Math.max(width, height);
    const fillet = Math.min(2, Math.max(1.25, size / 128));
    const curl = size >= 128 ? Math.min(2, size / 128) : 0;
    if (!fitGeometry) return merged;
    const cutOut = plates.length > 0 && plates.every((plate) => plate.cutOut === true);
    const fitted = fitShapes(cutOut ? unifyNearFills(merged) : merged);
    if (cutOut) return sharpenCorners(fitted, fillet, 35, curl);
    const check = size >= MIN_CHECKED_SIDE ? sourceCheck(plates) : null;
    if (check === null) return fitted;
    const sharpened = sharpenConfirmed(fitted, fillet, 35, curl, sourceCheck(plates, true) ?? check);
    const colour = sourceColour(plates);
    return colour === null ? sharpened : fitRasterCorners(sharpened, colour, check);
  }
  function sourceColour(plates) {
    const source = plates.find((plate) => plate.source !== void 0)?.source;
    if (source === void 0) return null;
    const { rgba, width, height } = source;
    return (x, y) => {
      const fx = x - 0.5;
      const fy = y - 0.5;
      if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) return null;
      const x0 = Math.min(width - 2, Math.floor(fx));
      const y0 = Math.min(height - 2, Math.floor(fy));
      const ax = fx - x0;
      const ay = fy - y0;
      const out = [0, 0, 0];
      for (let channel = 0; channel < 3; channel += 1) {
        const at = (yy, xx) => rgba[(yy * width + xx) * 4 + channel] ?? 0;
        out[channel] = (at(y0, x0) * (1 - ax) + at(y0, x0 + 1) * ax) * (1 - ay) + (at(y0 + 1, x0) * (1 - ax) + at(y0 + 1, x0 + 1) * ax) * ay;
      }
      return out;
    };
  }
  function sourceCheck(plates, ownInk = false) {
    const source = plates.find((plate) => plate.source !== void 0)?.source;
    if (source === void 0) return null;
    const { rgba, width, height } = source;
    return (fill, cap, inside) => {
      const ink = parseFill(fill);
      if (ink === null || cap.length < 3) return false;
      const xs = cap.map((point2) => point2.x);
      const ys = cap.map((point2) => point2.y);
      const left = Math.max(0, Math.floor(Math.min(...xs)) - REACH);
      const right = Math.min(width - 1, Math.floor(Math.max(...xs)) + REACH);
      const top = Math.max(0, Math.floor(Math.min(...ys)) - REACH);
      const bottom = Math.min(height - 1, Math.floor(Math.max(...ys)) + REACH);
      const pixels = [];
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          let round = 0;
          let sharp = 0;
          for (let sy = 0; sy < SAMPLES; sy += 1) {
            for (let sx = 0; sx < SAMPLES; sx += 1) {
              const px = x + (sx + 0.5) / SAMPLES;
              const py = y + (sy + 0.5) / SAMPLES;
              const covered = inside(px, py);
              if (covered) round += 1;
              if (covered !== insidePolygon(cap, px, py)) sharp += 1;
            }
          }
          pixels.push({ at: (y * width + x) * 4, round: round / SAMPLES ** 2, sharp: sharp / SAMPLES ** 2 });
        }
      }
      const outside = [0, 0, 0];
      let outsideCount = 0;
      for (const pixel of pixels) {
        if (pixel.round > 0 || pixel.sharp > 0) continue;
        for (let channel = 0; channel < 3; channel += 1) outside[channel] += rgba[pixel.at + channel] ?? 0;
        outsideCount += 1;
      }
      if (outsideCount === 0) return false;
      const away = outside.map((sum) => sum / outsideCount);
      if (ownInk) {
        const within = [0, 0, 0];
        let withinCount = 0;
        for (const pixel of pixels) {
          if (pixel.round < 1 || pixel.sharp < 1) continue;
          for (let channel = 0; channel < 3; channel += 1) within[channel] += rgba[pixel.at + channel] ?? 0;
          withinCount += 1;
        }
        if (withinCount > 0) {
          const mean = within.map((sum) => sum / withinCount);
          const toInk = Math.hypot(...mean.map((value, channel) => value - ink[channel]));
          if (toInk > OWN_INK * Math.hypot(...ink.map((value, channel) => value - away[channel]))) return false;
        }
      }
      const span = ink.map((value, channel) => value - away[channel]);
      const spanSquared = span.reduce((sum, value) => sum + value * value, 0);
      if (spanSquared < MIN_CONTRAST ** 2) return false;
      let roundError = 0;
      let sharpError = 0;
      for (const pixel of pixels) {
        if (pixel.round === pixel.sharp) continue;
        let dot = 0;
        for (let channel = 0; channel < 3; channel += 1) dot += ((rgba[pixel.at + channel] ?? 0) - away[channel]) * span[channel];
        const coverage = Math.max(0, Math.min(1, dot / spanSquared));
        roundError += (coverage - pixel.round) ** 2;
        sharpError += (coverage - pixel.sharp) ** 2;
      }
      return sharpError < SHARP_MARGIN * roundError;
    };
  }
  var MIN_CHECKED_SIDE = 96;
  var REACH = 2;
  var SAMPLES = 8;
  var SHARP_MARGIN = 0.75;
  var MIN_CONTRAST = 48;
  var OWN_INK = 0.5;
  function parseFill(fill) {
    const match = /^#([0-9a-f]{6})$/i.exec(fill);
    if (match?.[1] === void 0) return null;
    const value = Number.parseInt(match[1], 16);
    return [value >> 16 & 255, value >> 8 & 255, value & 255];
  }
  function insidePolygon(points, x, y) {
    let inside = false;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const a = points[index];
      const b = points[previous];
      if (a === void 0 || b === void 0) continue;
      if (a.y > y !== b.y > y && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  // src/lab-pipeline.ts
  var LAB_STEPS = ["capture", "colors", "backdrop", "punch", "trace", "fit", "fair", "seal"];
  var CONTROL_STEPS = [
    { field: "mode", step: "colors" },
    { field: "maxColors", step: "colors" },
    { field: "snapBlends", step: "colors" },
    { field: "speckArea", step: "colors" },
    { field: "removeBackground", step: "backdrop" },
    { field: "backdropSpread", step: "backdrop" },
    { field: "opaqueAt", step: "punch" },
    { field: "traceColors", step: "trace" },
    { field: "lockPalette", step: "trace" },
    { field: "colorPrecision", step: "trace" },
    { field: "filterSpeckle", step: "trace" },
    { field: "clustering", step: "trace" },
    { field: "watershedDetail", step: "trace" },
    { field: "simplify", step: "trace" },
    { field: "stacking", step: "trace" },
    { field: "dropPlate", step: "fit" },
    { field: "fitGeometry", step: "fit" },
    { field: "smoothness", step: "fair" },
    { field: "corner", step: "fair" },
    { field: "seal", step: "seal" },
    { field: "sealWidth", step: "seal" }
  ];
  function earliestChangedStep(previous, next) {
    let earliest = LAB_STEPS.length - 1;
    for (const control of CONTROL_STEPS) {
      if (previous[control.field] !== next[control.field]) {
        const stepIndex = LAB_STEPS.indexOf(control.step);
        earliest = Math.min(earliest, stepIndex);
      }
    }
    return LAB_STEPS[earliest] ?? "seal";
  }
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
  async function buildLabRasterStagesAsync(source, width, height, controls, previous = null, from = "colors", onProgress, shouldCancel) {
    if (controls.mode === "logo" || controls.mode === "icon") {
      if (previous?.mode === controls.mode && LAB_STEPS.indexOf(from) > LAB_STEPS.indexOf("colors")) return previous;
      const colors2 = source;
      return { mode: controls.mode, colors: colors2, backdrop: colors2, punchInput: source, punch: colors2, traceInput: source, droppedColor: null, spread: 0, paletteSize: 0, segmentation: null };
    }
    const fromIndex = LAB_STEPS.indexOf(from);
    const sameMode = previous?.mode === controls.mode;
    const canReuseColors = sameMode && previous?.segmentation !== null && previous?.segmentation !== void 0 && fromIndex > LAB_STEPS.indexOf("colors");
    if (!canReuseColors) onProgress?.("colors", 0);
    const segmentation = canReuseColors && previous !== null ? previous.segmentation : await segmentColorStageAsync(source, width, height, {
      mode: controls.mode,
      maxColors: controls.maxColors,
      snapBlends: controls.snapBlends,
      speckArea: controls.speckArea,
      removeBackground: false,
      opaqueAt: controlsFor(controls.mode).opaqueAt
    }, (fraction) => onProgress?.("colors", fraction), shouldCancel);
    const colors = segmentation.colors;
    const canReuseBackdrop = sameMode && previous !== null && fromIndex > LAB_STEPS.indexOf("backdrop");
    if (!canReuseBackdrop) onProgress?.("backdrop", 0);
    const backdropStage = canReuseBackdrop ? { backdrop: previous.backdrop, punchInput: previous.punchInput } : await segmentBackdropStageAsync(source, width, height, segmentation, controls.removeBackground, controls.backdropSpread, (fraction) => onProgress?.("backdrop", fraction), shouldCancel);
    const backdrop = backdropStage.backdrop;
    const punchInput = backdropStage.punchInput;
    if (!canReuseBackdrop) onProgress?.("backdrop", 1);
    const spread = segmentation.spread;
    const paletteSize = segmentation.palette.length;
    const canReusePunch = sameMode && previous !== null && fromIndex > LAB_STEPS.indexOf("punch");
    if (canReusePunch && previous !== null) return previous;
    onProgress?.("punch", 0);
    const punched = await punchRgbaAsync(punchInput, width, height, controls.opaqueAt, (fraction) => onProgress?.("punch", fraction), shouldCancel);
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
  function fitLabVector(svg, controls, droppedColor, borderColor) {
    let fitted = svg;
    if (droppedColor !== null) fitted = dropFill(fitted, droppedColor);
    if (controls.dropPlate) fitted = dropCanvasBackground(fitted, borderColor);
    if (controls.fitGeometry) fitted = fitShapes(fitted);
    return fitted;
  }
  function fairLabVector(fitted, controls) {
    const defaults = controlsFor(controls.mode);
    if ((controls.mode === "logo" || controls.mode === "icon") && controls.smoothness === defaults.smoothness && controls.corner === defaults.corner) {
      return relaxPaths(fitted, 0.15);
    }
    return fairPaths(fitted, { smoothness: controls.smoothness, cornerDegrees: controls.corner });
  }
  function sealLabVector(faired, controls) {
    const sealed = controls.seal ? sealGaps(faired, controls.sealWidth) : faired;
    return groupPathsByFill(sealed);
  }
  function styleLabVectors(svg, controls, droppedColor, borderColor = null) {
    const fitted = fitLabVector(svg, controls, droppedColor, borderColor);
    if (controls.mode === "logo" || controls.mode === "icon") {
      return { fitted, faired: fitted, sealed: groupPathsByFill(fitted) };
    }
    const faired = fairLabVector(fitted, controls);
    const sealed = sealLabVector(faired, controls);
    return { fitted, faired, sealed };
  }
  function vectorStagesFromPlan(svgs, plates, width, height, droppedColor, controls, onProgress) {
    onProgress?.("fit", 0);
    const trace = mergePlates(svgs, plates, width, height, null, false, false);
    const fitted = mergePlates(svgs, plates, width, height, droppedColor, controls.dropPlate, controls.fitGeometry);
    onProgress?.("fit", 1);
    onProgress?.("fair", 0);
    const faired = fairLabVector(fitted, controls);
    onProgress?.("fair", 1);
    onProgress?.("seal", 0);
    const sealed = sealLabVector(faired, controls);
    onProgress?.("seal", 1);
    return { trace, fitted, faired, sealed };
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
    const start2 = LAB_STEPS.indexOf(from);
    const activeSteps = LAB_STEPS.slice(start2);
    const totalWeight = activeSteps.reduce((sum, step) => sum + LAB_STEP_WEIGHTS[step], 0);
    let completedWeight = 0;
    let lastPercent = 0;
    let finished = false;
    const firstStep = activeSteps[0] ?? from;
    onProgress({ step: firstStep, fraction: 0, percent: 0 });
    const report = (step, fraction) => {
      if (finished) return;
      const index = LAB_STEPS.indexOf(step);
      if (index < start2) return;
      const safeFraction = Math.min(1, Math.max(0, fraction));
      let weightBefore = 0;
      for (let cursor = start2; cursor < index; cursor += 1) {
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

  // src/color.ts
  var D65 = { x: 0.95047, y: 1, z: 1.08883 };
  function srgbChannelToLinear(channel) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  function linearChannelToSrgb(channel) {
    const value = Math.min(1, Math.max(0, channel));
    const encoded = value <= 31308e-7 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  }
  function rgbToLab(color) {
    const red = srgbChannelToLinear(color.r);
    const green = srgbChannelToLinear(color.g);
    const blue = srgbChannelToLinear(color.b);
    const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / D65.x;
    const y = (0.2126729 * red + 0.7151522 * green + 0.072175 * blue) / D65.y;
    const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / D65.z;
    const fy = labPivot(y);
    return { L: 116 * fy - 16, a: 500 * (labPivot(x) - fy), b: 200 * (fy - labPivot(z)) };
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
  function deltaE2000(left, right) {
    const c1 = Math.hypot(left.a, left.b);
    const c2 = Math.hypot(right.a, right.b);
    const cBar = (c1 + c2) / 2;
    const cBar7 = cBar ** 7;
    const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
    const a1 = (1 + g) * left.a;
    const a2 = (1 + g) * right.a;
    const c1p = Math.hypot(a1, left.b);
    const c2p = Math.hypot(a2, right.b);
    const h1 = hueDegrees(left.b, a1);
    const h2 = hueDegrees(right.b, a2);
    const dl = right.L - left.L;
    const dc = c2p - c1p;
    let dh = 0;
    if (c1p * c2p !== 0) {
      dh = h2 - h1;
      if (dh > 180) dh -= 360;
      else if (dh < -180) dh += 360;
    }
    const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(dh * Math.PI / 360);
    const lBar = (left.L + right.L) / 2;
    const cBarP = (c1p + c2p) / 2;
    let hBar = h1 + h2;
    if (c1p * c2p !== 0) {
      if (Math.abs(h1 - h2) <= 180) hBar = (h1 + h2) / 2;
      else if (h1 + h2 < 360) hBar = (h1 + h2 + 360) / 2;
      else hBar = (h1 + h2 - 360) / 2;
    }
    const hue = (degrees) => degrees * Math.PI / 180;
    const t = 1 - 0.17 * Math.cos(hue(hBar - 30)) + 0.24 * Math.cos(hue(2 * hBar)) + 0.32 * Math.cos(hue(3 * hBar + 6)) - 0.2 * Math.cos(hue(4 * hBar - 63));
    const theta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
    const cBarP7 = cBarP ** 7;
    const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + 25 ** 7));
    const sl = 1 + 0.015 * (lBar - 50) ** 2 / Math.sqrt(20 + (lBar - 50) ** 2);
    const sc = 1 + 0.045 * cBarP;
    const sh = 1 + 0.015 * cBarP * t;
    const rt = -Math.sin(hue(2 * theta)) * rc;
    return Math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh));
  }
  function labPivot(value) {
    const delta = 6 / 29;
    return value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta * delta) + 4 / 29;
  }
  function hueDegrees(b, a) {
    if (a === 0 && b === 0) return 0;
    const degrees = Math.atan2(b, a) * 180 / Math.PI;
    return degrees < 0 ? degrees + 360 : degrees;
  }

  // src/denoise.ts
  var JPEG_BLOCK_SIZE = 8;
  var NOISY_SAMPLE_RESIDUAL = 2;
  var MIN_NOISY_FRACTION = 0.075;
  var MIN_MEAN_RESIDUAL = 0.5;
  var FLAT_BLOCK_VARIANCE = 256;
  var RANGE_SIGMA = 14;
  var SPATIAL_SIGMA = 1.35;
  var PASSES = 2;
  var MIN_SIDE = 48;
  var RADIUS = 2;
  function denoiseJpegArtifacts(rgba, width, height) {
    if (!wouldDenoise(rgba, width, height)) return rgba;
    let current = correctBlockOffsets(rgba, width, height);
    for (let pass = 0; pass < PASSES; pass += 1) current = bilateralPass(current, width, height);
    return current;
  }
  function wouldDenoise(rgba, width, height) {
    if (Math.min(width, height) < MIN_SIDE) return false;
    return isOpaqueRaster(rgba, width, height) && hasCompressionNoise(rgba, width, height);
  }
  function isOpaqueRaster(rgba, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 5 || height < 5 || rgba.length !== width * height * 4) return false;
    const pixels = width * height;
    let opaque = 0;
    for (let offset = 3; offset < rgba.length; offset += 4) if ((rgba[offset] ?? 0) >= 250) opaque += 1;
    return opaque >= pixels * 0.995;
  }
  function hasCompressionNoise(rgba, width, height) {
    let residualSum = 0;
    let noisySamples = 0;
    let eligibleSamples = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const center = (y * width + x) * 4;
        const left = center - 4;
        const right = center + 4;
        const up = center - width * 4;
        const down = center + width * 4;
        if (maxRgbGap(rgba, center, left) > 32 || maxRgbGap(rgba, center, right) > 32 || maxRgbGap(rgba, center, up) > 32 || maxRgbGap(rgba, center, down) > 32) continue;
        let residual = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          const laplacian = 4 * (rgba[center + channel] ?? 0) - (rgba[left + channel] ?? 0) - (rgba[right + channel] ?? 0) - (rgba[up + channel] ?? 0) - (rgba[down + channel] ?? 0);
          residual += Math.abs(laplacian) / 4;
        }
        residual /= 3;
        residualSum += residual;
        eligibleSamples += 1;
        if (residual >= NOISY_SAMPLE_RESIDUAL) noisySamples += 1;
      }
    }
    const residualNoise = eligibleSamples > 0 && noisySamples / eligibleSamples >= MIN_NOISY_FRACTION && residualSum / eligibleSamples >= MIN_MEAN_RESIDUAL;
    return residualNoise || hasBlockBoundaryNoise(rgba, width, height);
  }
  function hasBlockBoundaryNoise(rgba, width, height) {
    let boundarySum = 0;
    let boundaryCount = 0;
    let interiorSum = 0;
    let interiorCount = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 1; x < width; x += 1) {
        const right = (y * width + x) * 4;
        const left = right - 4;
        if (maxRgbGap(rgba, left, right) > 32) continue;
        const gap = meanRgbGap(rgba, left, right);
        if (x % JPEG_BLOCK_SIZE === 0) {
          boundarySum += gap;
          boundaryCount += 1;
        } else {
          interiorSum += gap;
          interiorCount += 1;
        }
      }
    }
    for (let y = 1; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const down = (y * width + x) * 4;
        const up = down - width * 4;
        if (maxRgbGap(rgba, up, down) > 32) continue;
        const gap = meanRgbGap(rgba, up, down);
        if (y % JPEG_BLOCK_SIZE === 0) {
          boundarySum += gap;
          boundaryCount += 1;
        } else {
          interiorSum += gap;
          interiorCount += 1;
        }
      }
    }
    if (boundaryCount === 0 || interiorCount === 0) return false;
    const boundaryMean = boundarySum / boundaryCount;
    const interiorMean = interiorSum / interiorCount;
    return boundaryMean >= 2 && boundaryMean - interiorMean >= 1.25 && boundaryMean >= interiorMean * 1.25;
  }
  function meanRgbGap(rgba, a, b) {
    return (Math.abs((rgba[a] ?? 0) - (rgba[b] ?? 0)) + Math.abs((rgba[a + 1] ?? 0) - (rgba[b + 1] ?? 0)) + Math.abs((rgba[a + 2] ?? 0) - (rgba[b + 2] ?? 0))) / 3;
  }
  function maxRgbGap(rgba, a, b) {
    return Math.max(
      Math.abs((rgba[a] ?? 0) - (rgba[b] ?? 0)),
      Math.abs((rgba[a + 1] ?? 0) - (rgba[b + 1] ?? 0)),
      Math.abs((rgba[a + 2] ?? 0) - (rgba[b + 2] ?? 0))
    );
  }
  function correctBlockOffsets(source, width, height) {
    const columns = Math.ceil(width / JPEG_BLOCK_SIZE);
    const rows = Math.ceil(height / JPEG_BLOCK_SIZE);
    const blockCount = columns * rows;
    const means = new Float64Array(blockCount * 3);
    const variances = new Float64Array(blockCount);
    for (let blockY = 0; blockY < rows; blockY += 1) {
      for (let blockX = 0; blockX < columns; blockX += 1) {
        const block = blockY * columns + blockX;
        const x0 = blockX * JPEG_BLOCK_SIZE;
        const y0 = blockY * JPEG_BLOCK_SIZE;
        const x1 = Math.min(width, x0 + JPEG_BLOCK_SIZE);
        const y1 = Math.min(height, y0 + JPEG_BLOCK_SIZE);
        let red = 0;
        let green = 0;
        let blue = 0;
        let pixels = 0;
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const offset = (y * width + x) * 4;
            red += source[offset] ?? 0;
            green += source[offset + 1] ?? 0;
            blue += source[offset + 2] ?? 0;
            pixels += 1;
          }
        }
        const meanOffset = block * 3;
        const meanRed = red / pixels;
        const meanGreen = green / pixels;
        const meanBlue = blue / pixels;
        means[meanOffset] = meanRed;
        means[meanOffset + 1] = meanGreen;
        means[meanOffset + 2] = meanBlue;
        let variance = 0;
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const offset = (y * width + x) * 4;
            variance += ((source[offset] ?? 0) - meanRed) ** 2;
            variance += ((source[offset + 1] ?? 0) - meanGreen) ** 2;
            variance += ((source[offset + 2] ?? 0) - meanBlue) ** 2;
          }
        }
        variances[block] = variance / (pixels * 3);
      }
    }
    const output = source.slice();
    for (let blockY = 0; blockY < rows; blockY += 1) {
      for (let blockX = 0; blockX < columns; blockX += 1) {
        const block = blockY * columns + blockX;
        if ((variances[block] ?? Number.POSITIVE_INFINITY) > FLAT_BLOCK_VARIANCE) continue;
        const meanOffset = block * 3;
        const red = means[meanOffset] ?? 0;
        const green = means[meanOffset + 1] ?? 0;
        const blue = means[meanOffset + 2] ?? 0;
        let weightSum = 0;
        let redSum = 0;
        let greenSum = 0;
        let blueSum = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const neighborY = blockY + dy;
          if (neighborY < 0 || neighborY >= rows) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const neighborX = blockX + dx;
            if (neighborX < 0 || neighborX >= columns) continue;
            const neighbor = neighborY * columns + neighborX;
            if ((variances[neighbor] ?? Number.POSITIVE_INFINITY) > FLAT_BLOCK_VARIANCE) continue;
            const neighborOffset = neighbor * 3;
            const neighborRed = means[neighborOffset] ?? 0;
            const neighborGreen = means[neighborOffset + 1] ?? 0;
            const neighborBlue = means[neighborOffset + 2] ?? 0;
            const distance3 = (red - neighborRed) ** 2 + (green - neighborGreen) ** 2 + (blue - neighborBlue) ** 2;
            if (distance3 > 64 * 64) continue;
            const weight = Math.exp(-distance3 / (2 * 20 * 20)) / (1 + dx * dx + dy * dy);
            weightSum += weight;
            redSum += neighborRed * weight;
            greenSum += neighborGreen * weight;
            blueSum += neighborBlue * weight;
          }
        }
        if (weightSum === 0) continue;
        const redDelta = Math.max(-12, Math.min(12, redSum / weightSum - red));
        const greenDelta = Math.max(-12, Math.min(12, greenSum / weightSum - green));
        const blueDelta = Math.max(-12, Math.min(12, blueSum / weightSum - blue));
        const x0 = blockX * JPEG_BLOCK_SIZE;
        const y0 = blockY * JPEG_BLOCK_SIZE;
        const x1 = Math.min(width, x0 + JPEG_BLOCK_SIZE);
        const y1 = Math.min(height, y0 + JPEG_BLOCK_SIZE);
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const offset = (y * width + x) * 4;
            output[offset] = clampByte((source[offset] ?? 0) + redDelta);
            output[offset + 1] = clampByte((source[offset + 1] ?? 0) + greenDelta);
            output[offset + 2] = clampByte((source[offset + 2] ?? 0) + blueDelta);
          }
        }
      }
    }
    return output;
  }
  function bilateralPass(source, width, height) {
    const output = source.slice();
    const rangeWeights = makeRangeWeights();
    const spatialWeights = makeSpatialWeights();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const center = (y * width + x) * 4;
        const red = source[center] ?? 0;
        const green = source[center + 1] ?? 0;
        const blue = source[center + 2] ?? 0;
        let totalWeight = 0;
        let redSum = 0;
        let greenSum = 0;
        let blueSum = 0;
        for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
          const sampleY = y + dy;
          if (sampleY < 0 || sampleY >= height) continue;
          for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
            const sampleX = x + dx;
            if (sampleX < 0 || sampleX >= width) continue;
            const sample = (sampleY * width + sampleX) * 4;
            const sampleRed = source[sample] ?? 0;
            const sampleGreen = source[sample + 1] ?? 0;
            const sampleBlue = source[sample + 2] ?? 0;
            const distance3 = (red - sampleRed) ** 2 + (green - sampleGreen) ** 2 + (blue - sampleBlue) ** 2;
            const rangeIndex = Math.min(rangeWeights.length - 1, Math.round(distance3 * 16 / (RANGE_SIGMA * RANGE_SIGMA)));
            const spatialIndex = (dy + RADIUS) * (RADIUS * 2 + 1) + dx + RADIUS;
            const weight = (spatialWeights[spatialIndex] ?? 0) * (rangeWeights[rangeIndex] ?? 0);
            totalWeight += weight;
            redSum += sampleRed * weight;
            greenSum += sampleGreen * weight;
            blueSum += sampleBlue * weight;
          }
        }
        if (totalWeight === 0) continue;
        output[center] = Math.round(redSum / totalWeight);
        output[center + 1] = Math.round(greenSum / totalWeight);
        output[center + 2] = Math.round(blueSum / totalWeight);
      }
    }
    return output;
  }
  function makeRangeWeights() {
    const weights = new Float32Array(2049);
    for (let index = 0; index < weights.length; index += 1) weights[index] = Math.exp(-index / 32);
    return weights;
  }
  function makeSpatialWeights() {
    const diameter = RADIUS * 2 + 1;
    const weights = new Float32Array(diameter * diameter);
    for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
      for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
        weights[(dy + RADIUS) * diameter + dx + RADIUS] = Math.exp(-(dx * dx + dy * dy) / (2 * SPATIAL_SIGMA * SPATIAL_SIGMA));
      }
    }
    return weights;
  }
  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  // src/jpeg-clean.ts
  function jpegCleanRaster(rgba, width, height) {
    return denoiseJpegArtifacts(rgba, width, height);
  }
  var MIN_CLEAN_SIDE = 96;
  function lossyCleanup(rgba, width, height) {
    return Math.max(width, height) >= MIN_CLEAN_SIDE && wouldDenoise(rgba, width, height) ? jpegCleanRaster : void 0;
  }
  var MERGE_DELTA_E = 3;
  var MINOR_DELTA_E = 6;
  var MINOR_SHARE = 0.1;
  var DARK_L = 12;
  var DARK_DELTA_E = 10;
  function mergeNearCenters(centers, lab, core) {
    if (centers.length < 2) return [...centers];
    const counts = new Float64Array(centers.length);
    for (let index = 0; index < core.length; index += 1) {
      if (core[index] !== 1) continue;
      const L = lab[index * 3] ?? 0, a = lab[index * 3 + 1] ?? 0, b = lab[index * 3 + 2] ?? 0;
      let best = 0;
      let bestDistance = Infinity;
      for (const [at, center] of centers.entries()) {
        const distance3 = (center.L - L) ** 2 + (center.a - a) ** 2 + (center.b - b) ** 2;
        if (distance3 < bestDistance) {
          bestDistance = distance3;
          best = at;
        }
      }
      counts[best] = (counts[best] ?? 0) + 1;
    }
    const cie = centers.map((center) => rgbToLab(oklabToRgb(center)));
    const order = centers.map((_, at) => at).sort((left, right) => (counts[right] ?? 0) - (counts[left] ?? 0) || left - right);
    const groups = [];
    for (const at of order) {
      const limit = (lead) => (cie[lead]?.L ?? 100) < DARK_L && (cie[at]?.L ?? 100) < DARK_L ? DARK_DELTA_E : (counts[at] ?? 0) < MINOR_SHARE * (counts[lead] ?? 0) ? MINOR_DELTA_E : MERGE_DELTA_E;
      const home = (counts[at] ?? 0) === 0 ? void 0 : groups.find((group) => deltaE2000(cie[group.lead], cie[at]) < limit(group.lead));
      if (home === void 0) groups.push({ lead: at, members: [at] });
      else home.members.push(at);
    }
    const kept = groups.filter((group) => !groups.some((left) => groups.some((right) => left !== right && left !== group && right !== group && (counts[group.lead] ?? 0) < MINOR_SHARE * Math.min(counts[left.lead] ?? 0, counts[right.lead] ?? 0) && onSegment2(centers[group.lead], centers[left.lead], centers[right.lead]))));
    if (kept.length === centers.length) return [...centers];
    groups.splice(0, groups.length, ...kept);
    return groups.sort((left, right) => left.lead - right.lead).map((group) => {
      const total = group.members.reduce((sum, at) => sum + Math.max(1, counts[at] ?? 0), 0);
      const mix = (pick) => group.members.reduce((sum, at) => sum + pick(centers[at]) * Math.max(1, counts[at] ?? 0), 0) / total;
      return { L: mix((center) => center.L), a: mix((center) => center.a), b: mix((center) => center.b) };
    });
  }
  var RING_DISTANCE = 0.04;
  function onSegment2(point2, from, to) {
    const span = { L: to.L - from.L, a: to.a - from.a, b: to.b - from.b };
    const length = span.L ** 2 + span.a ** 2 + span.b ** 2;
    if (length === 0) return false;
    const t = ((point2.L - from.L) * span.L + (point2.a - from.a) * span.a + (point2.b - from.b) * span.b) / length;
    if (t <= 0 || t >= 1) return false;
    const distance3 = Math.hypot(point2.L - from.L - t * span.L, point2.a - from.a - t * span.a, point2.b - from.b - t * span.b);
    return distance3 <= RING_DISTANCE;
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
  async function flatPlatesAsync(rgba, width, height, maxColors, preprocess = identityRaster, onProgress, shouldCancel) {
    if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    const context = createCooperativeContext(shouldCancel);
    onProgress?.(0);
    const boxes = await subjectBoxesAsync(rgba, width, height, context, (fraction) => onProgress?.(fraction * 0.04));
    onProgress?.(0.04);
    const plates = [];
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (box === void 0) continue;
      const base = index / boxes.length;
      const span = 1 / boxes.length;
      const cropW = box.width;
      const cropH = box.height;
      const crop = new Uint8Array(cropW * cropH * 4);
      for (let y = 0; y < cropH; y += 1) {
        const from = ((box.y + y) * width + box.x) * 4;
        crop.set(rgba.subarray(from, from + cropW * 4), y * cropW * 4);
        if (y % 8 === 0) {
          onProgress?.(0.04 + (base + span * 0.05 * (y + 1) / cropH) * 0.96);
          await cooperate(context);
        }
      }
      const painted = await labelImageAsync(crop, cropW, cropH, maxColors, preprocess, (fraction) => {
        onProgress?.(0.04 + (base + span * (0.05 + fraction * 0.95)) * 0.96);
      }, context);
      plates.push({
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
      });
    }
    onProgress?.(1);
    return plates;
  }
  function createCooperativeContext(shouldCancel) {
    return { lastYield: Date.now(), ...shouldCancel === void 0 ? {} : { shouldCancel } };
  }
  async function cooperate(context) {
    if (Date.now() - context.lastYield < 20) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    context.lastYield = Date.now();
    if (context.shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
  }
  function subjectBoxes(rgba, width, height, onProgress) {
    const found = enclosedBoxes(rgba, width, height, onProgress);
    if (found.length <= 1) return [{ x: 0, y: 0, width, height }];
    return found;
  }
  async function subjectBoxesAsync(rgba, width, height, context, onProgress) {
    const found = await enclosedBoxesAsync(rgba, width, height, context, onProgress);
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
    for (const point2 of points) {
      const x = point2[0] ?? 0;
      const y = point2[1] ?? 0;
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
    return hex2(Math.round(mean.r), Math.round(mean.g), Math.round(mean.b));
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
      const red = source[offset] ?? 0;
      const green = source[offset + 1] ?? 0;
      const blue = source[offset + 2] ?? 0;
      opacity[index] = source[offset + 3] ?? 0;
      alpha[index] = (opacity[index] ?? 0) >= 128 ? 255 : 0;
      const redLinear = SRGB_LINEAR[red] ?? 0;
      const greenLinear = SRGB_LINEAR[green] ?? 0;
      const blueLinear = SRGB_LINEAR[blue] ?? 0;
      const labOffset = index * 3;
      writeOklab(lab, labOffset, redLinear, greenLinear, blueLinear);
      linear[labOffset] = redLinear;
      linear[labOffset + 1] = greenLinear;
      linear[labOffset + 2] = blueLinear;
      if (index % Math.max(1, width * 2) === 0) onProgress?.(0.04 * index / count);
    }
    let core = coreMask(lab, alpha, width, height, CORE_TAU, (fraction) => onProgress?.(0.04 + fraction * 0.1));
    if (countOf(core) < 8) core = coreMask(lab, alpha, width, height, 0.08, (fraction) => onProgress?.(0.14 + fraction * 0.1));
    const userK = maxColors > 0 ? Math.min(K_MAX, Math.max(2, Math.round(maxColors))) : 0;
    const found = recoverThinColors(lab, alpha, core, width, height, buildPalette(lab, core, width, height, userK, (fraction) => onProgress?.(0.24 + fraction * 0.08)));
    const centers = source !== rgba ? mergeNearCenters(found, lab, core) : found;
    const edges = source !== rgba ? lossyEdges(source, count, centers) : void 0;
    const labels = assignLabels(linear, lab, core, alpha, opacity, width, height, centers, (fraction) => onProgress?.(0.32 + fraction * 0.54), edges);
    const colors = fillColors(source, alpha, core, labels, width, height, centers, (fraction) => onProgress?.(0.86 + fraction * 0.02));
    const painted = paintLabels2(labels, colors, width * UP, height * UP, (fraction) => onProgress?.(0.88 + fraction * 0.12));
    onProgress?.(1);
    return painted;
  }
  async function labelImageAsync(rgba, width, height, maxColors, preprocess, onProgress, context) {
    const prepared = preprocess(rgba, width, height);
    const source = prepared.length === rgba.length ? prepared : rgba;
    const count = width * height;
    const lab = new Float64Array(count * 3);
    const linear = new Float64Array(count * 3);
    const alpha = new Uint8Array(count);
    const opacity = new Uint8Array(count);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const offset = index * 4;
        const red = source[offset] ?? 0;
        const green = source[offset + 1] ?? 0;
        const blue = source[offset + 2] ?? 0;
        opacity[index] = source[offset + 3] ?? 0;
        alpha[index] = (opacity[index] ?? 0) >= 128 ? 255 : 0;
        const redLinear = SRGB_LINEAR[red] ?? 0;
        const greenLinear = SRGB_LINEAR[green] ?? 0;
        const blueLinear = SRGB_LINEAR[blue] ?? 0;
        const labOffset = index * 3;
        writeOklab(lab, labOffset, redLinear, greenLinear, blueLinear);
        linear[labOffset] = redLinear;
        linear[labOffset + 1] = greenLinear;
        linear[labOffset + 2] = blueLinear;
      }
      onProgress(0.04 * (y + 1) / height);
      await cooperate(context);
    }
    let core = await coreMaskAsync(lab, alpha, width, height, CORE_TAU, context);
    if (countOf(core) < 8) core = await coreMaskAsync(lab, alpha, width, height, 0.08, context);
    onProgress(0.14);
    const userK = maxColors > 0 ? Math.min(K_MAX, Math.max(2, Math.round(maxColors))) : 0;
    const found = recoverThinColors(lab, alpha, core, width, height, buildPalette(lab, core, width, height, userK));
    const centers = source !== rgba ? mergeNearCenters(found, lab, core) : found;
    onProgress(0.26);
    const edges = source !== rgba ? lossyEdges(source, count, centers) : void 0;
    const labels = await assignLabelsAsync(linear, lab, core, alpha, opacity, width, height, centers, context, (fraction) => onProgress(0.26 + fraction * 0.64), edges);
    const colors = fillColors(source, alpha, core, labels, width, height, centers);
    onProgress(0.94);
    const painted = await paintLabelsAsync2(labels, colors, width * UP, height * UP, context, (fraction) => onProgress(0.94 + fraction * 0.06));
    onProgress(1);
    return painted;
  }
  async function coreMaskAsync(lab, alpha, width, height, tau, context) {
    const core = new Uint8Array(width * height);
    const limit = tau * tau;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (alpha[index] === 0) continue;
        const colorOffset = index * 3;
        const lightness = lab[colorOffset];
        const greenRed = lab[colorOffset + 1];
        const blueYellow = lab[colorOffset + 2];
        let worst = 0;
        let flat = true;
        for (let dy = -1; dy <= 1 && flat; dy += 1) {
          for (let dx = -1; dx <= 1 && flat; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = Math.min(width - 1, Math.max(0, x + dx));
            const ny = Math.min(height - 1, Math.max(0, y + dy));
            const next = ny * width + nx;
            if (alpha[next] === 0) {
              flat = false;
              break;
            }
            const nextOffset = next * 3;
            const dL = lightness - lab[nextOffset];
            const da = greenRed - lab[nextOffset + 1];
            const db = blueYellow - lab[nextOffset + 2];
            const distance3 = dL * dL + da * da + db * db;
            if (distance3 > worst) worst = distance3;
            if (worst >= limit) flat = false;
          }
        }
        if (flat && worst < limit) core[index] = 1;
      }
      await cooperate(context);
    }
    return core;
  }
  async function assignLabelsAsync(linear, lab, core, alpha, opacity, width, height, centers, context, onProgress, edges) {
    const count = width * height;
    const kCount = centers.length;
    const coreLabel = new Int16Array(count);
    coreLabel.fill(-1);
    for (let index = 0; index < count; index += 1) {
      if (core[index] === 1) coreLabel[index] = nearestLab(readLab(lab, index), centers);
      if (index % 8192 === 0) await cooperate(context);
    }
    const allow = new Uint16Array(count);
    const disk = diskOffsets(DILATE_RADIUS);
    for (let index = 0; index < count; index += 1) {
      const label = coreLabel[index] ?? -1;
      if (label >= 0) {
        const x = index % width;
        const y = (index - x) / width;
        for (const offset of disk) {
          const nx = x + offset.x;
          const ny = y + offset.y;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const at = ny * width + nx;
          allow[at] = (allow[at] ?? 0) | 1 << label;
        }
      }
      if (index % 4096 === 0) await cooperate(context);
    }
    const square = squareOffsets(1);
    for (let index = 0; index < count; index += 1) {
      if (alpha[index] !== 0) {
        let near = 0;
        const color = readLab(lab, index);
        for (let label = 0; label < kCount; label += 1) {
          const center = centers[label];
          if (center === void 0) continue;
          if (Math.sqrt(labDistance2(color, center)) < OWN_COLOR) near |= 1 << label;
        }
        if (near !== 0) {
          const x = index % width;
          const y = (index - x) / width;
          for (const offset of square) {
            const nx = x + offset.x;
            const ny = y + offset.y;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const at = ny * width + nx;
            allow[at] = (allow[at] ?? 0) | near;
          }
        }
      }
      if (index % 4096 === 0) await cooperate(context);
    }
    const nearestCore = await nearestCoreLabelAsync(coreLabel, width, height, context);
    for (let index = 0; index < count; index += 1) {
      if ((allow[index] ?? 0) === 0) {
        const label = nearestCore[index] ?? -1;
        if (label >= 0) allow[index] = 1 << label;
      }
      if (index % 8192 === 0) await cooperate(context);
    }
    onProgress(0.18);
    const upW = width * UP;
    const upH = height * UP;
    const labels = new Uint8Array(upW * upH);
    labels.fill(255);
    const bicubic = bicubicTable(width, height);
    const bitLists = /* @__PURE__ */ new Map();
    const tile = 48;
    for (let y0 = 0; y0 < height; y0 += tile) {
      const y1 = Math.min(height, y0 + tile);
      for (let y = y0; y < y1; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (alpha[y * width + x] === 0) continue;
          const mask = allow[y * width + x] ?? 0;
          let bits = bitLists.get(mask);
          if (bits === void 0) {
            bits = bitList(mask, kCount);
            bitLists.set(mask, bits);
          }
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
              labels[at] = edges === void 0 ? explain(bicubicLabAt(linear, width, bicubic, ux, uy), bits, centers) : explainLossy(edges, width, bicubic, ux, uy, bits, centers);
            }
          }
        }
        onProgress(0.18 + 0.25 * (y + 1) / height);
        await cooperate(context);
      }
    }
    await cleanLabelsAsync(labels, upW, upH, kCount, Math.floor(SPECK_SOURCE * UP * UP), context, (fraction) => onProgress(0.43 + fraction * 0.2));
    await smoothLabelsAsync(labels, upW, upH, kCount, SMOOTH_SOURCE * UP, context, (fraction) => onProgress(0.63 + fraction * 0.28));
    cutTransparent(labels, opacity, width, height);
    onProgress(1);
    return labels;
  }
  async function nearestCoreLabelAsync(coreLabel, width, height, context) {
    const nearest2 = new Int16Array(coreLabel.length);
    nearest2.fill(-1);
    const queue = new Int32Array(coreLabel.length);
    let tail = 0;
    for (let index = 0; index < coreLabel.length; index += 1) {
      const label = coreLabel[index] ?? -1;
      if (label < 0) continue;
      nearest2[index] = label;
      queue[tail] = index;
      tail += 1;
      if (index % 8192 === 0) await cooperate(context);
    }
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const index = queue[cursor];
      const label = nearest2[index];
      const x = index % width;
      if (x > 0 && nearest2[index - 1] < 0) {
        nearest2[index - 1] = label;
        queue[tail] = index - 1;
        tail += 1;
      }
      if (x + 1 < width && nearest2[index + 1] < 0) {
        nearest2[index + 1] = label;
        queue[tail] = index + 1;
        tail += 1;
      }
      if (index >= width && nearest2[index - width] < 0) {
        nearest2[index - width] = label;
        queue[tail] = index - width;
        tail += 1;
      }
      if (index + width < coreLabel.length && nearest2[index + width] < 0) {
        nearest2[index + width] = label;
        queue[tail] = index + width;
        tail += 1;
      }
      if (cursor % 4096 === 0) await cooperate(context);
    }
    return nearest2;
  }
  async function cleanLabelsAsync(labels, width, height, kCount, minArea, context, onProgress) {
    const retry = new Uint8Array(kCount);
    for (let pass = 0; pass < 2; pass += 1) {
      for (let label = 0; label < kCount; label += 1) {
        if (pass === 1 && retry[label] !== 1) continue;
        const components2 = await smallLabelComponentsAsync(labels, label, width, height, minArea, context);
        const small = components2.mask;
        if (components2.any) {
          const replacement = await nearestOutsideAsync(labels, small, components2.pixels, width, height, context);
          for (let cursor = 0; cursor < components2.pixels.length; cursor += 1) {
            const index = components2.pixels[cursor];
            const next = replacement[index] ?? label;
            if (next !== label) retry[next] = 1;
            labels[index] = next;
            if (cursor % 16384 === 0) await cooperate(context);
          }
        }
        onProgress((pass * kCount + label + 1) / (2 * Math.max(1, kCount)));
      }
    }
  }
  async function componentsAsync(mask, width, height, context) {
    const ids = new Int32Array(mask.length);
    const sizes = [0];
    const stack = [];
    let visits = 0;
    for (let start2 = 0; start2 < mask.length; start2 += 1) {
      if (mask[start2] !== 1 || ids[start2] !== 0) continue;
      const id = sizes.length;
      sizes.push(0);
      stack.push(start2);
      ids[start2] = id;
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
        visits += 1;
        if (visits % 4096 === 0) await cooperate(context);
      }
      if (start2 % 16384 === 0) await cooperate(context);
    }
    return { ids, sizes: Int32Array.from(sizes), count: sizes.length - 1 };
  }
  async function nearestOutsideAsync(labels, small, smallPixels, width, height, context) {
    const nearest2 = new Uint8Array(labels.length);
    const queue = new Int32Array(labels.length);
    let tail = 0;
    if (smallPixels.length <= labels.length / 32) {
      const boundary = [];
      for (let cursor = 0; cursor < smallPixels.length; cursor += 1) {
        const index = smallPixels[cursor];
        const x = index % width;
        if (x > 0 && small[index - 1] === 0) boundary.push(index - 1);
        if (x + 1 < width && small[index + 1] === 0) boundary.push(index + 1);
        if (index >= width && small[index - width] === 0) boundary.push(index - width);
        if (index + width < small.length && small[index + width] === 0) boundary.push(index + width);
        if (cursor % 4096 === 0) await cooperate(context);
      }
      boundary.sort((left, right) => left - right);
      let previous = -1;
      for (const index of boundary) {
        if (index === previous) continue;
        previous = index;
        nearest2[index] = labels[index] ?? 0;
        queue[tail] = index;
        tail += 1;
      }
    } else {
      for (let index = 0; index < small.length; index += 1) {
        if (small[index] === 1) continue;
        const x = index % width;
        const touchesSmall = x > 0 && small[index - 1] === 1 || x + 1 < width && small[index + 1] === 1 || index >= width && small[index - width] === 1 || index + width < small.length && small[index + width] === 1;
        if (touchesSmall) {
          nearest2[index] = labels[index] ?? 0;
          queue[tail] = index;
          tail += 1;
        }
        if (index % 16384 === 0) await cooperate(context);
      }
    }
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const index = queue[cursor] ?? 0;
      const x = index % width;
      const label = nearest2[index] ?? 0;
      if (x > 0 && small[index - 1] === 1) {
        small[index - 1] = 2;
        nearest2[index - 1] = label;
        queue[tail] = index - 1;
        tail += 1;
      }
      if (x + 1 < width && small[index + 1] === 1) {
        small[index + 1] = 2;
        nearest2[index + 1] = label;
        queue[tail] = index + 1;
        tail += 1;
      }
      if (index >= width && small[index - width] === 1) {
        small[index - width] = 2;
        nearest2[index - width] = label;
        queue[tail] = index - width;
        tail += 1;
      }
      if (index + width < labels.length && small[index + width] === 1) {
        small[index + width] = 2;
        nearest2[index + width] = label;
        queue[tail] = index + width;
        tail += 1;
      }
      if (cursor % 4096 === 0) await cooperate(context);
    }
    return nearest2;
  }
  async function smoothLabelsAsync(labels, width, height, kCount, sigma, context, onProgress) {
    if (!(sigma > 0)) return;
    const kernel = gaussianKernel(sigma);
    const radius = kernel.length - 1 >> 1;
    const { candidates, candidateSpans, neededSpans, xSamples, ySamples, activeLabels } = await smoothingMasksAsync(labels, width, height, radius, kCount, context);
    const { horizontalScores, scoreOffsets, vertical } = await smoothingScoresAsync(labels, width, kCount, kernel, activeLabels, candidateSpans, neededSpans, xSamples, ySamples, context);
    const next = labels.slice();
    const taps = kernel.length;
    for (let span = 0; span < candidateSpans.length; span += 3) {
      const row = candidateSpans[span];
      const start2 = candidateSpans[span + 1];
      const end = candidateSpans[span + 2];
      const yOffset = row / width * taps;
      for (let x = start2; x < end; x += 1) {
        const index = row + x;
        let winner = activeLabels[0] ?? 0;
        let best = -1;
        for (let channel = 0; channel < activeLabels.length; channel += 1) {
          const label = activeLabels[channel];
          let sum = 0;
          if ((vertical[index] & 1 << label) !== 0) {
            for (let tap = 0; tap < taps; tap += 1) {
              const sampleY = ySamples[yOffset + tap];
              const sampleIndex = sampleY * width + x;
              const scoreOffset = scoreOffsets[sampleIndex];
              sum += horizontalScores[scoreOffset + channel] * kernel[tap];
            }
          }
          if (sum > best) {
            best = sum;
            winner = label;
          }
        }
        if (activeLabels.length > 0) next[index] = winner;
      }
      onProgress((span + 3) / Math.max(3, candidateSpans.length));
      await cooperate(context);
    }
    for (let index = 0; index < labels.length; index += 1) {
      if (candidates[index] === 0 && labels[index] === 255) next[index] = 0;
      if (index % 16384 === 0) await cooperate(context);
    }
    labels.set(next);
  }
  async function paintLabelsAsync2(labels, colors, width, height, context, onProgress) {
    const used = /* @__PURE__ */ new Map();
    const palette = [];
    const rgba = new Uint8Array(width * height * 4);
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index] ?? 255;
      if (label !== 255) {
        let slot = used.get(label);
        if (slot === void 0) {
          const color2 = colors[label] ?? { r: 0, g: 0, b: 0 };
          const paint = hex2(color2.r, color2.g, color2.b);
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
      if (index % 16384 === 0) {
        onProgress(index / labels.length);
        await cooperate(context);
      }
    }
    onProgress(1);
    return { rgba, width, height, palette };
  }
  function assignLabels(linear, lab, core, alpha, opacity, width, height, centers, onProgress, edges) {
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
    const bicubic = bicubicTable(width, height);
    const bitLists = /* @__PURE__ */ new Map();
    const tile = 48;
    for (let y0 = 0; y0 < height; y0 += tile) {
      const y1 = Math.min(height, y0 + tile);
      for (let y = y0; y < y1; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (alpha[y * width + x] === 0) continue;
          const mask = allow[y * width + x] ?? 0;
          let bits = bitLists.get(mask);
          if (bits === void 0) {
            bits = bitList(mask, kCount);
            bitLists.set(mask, bits);
          }
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
              labels[at] = edges === void 0 ? explain(bicubicLabAt(linear, width, bicubic, ux, uy), bits, centers) : explainLossy(edges, width, bicubic, ux, uy, bits, centers);
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
          if (bestError === Number.POSITIVE_INFINITY) for (const line2 of neighbours) consider(line2.mask);
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
    const queue = new Int32Array(coreLabel.length);
    let tail = 0;
    for (let index = 0; index < coreLabel.length; index += 1) {
      const label = coreLabel[index] ?? -1;
      if (label < 0) continue;
      nearest2[index] = label;
      queue[tail] = index;
      tail += 1;
      if (index % 16384 === 0) onProgress?.(0.4 * index / coreLabel.length);
    }
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const index = queue[cursor];
      const label = nearest2[index];
      const x = index % width;
      if (x > 0 && nearest2[index - 1] < 0) {
        nearest2[index - 1] = label;
        queue[tail] = index - 1;
        tail += 1;
      }
      if (x + 1 < width && nearest2[index + 1] < 0) {
        nearest2[index + 1] = label;
        queue[tail] = index + 1;
        tail += 1;
      }
      if (index >= width && nearest2[index - width] < 0) {
        nearest2[index - width] = label;
        queue[tail] = index - width;
        tail += 1;
      }
      if (index + width < coreLabel.length && nearest2[index + width] < 0) {
        nearest2[index + width] = label;
        queue[tail] = index + width;
        tail += 1;
      }
      if (cursor % 4096 === 0) onProgress?.(0.4 + 0.6 * cursor / Math.max(1, tail));
    }
    onProgress?.(1);
    return nearest2;
  }
  var LOSSY_SRGB_WEIGHT = 0.5;
  function lossyEdges(source, count, centers) {
    const srgb = new Float64Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      srgb[index * 3] = source[index * 4] ?? 0;
      srgb[index * 3 + 1] = source[index * 4 + 1] ?? 0;
      srgb[index * 3 + 2] = source[index * 4 + 2] ?? 0;
    }
    return { srgb, centers: centers.map((center) => oklabToRgb(center)) };
  }
  function explainLossy(edges, width, table, x, y, bits, centers) {
    const xOffset = x * 4;
    const yOffset = y * 4;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let ky = 0; ky < 4; ky += 1) {
      const weightY = table.yWeights[yOffset + ky];
      const sampleY = table.yIndices[yOffset + ky];
      for (let kx = 0; kx < 4; kx += 1) {
        const weight = weightY * table.xWeights[xOffset + kx];
        const offset = (sampleY * width + table.xIndices[xOffset + kx]) * 3;
        red += edges.srgb[offset] * weight;
        green += edges.srgb[offset + 1] * weight;
        blue += edges.srgb[offset + 2] * weight;
      }
    }
    const rgb = { r: Math.min(255, Math.max(0, red)), g: Math.min(255, Math.max(0, green)), b: Math.min(255, Math.max(0, blue)) };
    return explain(rgbToOklab(rgb), bits, centers, (a, b, oklab) => {
      const from = edges.centers[a];
      const to = edges.centers[b];
      const dr = to.r - from.r, dg = to.g - from.g, db = to.b - from.b;
      const length = dr * dr + dg * dg + db * db;
      const srgb = length === 0 ? oklab : ((rgb.r - from.r) * dr + (rgb.g - from.g) * dg + (rgb.b - from.b) * db) / length;
      return LOSSY_SRGB_WEIGHT * srgb + (1 - LOSSY_SRGB_WEIGHT) * oklab;
    });
  }
  function explain(sample, bits, centers, mix) {
    let best = bits[0] ?? 0;
    let bestDistance = Infinity;
    for (const label of bits) {
      const center = centers[label];
      if (center === void 0) continue;
      const distance3 = Math.sqrt(labDistance2(sample, center));
      if (distance3 < bestDistance) {
        bestDistance = distance3;
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
          best = (mix === void 0 ? projected.t : mix(a, b, projected.t)) < 0.5 ? a : b;
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
  function paintLabels2(labels, colors, width, height, onProgress) {
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
        const paint = hex2(color2.r, color2.g, color2.b);
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
    const distance3 = new Float64Array(count);
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
      distance3[index] = best;
    }
    while (centers.length < k && centers.length < count + pinned) {
      let at = 0;
      let score = -1;
      for (let index = 0; index < count; index += 1) {
        const next = (distance3[index] ?? 0) * Math.sqrt(weights[index] ?? 0);
        if (next > score) {
          score = next;
          at = index;
        }
      }
      if (score <= 0 && centers.length >= pinned) break;
      const center = samples[at] ?? zeroLab();
      centers.push({ L: center.L, a: center.a, b: center.b });
      for (let index = 0; index < count; index += 1) {
        distance3[index] = Math.min(distance3[index] ?? 0, Math.sqrt(labDistance2(samples[index] ?? zeroLab(), center)));
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
    const retry = new Uint8Array(kCount);
    for (let pass = 0; pass < 2; pass += 1) {
      for (let label = 0; label < kCount; label += 1) {
        if (pass === 1 && retry[label] !== 1) continue;
        const components2 = smallLabelComponents(labels, label, width, height, minArea, (fraction) => onProgress?.((pass * kCount + label) / (2 * Math.max(1, kCount)) + fraction * 0.5 / Math.max(1, kCount)));
        const small = components2.mask;
        if (!components2.any) continue;
        const replacement = nearestOutside(labels, small, components2.pixels, width, height, (fraction) => onProgress?.((pass * kCount + label) / (2 * Math.max(1, kCount)) + 0.5 / Math.max(1, kCount) + fraction * 0.5 / Math.max(1, kCount)));
        for (const index of components2.pixels) {
          const next = replacement[index] ?? label;
          if (next !== label) retry[next] = 1;
          labels[index] = next;
        }
        onProgress?.((pass * kCount + label + 1) / (2 * Math.max(1, kCount)));
      }
    }
    onProgress?.(1);
  }
  function nearestOutside(labels, small, smallPixels, width, height, onProgress) {
    const nearest2 = new Uint8Array(labels.length);
    const queue = new Int32Array(labels.length);
    let tail = 0;
    if (smallPixels.length <= labels.length / 32) {
      const boundary = [];
      for (const index of smallPixels) {
        const x = index % width;
        if (x > 0 && small[index - 1] === 0) boundary.push(index - 1);
        if (x + 1 < width && small[index + 1] === 0) boundary.push(index + 1);
        if (index >= width && small[index - width] === 0) boundary.push(index - width);
        if (index + width < small.length && small[index + width] === 0) boundary.push(index + width);
      }
      boundary.sort((left, right) => left - right);
      let previous = -1;
      for (const index of boundary) {
        if (index === previous) continue;
        previous = index;
        nearest2[index] = labels[index] ?? 0;
        queue[tail] = index;
        tail += 1;
      }
    } else {
      for (let index = 0; index < small.length; index += 1) {
        if (small[index] === 1) continue;
        const x = index % width;
        const touchesSmall = x > 0 && small[index - 1] === 1 || x + 1 < width && small[index + 1] === 1 || index >= width && small[index - width] === 1 || index + width < small.length && small[index + width] === 1;
        if (!touchesSmall) continue;
        nearest2[index] = labels[index] ?? 0;
        queue[tail] = index;
        tail += 1;
      }
    }
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const index = queue[cursor] ?? 0;
      const x = index % width;
      const label = nearest2[index] ?? 0;
      if (x > 0 && small[index - 1] === 1) {
        small[index - 1] = 2;
        nearest2[index - 1] = label;
        queue[tail] = index - 1;
        tail += 1;
      }
      if (x + 1 < width && small[index + 1] === 1) {
        small[index + 1] = 2;
        nearest2[index + 1] = label;
        queue[tail] = index + 1;
        tail += 1;
      }
      if (index >= width && small[index - width] === 1) {
        small[index - width] = 2;
        nearest2[index - width] = label;
        queue[tail] = index - width;
        tail += 1;
      }
      if (index + width < labels.length && small[index + width] === 1) {
        small[index + width] = 2;
        nearest2[index + width] = label;
        queue[tail] = index + width;
        tail += 1;
      }
      if (cursor % 16384 === 0) onProgress?.(cursor / Math.max(1, tail));
    }
    return nearest2;
  }
  function smoothLabels(labels, width, height, kCount, sigma, onProgress) {
    if (!(sigma > 0)) return;
    const kernel = gaussianKernel(sigma);
    const radius = kernel.length - 1 >> 1;
    const { candidates, candidateSpans, ySamples, activeLabels, neededSpans, xSamples } = smoothingMasks(labels, width, height, radius, kCount);
    const { horizontalScores, scoreOffsets, vertical } = smoothingScores(labels, width, kCount, kernel, activeLabels, candidateSpans, neededSpans, xSamples, ySamples);
    const next = labels.slice();
    const taps = kernel.length;
    for (let span = 0; span < candidateSpans.length; span += 3) {
      const row = candidateSpans[span];
      const start2 = candidateSpans[span + 1];
      const end = candidateSpans[span + 2];
      const yOffset = row / width * taps;
      for (let x = start2; x < end; x += 1) {
        const index = row + x;
        let winner = activeLabels[0] ?? 0;
        let best = -1;
        for (let channel = 0; channel < activeLabels.length; channel += 1) {
          const label = activeLabels[channel];
          let sum = 0;
          if ((vertical[index] & 1 << label) !== 0) {
            for (let tap = 0; tap < taps; tap += 1) {
              const sampleY = ySamples[yOffset + tap];
              const sampleIndex = sampleY * width + x;
              const scoreOffset = scoreOffsets[sampleIndex];
              sum += horizontalScores[scoreOffset + channel] * kernel[tap];
            }
          }
          if (sum > best) {
            best = sum;
            winner = label;
          }
        }
        if (activeLabels.length > 0) next[index] = winner;
      }
      onProgress?.((span + 3) / Math.max(3, candidateSpans.length));
    }
    for (let index = 0; index < labels.length; index += 1) {
      if (candidates[index] === 0 && labels[index] === 255) next[index] = 0;
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
  function labDistanceGreaterThan(lab, leftOffset, rightOffset, threshold) {
    const dL = lab[leftOffset] - lab[rightOffset];
    const da = lab[leftOffset + 1] - lab[rightOffset + 1];
    const db = lab[leftOffset + 2] - lab[rightOffset + 2];
    return Math.sqrt(dL * dL + da * da + db * db) > threshold;
  }
  function enclosedBoxes(rgba, width, height, onProgress) {
    const count = width * height;
    if (width < 2 || height < 2 || rgba.length < count * 4) return [];
    const lab = new Float64Array(count * 3);
    const opaque = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4;
      opaque[index] = (rgba[offset + 3] ?? 0) >= 128 ? 1 : 0;
      const red = rgba[offset] ?? 0;
      const green = rgba[offset + 1] ?? 0;
      const blue = rgba[offset + 2] ?? 0;
      writeOklab(lab, index * 3, SRGB_LINEAR[red] ?? 0, SRGB_LINEAR[green] ?? 0, SRGB_LINEAR[blue] ?? 0);
      if (index % 16384 === 0) onProgress?.(0.2 * index / count);
    }
    const edge = new Uint8Array(count);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (opaque[index] !== 1) continue;
        const colorOffset = index * 3;
        let strong = false;
        if (x > 0) {
          const next = index - 1;
          strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
        }
        if (!strong && x + 1 < width) {
          const next = index + 1;
          strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
        }
        if (!strong && y > 0) {
          const next = index - width;
          strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
        }
        if (!strong && y + 1 < height) {
          const next = index + width;
          strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
        }
        if (strong) edge[index] = 1;
      }
      onProgress?.(0.2 + 0.2 * (y + 1) / height);
    }
    const outside = new Uint8Array(count);
    const queue = new Int32Array(count);
    let tail = 0;
    for (let x = 0; x < width; x += 1) {
      tail = seedOutside(x, edge, outside, queue, tail);
      tail = seedOutside((height - 1) * width + x, edge, outside, queue, tail);
    }
    for (let y = 0; y < height; y += 1) {
      tail = seedOutside(y * width, edge, outside, queue, tail);
      tail = seedOutside(y * width + width - 1, edge, outside, queue, tail);
    }
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const index = queue[cursor];
      const x = index % width;
      if (x > 0) tail = seedOutside(index - 1, edge, outside, queue, tail);
      if (x + 1 < width) tail = seedOutside(index + 1, edge, outside, queue, tail);
      if (index >= width) tail = seedOutside(index - width, edge, outside, queue, tail);
      if (index + width < count) tail = seedOutside(index + width, edge, outside, queue, tail);
      if (cursor % 16384 === 0) onProgress?.(0.4 + 0.2 * cursor / Math.max(1, tail));
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
  async function enclosedBoxesAsync(rgba, width, height, context, onProgress) {
    const count = width * height;
    if (width < 2 || height < 2 || rgba.length < count * 4) return [];
    const lab = new Float64Array(count * 3);
    const opaque = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4;
      opaque[index] = (rgba[offset + 3] ?? 0) >= 128 ? 1 : 0;
      const red = rgba[offset] ?? 0;
      const green = rgba[offset + 1] ?? 0;
      const blue = rgba[offset + 2] ?? 0;
      writeOklab(lab, index * 3, SRGB_LINEAR[red] ?? 0, SRGB_LINEAR[green] ?? 0, SRGB_LINEAR[blue] ?? 0);
      if (index % 8192 === 0) {
        onProgress(0.2 * index / count);
        await cooperate(context);
      }
    }
    const edge = new Uint8Array(count);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (opaque[index] !== 1) continue;
        const colorOffset = index * 3;
        let strong = false;
        if (x > 0) {
          const next = index - 1;
          strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
        }
        if (!strong && x + 1 < width) {
          const next = index + 1;
          strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
        }
        if (!strong && y > 0) {
          const next = index - width;
          strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
        }
        if (!strong && y + 1 < height) {
          const next = index + width;
          strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
        }
        if (strong) edge[index] = 1;
      }
      onProgress(0.2 + 0.2 * (y + 1) / height);
      await cooperate(context);
    }
    const outside = new Uint8Array(count);
    const queue = new Int32Array(count);
    let tail = 0;
    for (let x = 0; x < width; x += 1) {
      tail = seedOutside(x, edge, outside, queue, tail);
      tail = seedOutside((height - 1) * width + x, edge, outside, queue, tail);
    }
    for (let y = 0; y < height; y += 1) {
      tail = seedOutside(y * width, edge, outside, queue, tail);
      tail = seedOutside(y * width + width - 1, edge, outside, queue, tail);
    }
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const index = queue[cursor];
      const x = index % width;
      if (x > 0) tail = seedOutside(index - 1, edge, outside, queue, tail);
      if (x + 1 < width) tail = seedOutside(index + 1, edge, outside, queue, tail);
      if (index >= width) tail = seedOutside(index - width, edge, outside, queue, tail);
      if (index + width < count) tail = seedOutside(index + width, edge, outside, queue, tail);
      if (cursor % 4096 === 0) {
        onProgress(0.4 + 0.2 * cursor / Math.max(1, tail));
        await cooperate(context);
      }
    }
    if (outsideHoldsSubject(rgba, lab, opaque, outside, width, height)) return [];
    const object = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      if (opaque[index] === 1 && outside[index] !== 1) object[index] = 1;
      if (index % 8192 === 0) {
        onProgress(0.6 + 0.1 * index / count);
        await cooperate(context);
      }
    }
    const labeled = await componentsAsync(object, width, height, context);
    const boxes = [];
    for (let id = 1; id <= labeled.count; id += 1) {
      if ((labeled.sizes[id] ?? 0) < 400) continue;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      for (let index = 0; index < count; index += 1) {
        if ((labeled.ids[index] ?? 0) === id) {
          const x2 = index % width;
          const y2 = (index - x2) / width;
          if (x2 < minX) minX = x2;
          if (y2 < minY) minY = y2;
          if (x2 > maxX) maxX = x2;
          if (y2 > maxY) maxY = y2;
        }
        if (index % 8192 === 0) await cooperate(context);
      }
      const pad = 2;
      const x = Math.max(0, minX - pad);
      const y = Math.max(0, minY - pad);
      boxes.push({ x, y, width: Math.min(width, maxX + 1 + pad) - x, height: Math.min(height, maxY + 1 + pad) - y });
      onProgress(0.7 + 0.3 * id / Math.max(1, labeled.count));
    }
    onProgress(1);
    return mergeBoxes(boxes, 8);
  }
  function seedOutside(index, edge, outside, queue, tail) {
    if (edge[index] === 1 || outside[index] === 1) return tail;
    outside[index] = 1;
    queue[tail] = index;
    return tail + 1;
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
        const colorOffset = index * 3;
        const lightness = lab[colorOffset];
        const greenRed = lab[colorOffset + 1];
        const blueYellow = lab[colorOffset + 2];
        let worst = 0;
        let flat = true;
        for (let dy = -1; dy <= 1 && flat; dy += 1) {
          for (let dx = -1; dx <= 1 && flat; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = Math.min(width - 1, Math.max(0, x + dx));
            const ny = Math.min(height - 1, Math.max(0, y + dy));
            const next = ny * width + nx;
            if (alpha[next] === 0) {
              flat = false;
              break;
            }
            const nextOffset = next * 3;
            const dL = lightness - lab[nextOffset];
            const da = greenRed - lab[nextOffset + 1];
            const db = blueYellow - lab[nextOffset + 2];
            const distance3 = dL * dL + da * da + db * db;
            if (distance3 > worst) worst = distance3;
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
    for (let start2 = 0; start2 < mask.length; start2 += 1) {
      if (mask[start2] !== 1 || ids[start2] !== 0) continue;
      const id = sizes.length;
      sizes.push(0);
      stack.push(start2);
      ids[start2] = id;
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
      if (start2 % 16384 === 0) onProgress?.(start2 / mask.length);
    }
    onProgress?.(1);
    return { ids, sizes: Int32Array.from(sizes), count: sizes.length - 1 };
  }
  function smallLabelComponents(labels, label, width, height, minArea, onProgress) {
    const parent = [0];
    const size = [0];
    const runs = [];
    let previous = [];
    for (let y = 0; y < height; y += 1) {
      const current = [];
      const row = y * width;
      const rowLabels = labels.subarray(row, row + width);
      let x = 0;
      let previousStart = 0;
      while (x < width) {
        const start2 = rowLabels.indexOf(label, x);
        if (start2 < 0) break;
        x = start2 + 1;
        while (x < width && rowLabels[x] === label) x += 1;
        const id = parent.length;
        parent.push(id);
        size.push(x - start2);
        const run = { y, start: start2, end: x, id };
        runs.push(run);
        current.push(run);
        while (previousStart < previous.length && (previous[previousStart]?.end ?? 0) < start2) previousStart += 1;
        for (let index = previousStart; index < previous.length; index += 1) {
          const other = previous[index];
          if (other === void 0 || other.start > x) break;
          let left = id;
          while ((parent[left] ?? left) !== left) left = parent[left] ?? left;
          let right = other.id;
          while ((parent[right] ?? right) !== right) right = parent[right] ?? right;
          if (left === right) continue;
          if ((size[left] ?? 0) < (size[right] ?? 0)) [left, right] = [right, left];
          parent[right] = left;
          size[left] = (size[left] ?? 0) + (size[right] ?? 0);
        }
      }
      previous = current;
      onProgress?.((y + 1) / height);
    }
    const small = new Uint8Array(labels.length);
    const pixels = [];
    let any = false;
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      if (run === void 0) continue;
      let root = run.id;
      while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
      if ((size[root] ?? 0) >= minArea) continue;
      any = true;
      const row = run.y * width;
      for (let x = run.start; x < run.end; x += 1) {
        const pixel = row + x;
        small[pixel] = 1;
        pixels.push(pixel);
      }
      if (index % 4096 === 0) onProgress?.(0.5 + 0.5 * (index + 1) / Math.max(1, runs.length));
    }
    onProgress?.(1);
    return { mask: small, any, pixels: Uint32Array.from(pixels) };
  }
  async function smallLabelComponentsAsync(labels, label, width, height, minArea, context) {
    const parent = [0];
    const size = [0];
    const runs = [];
    let previous = [];
    for (let y = 0; y < height; y += 1) {
      const current = [];
      const row = y * width;
      const rowLabels = labels.subarray(row, row + width);
      let x = 0;
      let previousStart = 0;
      while (x < width) {
        const start2 = rowLabels.indexOf(label, x);
        if (start2 < 0) break;
        x = start2 + 1;
        while (x < width && rowLabels[x] === label) x += 1;
        const id = parent.length;
        parent.push(id);
        size.push(x - start2);
        const run = { y, start: start2, end: x, id };
        runs.push(run);
        current.push(run);
        while (previousStart < previous.length && (previous[previousStart]?.end ?? 0) < start2) previousStart += 1;
        for (let index = previousStart; index < previous.length; index += 1) {
          const other = previous[index];
          if (other === void 0 || other.start > x) break;
          let left = id;
          while ((parent[left] ?? left) !== left) left = parent[left] ?? left;
          let right = other.id;
          while ((parent[right] ?? right) !== right) right = parent[right] ?? right;
          if (left === right) continue;
          if ((size[left] ?? 0) < (size[right] ?? 0)) [left, right] = [right, left];
          parent[right] = left;
          size[left] = (size[left] ?? 0) + (size[right] ?? 0);
        }
      }
      previous = current;
      await cooperate(context);
    }
    const small = new Uint8Array(labels.length);
    const pixels = [];
    let any = false;
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      if (run === void 0) continue;
      let root = run.id;
      while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
      if ((size[root] ?? 0) < minArea) {
        any = true;
        const row = run.y * width;
        for (let x = run.start; x < run.end; x += 1) {
          const pixel = row + x;
          small[pixel] = 1;
          pixels.push(pixel);
        }
      }
      if (index % 4096 === 0) await cooperate(context);
    }
    return { mask: small, any, pixels: Uint32Array.from(pixels) };
  }
  function bicubicTable(width, height) {
    const upWidth = width * UP;
    const upHeight = height * UP;
    const xIndices = new Int32Array(upWidth * 4);
    const xWeights = new Float64Array(upWidth * 4);
    const yIndices = new Int32Array(upHeight * 4);
    const yWeights = new Float64Array(upHeight * 4);
    for (let x = 0; x < upWidth; x += 1) {
      const sx = (x + 0.5) / UP - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const offset = x * 4;
      for (let tap = 0; tap < 4; tap += 1) {
        const kx = tap - 1;
        xIndices[offset + tap] = reflect101(x0 + kx, width);
        xWeights[offset + tap] = keys(fx - kx);
      }
    }
    for (let y = 0; y < upHeight; y += 1) {
      const sy = (y + 0.5) / UP - 0.5;
      const y0 = Math.floor(sy);
      const fy = sy - y0;
      const offset = y * 4;
      for (let tap = 0; tap < 4; tap += 1) {
        const ky = tap - 1;
        yIndices[offset + tap] = reflect101(y0 + ky, height);
        yWeights[offset + tap] = keys(fy - ky);
      }
    }
    return { xIndices, xWeights, yIndices, yWeights };
  }
  function bicubicLabAt(linear, width, table, x, y) {
    const xOffset = x * 4;
    const yOffset = y * 4;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let ky = 0; ky < 4; ky += 1) {
      const weightY = table.yWeights[yOffset + ky];
      const sampleY = table.yIndices[yOffset + ky];
      for (let kx = 0; kx < 4; kx += 1) {
        const weight = weightY * table.xWeights[xOffset + kx];
        const sampleX = table.xIndices[xOffset + kx];
        const offset = (sampleY * width + sampleX) * 3;
        red += linear[offset] * weight;
        green += linear[offset + 1] * weight;
        blue += linear[offset + 2] * weight;
      }
    }
    return rgbToOklab({ r: linearToSrgb(red), g: linearToSrgb(green), b: linearToSrgb(blue) });
  }
  function maskSpans(mask, width, height) {
    const spans = [];
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      const rowMask = mask.subarray(row, row + width);
      let x = 0;
      while (x < width) {
        const start2 = rowMask.indexOf(1, x);
        if (start2 < 0) break;
        x = start2 + 1;
        while (x < width && rowMask[x] !== 0) x += 1;
        spans.push(row, start2, x);
      }
    }
    return Int32Array.from(spans);
  }
  function dilateVertically(source, width, height, radius) {
    const output = new Uint8Array(source.length);
    const counts = new Uint32Array(width);
    const initialEnd = Math.min(radius, height - 1);
    for (let y = 0; y <= initialEnd; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) counts[x] = counts[x] + source[row + x];
    }
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) output[row + x] = counts[x] > 0 ? 1 : 0;
      const remove = y - radius;
      const add = y + radius + 1;
      if (remove >= 0 || add < height) {
        const removeRow = remove * width;
        const addRow = add * width;
        for (let x = 0; x < width; x += 1) {
          if (remove >= 0) counts[x] = counts[x] - source[removeRow + x];
          if (add < height) counts[x] = counts[x] + source[addRow + x];
        }
      }
    }
    return output;
  }
  async function dilateVerticallyAsync(source, width, height, radius, context) {
    const output = new Uint8Array(source.length);
    const counts = new Uint32Array(width);
    const initialEnd = Math.min(radius, height - 1);
    for (let y = 0; y <= initialEnd; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) counts[x] = counts[x] + source[row + x];
      await cooperate(context);
    }
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) output[row + x] = counts[x] > 0 ? 1 : 0;
      const remove = y - radius;
      const add = y + radius + 1;
      if (remove >= 0 || add < height) {
        const removeRow = remove * width;
        const addRow = add * width;
        for (let x = 0; x < width; x += 1) {
          if (remove >= 0) counts[x] = counts[x] - source[removeRow + x];
          if (add < height) counts[x] = counts[x] + source[addRow + x];
        }
      }
      await cooperate(context);
    }
    return output;
  }
  function smoothingScores(labels, width, kCount, kernel, activeLabels, candidateSpans, neededSpans, xSamples, ySamples) {
    const taps = kernel.length;
    const channels = activeLabels.length;
    let neededPixels = 0;
    for (let span = 0; span < neededSpans.length; span += 3) neededPixels += neededSpans[span + 2] - neededSpans[span + 1];
    const horizontalScores = new Float64Array(neededPixels * channels);
    const scoreOffsets = new Int32Array(labels.length);
    const labelSlots = new Int16Array(kCount);
    labelSlots.fill(-1);
    for (let channel = 0; channel < channels; channel += 1) labelSlots[activeLabels[channel]] = channel;
    const horizontal = new Uint16Array(labels.length);
    const vertical = new Uint16Array(labels.length);
    let pixel = 0;
    for (let span = 0; span < neededSpans.length; span += 3) {
      const row = neededSpans[span];
      const start2 = neededSpans[span + 1];
      const end = neededSpans[span + 2];
      for (let x = start2; x < end; x += 1) {
        const index = row + x;
        let mask = 0;
        const xOffset = x * taps;
        const scoreOffset = pixel * channels;
        scoreOffsets[index] = scoreOffset;
        for (let tap = 0; tap < taps; tap += 1) {
          const sourceLabel = labels[row + xSamples[xOffset + tap]];
          if (sourceLabel >= kCount) continue;
          mask |= 1 << sourceLabel;
          const channel = labelSlots[sourceLabel];
          if (channel >= 0) horizontalScores[scoreOffset + channel] = horizontalScores[scoreOffset + channel] + kernel[tap];
        }
        horizontal[index] = mask;
        pixel += 1;
      }
    }
    for (let span = 0; span < candidateSpans.length; span += 3) {
      const row = candidateSpans[span];
      const start2 = candidateSpans[span + 1];
      const end = candidateSpans[span + 2];
      const yOffset = row / width * taps;
      for (let x = start2; x < end; x += 1) {
        const index = row + x;
        let mask = 0;
        for (let tap = 0; tap < taps; tap += 1) mask |= horizontal[ySamples[yOffset + tap] * width + x];
        vertical[index] = mask;
      }
    }
    return { horizontalScores, scoreOffsets, vertical };
  }
  async function smoothingScoresAsync(labels, width, kCount, kernel, activeLabels, candidateSpans, neededSpans, xSamples, ySamples, context) {
    const taps = kernel.length;
    const channels = activeLabels.length;
    let neededPixels = 0;
    for (let span = 0; span < neededSpans.length; span += 3) neededPixels += neededSpans[span + 2] - neededSpans[span + 1];
    const horizontalScores = new Float64Array(neededPixels * channels);
    const scoreOffsets = new Int32Array(labels.length);
    const labelSlots = new Int16Array(kCount);
    labelSlots.fill(-1);
    for (let channel = 0; channel < channels; channel += 1) labelSlots[activeLabels[channel]] = channel;
    const horizontal = new Uint16Array(labels.length);
    const vertical = new Uint16Array(labels.length);
    let pixel = 0;
    for (let span = 0; span < neededSpans.length; span += 3) {
      const row = neededSpans[span];
      const start2 = neededSpans[span + 1];
      const end = neededSpans[span + 2];
      for (let x = start2; x < end; x += 1) {
        const index = row + x;
        let mask = 0;
        const xOffset = x * taps;
        const scoreOffset = pixel * channels;
        scoreOffsets[index] = scoreOffset;
        for (let tap = 0; tap < taps; tap += 1) {
          const sourceLabel = labels[row + xSamples[xOffset + tap]];
          if (sourceLabel >= kCount) continue;
          mask |= 1 << sourceLabel;
          const channel = labelSlots[sourceLabel];
          if (channel >= 0) horizontalScores[scoreOffset + channel] = horizontalScores[scoreOffset + channel] + kernel[tap];
        }
        horizontal[index] = mask;
        pixel += 1;
      }
      await cooperate(context);
    }
    for (let span = 0; span < candidateSpans.length; span += 3) {
      const row = candidateSpans[span];
      const start2 = candidateSpans[span + 1];
      const end = candidateSpans[span + 2];
      const yOffset = row / width * taps;
      for (let x = start2; x < end; x += 1) {
        let mask = 0;
        for (let tap = 0; tap < taps; tap += 1) mask |= horizontal[ySamples[yOffset + tap] * width + x];
        vertical[row + x] = mask;
      }
      await cooperate(context);
    }
    return { horizontalScores, scoreOffsets, vertical };
  }
  function smoothingMasks(labels, width, height, radius, kCount) {
    const length = labels.length;
    const edges = new Uint8Array(length);
    const present = new Uint8Array(kCount);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const index = row + x;
        const label = labels[index];
        if (label < kCount) present[label] = 1;
        if (x + 1 < width && label !== labels[index + 1]) {
          edges[index] = 1;
          edges[index + 1] = 1;
        }
        if (y + 1 < height && label !== labels[index + width]) {
          edges[index] = 1;
          edges[index + width] = 1;
        }
      }
    }
    const horizontal = new Uint8Array(length);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let count = 0;
      for (let x = 0; x <= Math.min(radius, width - 1); x += 1) count += edges[row + x];
      for (let x = 0; x < width; x += 1) {
        horizontal[row + x] = count > 0 ? 1 : 0;
        const remove = x - radius;
        const add = x + radius + 1;
        if (remove >= 0) count -= edges[row + remove];
        if (add < width) count += edges[row + add];
      }
    }
    const candidates = dilateVertically(horizontal, width, height, radius);
    const needed = dilateVertically(candidates, width, height, radius);
    const taps = radius * 2 + 1;
    const activeLabels = [];
    if (kCount > 0) activeLabels.push(0);
    for (let label = 1; label < kCount; label += 1) if (present[label] === 1) activeLabels.push(label);
    const xSamples = new Int32Array(width * taps);
    const ySamples = new Int32Array(height * taps);
    const candidateSpans = maskSpans(candidates, width, height);
    const neededSpans = maskSpans(needed, width, height);
    for (let x = 0; x < width; x += 1) {
      const offset = x * taps;
      for (let tap = 0; tap < taps; tap += 1) xSamples[offset + tap] = reflect101(x + tap - radius, width);
    }
    for (let y = 0; y < height; y += 1) {
      const offset = y * taps;
      for (let tap = 0; tap < taps; tap += 1) ySamples[offset + tap] = reflect101(y + tap - radius, height);
    }
    return { candidates, needed, candidateSpans, neededSpans, xSamples, ySamples, activeLabels };
  }
  async function smoothingMasksAsync(labels, width, height, radius, kCount, context) {
    const length = labels.length;
    const edges = new Uint8Array(length);
    const present = new Uint8Array(kCount);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const index = row + x;
        const label = labels[index];
        if (label < kCount) present[label] = 1;
        if (x + 1 < width && label !== labels[index + 1]) {
          edges[index] = 1;
          edges[index + 1] = 1;
        }
        if (y + 1 < height && label !== labels[index + width]) {
          edges[index] = 1;
          edges[index + width] = 1;
        }
      }
      await cooperate(context);
    }
    const horizontal = new Uint8Array(length);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let count = 0;
      for (let x = 0; x <= Math.min(radius, width - 1); x += 1) count += edges[row + x];
      for (let x = 0; x < width; x += 1) {
        horizontal[row + x] = count > 0 ? 1 : 0;
        const remove = x - radius;
        const add = x + radius + 1;
        if (remove >= 0) count -= edges[row + remove];
        if (add < width) count += edges[row + add];
      }
      await cooperate(context);
    }
    const candidates = await dilateVerticallyAsync(horizontal, width, height, radius, context);
    const needed = await dilateVerticallyAsync(candidates, width, height, radius, context);
    const taps = radius * 2 + 1;
    const activeLabels = [];
    if (kCount > 0) activeLabels.push(0);
    for (let label = 1; label < kCount; label += 1) if (present[label] === 1) activeLabels.push(label);
    const xSamples = new Int32Array(width * taps);
    const ySamples = new Int32Array(height * taps);
    const candidateSpans = maskSpans(candidates, width, height);
    const neededSpans = maskSpans(needed, width, height);
    for (let x = 0; x < width; x += 1) {
      const offset = x * taps;
      for (let tap = 0; tap < taps; tap += 1) xSamples[offset + tap] = reflect101(x + tap - radius, width);
      await cooperate(context);
    }
    for (let y = 0; y < height; y += 1) {
      const offset = y * taps;
      for (let tap = 0; tap < taps; tap += 1) ySamples[offset + tap] = reflect101(y + tap - radius, height);
      await cooperate(context);
    }
    return { candidates, needed, candidateSpans, neededSpans, xSamples, ySamples, activeLabels };
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
  function keys(distance3) {
    const t = Math.abs(distance3);
    if (t <= 1) return (1.25 * t - 2.25) * t * t + 1;
    if (t < 2) return ((-0.75 * t + 3.75) * t - 6) * t + 3;
    return 0;
  }
  function srgbToLinear(channel) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  var SRGB_LINEAR = Float64Array.from({ length: 256 }, (_, channel) => srgbToLinear(channel));
  function writeOklab(lab, offset, red, green, blue) {
    const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    lab[offset] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    lab[offset + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    lab[offset + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  }
  function linearToSrgb(channel) {
    const value = Math.min(1, Math.max(0, channel));
    const encoded = value <= 31308e-7 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  }
  function hex2(red, green, blue) {
    return "#" + [red, green, blue].map((value) => Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0")).join("");
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
  async function planTraceAsync(source, settings, controls, previousStages = null, from = "colors", onProgress, shouldCancel) {
    if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    const decoded = readRgbaPng(source);
    if (decoded === null) return null;
    if (controls === void 0) {
      return planTrace(source, settings, controls, previousStages, from, onProgress);
    }
    if (settings.preset !== "logo" && settings.preset !== "icon") {
      const stages = await buildLabRasterStagesAsync(decoded.rgba, decoded.width, decoded.height, controls, previousStages, from, onProgress, shouldCancel);
      if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
      return planSegmentedWithControls(decoded.rgba, decoded.width, decoded.height, settings, controls, stages);
    }
    onProgress?.("colors", 0);
    const plates = await flatPlatesAsync(
      decoded.rgba,
      decoded.width,
      decoded.height,
      settings.maxColors,
      lossyCleanup(decoded.rgba, decoded.width, decoded.height),
      (fraction) => onProgress?.("colors", fraction * 0.95),
      shouldCancel
    );
    if (shouldCancel?.() === true) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    const plan = planFlat(decoded.rgba, decoded.width, decoded.height, settings, controls, plates);
    onProgress?.("colors", 1);
    onProgress?.("backdrop", 1);
    onProgress?.("punch", 1);
    return plan;
  }
  function vectorStagesForPlan(svgs, plan, controls, onProgress) {
    return vectorStagesFromPlan(svgs, plan.plates, plan.width, plan.height, plan.droppedColor, controls, onProgress);
  }
  function settingsFromControls(controls) {
    return {
      preset: controls.mode,
      maxColors: controls.maxColors,
      smoothness: controls.smoothness,
      corner: controls.corner,
      removeBackground: controls.removeBackground,
      stacking: controls.stacking
    };
  }
  function replanTracePlan(plan, controls) {
    const settings = settingsFromControls(controls);
    if (controls.mode === "logo" || controls.mode === "icon") {
      return {
        ...plan,
        plates: plan.plates.map((plate) => ({
          ...plate,
          request: flatRequestForControls(settings, plate.request.palette ?? [], plate.scale, controls)
        }))
      };
    }
    const stages = plan.rasterStages;
    if (stages === void 0) return plan;
    const palette = cappedPalette(paletteFromRaster2(stages.traceInput, stages.droppedColor), stages.droppedColor);
    const request = { ...traceRequest(controls, palette), removeBackground: settings.removeBackground };
    return { ...plan, plates: plan.plates.map((plate) => ({ ...plate, request })) };
  }
  function planFlat(rgba, width, height, settings, controls, preparedPlates, onProgress) {
    const flat = preparedPlates ?? flatPlates(rgba, width, height, settings.maxColors, lossyCleanup(rgba, width, height), onProgress);
    const plates = flat.map((plate) => ({
      png: encodeRgbaPng(plate.width, plate.height, settings.removeBackground ? punchBorderBackdrop(plate.rgba, plate.width, plate.height, plate.borderColor, plate.scale) : plate.rgba),
      scale: plate.scale,
      originX: plate.originX,
      originY: plate.originY,
      borderColor: plate.borderColor,
      cutOut: plate.cutOut,
      source: { rgba, width, height },
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
    const palette = decoded === null ? [] : cappedPalette(paletteFromRaster2(decoded.rgba, punched.droppedColor), punched.droppedColor);
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
    const palette = cappedPalette(paletteFromRaster2(stages.traceInput, stages.droppedColor), stages.droppedColor);
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

  // src/placement-svg.ts
  var SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  var XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
  var MAX_PLACEMENT_NUMBER = 1e12;
  var PATH_COMMANDS = "MmLlHhVvCcSsQqTtAaZz";
  var CURVE_KAPPA = 0.5522847498307936;
  function validEntities(value) {
    const entityPattern = /&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos);/gi;
    let remainder = value;
    let match = entityPattern.exec(value);
    while (match !== null) {
      const entity = match[1] ?? "";
      if (entity.startsWith("#")) {
        const isHex = entity[1]?.toLowerCase() === "x";
        const digits = entity.slice(isHex ? 2 : 1);
        const point2 = Number.parseInt(digits, isHex ? 16 : 10);
        const validPoint = point2 === 9 || point2 === 10 || point2 === 13 || point2 >= 32 && point2 <= 55295 || point2 >= 57344 && point2 <= 65533 || point2 >= 65536 && point2 <= 1114111;
        if (!Number.isFinite(point2) || !validPoint) return false;
      }
      remainder = remainder.replace(match[0], "");
      match = entityPattern.exec(value);
    }
    return !remainder.includes("&");
  }
  function parseAttributes(source) {
    const attributes = /* @__PURE__ */ new Map();
    let cursor = 0;
    while (cursor < source.length) {
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      if (cursor >= source.length) break;
      const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(cursor));
      if (nameMatch === null) return null;
      const name = nameMatch[0];
      if (attributes.has(name)) return null;
      cursor += name.length;
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      if (source[cursor] !== "=") return null;
      cursor += 1;
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      const quote = source[cursor];
      if (quote !== '"' && quote !== "'") return null;
      cursor += 1;
      const end = source.indexOf(quote, cursor);
      if (end < 0) return null;
      const value = source.slice(cursor, end);
      if (value.includes("<") || !validEntities(value)) return null;
      attributes.set(name, value);
      cursor = end + 1;
    }
    return attributes;
  }
  function parseTag(source, start2) {
    let end = start2 + 1;
    let quote = null;
    while (end < source.length) {
      const character = source[end];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      end += 1;
    }
    if (end >= source.length || quote !== null) return null;
    let body = source.slice(start2 + 1, end).trim();
    if (body.startsWith("/")) {
      const name2 = body.slice(1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name2)) return null;
      return { tag: { kind: "close", name: name2 }, end: end + 1 };
    }
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(body);
    if (nameMatch === null) return null;
    const name = nameMatch[0];
    body = body.slice(name.length);
    const trimmed = body.trimEnd();
    const selfClosing = trimmed.endsWith("/");
    if (selfClosing) body = trimmed.slice(0, -1);
    const attributes = parseAttributes(body);
    if (attributes === null) return null;
    return { tag: { kind: "open", name, attributes, selfClosing }, end: end + 1 };
  }
  function skipWhitespaceAndComments(source, start2) {
    let cursor = start2;
    while (cursor < source.length) {
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      if (!source.startsWith("<!--", cursor)) return cursor;
      const end = source.indexOf("-->", cursor + 4);
      if (end < 0 || source.slice(cursor + 4, end).includes("--")) return null;
      cursor = end + 3;
    }
    return cursor;
  }
  function parseSimpleSvg(source, allowUntransformedGroups = true) {
    let cursor = source.charCodeAt(0) === 65279 ? 1 : 0;
    cursor = skipWhitespaceAndComments(source, cursor) ?? -1;
    if (cursor < 0) return null;
    if (source.startsWith("<?xml", cursor)) {
      const declarationEnd = source.indexOf("?>", cursor + 5);
      if (declarationEnd < 0) return null;
      const declaration = source.slice(cursor, declarationEnd + 2);
      const encoding = /\bencoding\s*=\s*(['"])(.*?)\1/i.exec(declaration)?.[2];
      if (encoding !== void 0 && encoding.toLowerCase() !== "utf-8") return null;
      cursor = skipWhitespaceAndComments(source, declarationEnd + 2) ?? -1;
      if (cursor < 0) return null;
    }
    if (source[cursor] !== "<") return null;
    const root = parseTag(source, cursor);
    if (root === null || root.tag.kind !== "open" || root.tag.name !== "svg" || root.tag.selfClosing) return null;
    const children = [];
    const groups = [];
    cursor = root.end;
    while (cursor < source.length) {
      cursor = skipWhitespaceAndComments(source, cursor) ?? -1;
      if (cursor < 0 || cursor >= source.length) return null;
      if (source[cursor] !== "<") return null;
      const parsed = parseTag(source, cursor);
      if (parsed === null) return null;
      if (parsed.tag.kind === "close") {
        if (parsed.tag.name === "g") {
          if (groups.length === 0) return null;
          groups.pop();
          cursor = parsed.end;
          continue;
        }
        if (parsed.tag.name !== "svg") return null;
        if (groups.length !== 0) return null;
        cursor = parsed.end;
        cursor = skipWhitespaceAndComments(source, cursor) ?? -1;
        if (cursor !== source.length) return null;
        return { rootAttributes: root.tag.attributes, children };
      }
      if (parsed.tag.name === "g") {
        if (!allowUntransformedGroups) return null;
        if (!hasOnlyAttributes(parsed.tag.attributes, ["id"])) return null;
        if (!parsed.tag.selfClosing) groups.push("g");
        cursor = parsed.end;
        continue;
      }
      if (!parsed.tag.selfClosing && parsed.tag.name !== "path") return null;
      if (parsed.tag.name !== "path" && parsed.tag.name !== "rect" && parsed.tag.name !== "circle" && parsed.tag.name !== "ellipse") return null;
      cursor = parsed.end;
      if (!parsed.tag.selfClosing) {
        cursor = skipWhitespaceAndComments(source, cursor) ?? -1;
        if (cursor < 0 || source[cursor] !== "<") return null;
        const closing = parseTag(source, cursor);
        if (closing === null || closing.tag.kind !== "close" || closing.tag.name !== "path") return null;
        cursor = closing.end;
      }
      children.push({ name: parsed.tag.name, attributes: parsed.tag.attributes });
    }
    return null;
  }
  function finiteNumber(value) {
    if (value === void 0 || value.trim() === "") return null;
    const trimmed = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
    const number = Number(trimmed);
    return Number.isFinite(number) && Math.abs(number) <= MAX_PLACEMENT_NUMBER ? number : null;
  }
  function formatNumber(value) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_PLACEMENT_NUMBER) throw new Error("SVG contains an out-of-range number");
    const rounded = Math.round(value * 1e3) / 1e3;
    if (Object.is(rounded, -0) || rounded === 0) return "0";
    return rounded.toFixed(3).replace(/\.?0+$/, "");
  }
  function pathTokens(source) {
    const tokens = [];
    let cursor = 0;
    while (cursor < source.length) {
      if (/[\s,]/.test(source[cursor] ?? "")) {
        cursor += 1;
        continue;
      }
      const character = source[cursor] ?? "";
      if (PATH_COMMANDS.includes(character)) {
        tokens.push({ kind: "command", value: character });
        cursor += 1;
        continue;
      }
      const numberMatch = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/.exec(source.slice(cursor));
      if (numberMatch === null) return null;
      const value = Number(numberMatch[0]);
      if (!Number.isFinite(value) || Math.abs(value) > MAX_PLACEMENT_NUMBER) return null;
      tokens.push({ kind: "number", value });
      cursor += numberMatch[0].length;
    }
    return tokens;
  }
  function point(x, y) {
    return { x, y };
  }
  function reflected(control, around) {
    return point(2 * around.x - control.x, 2 * around.y - control.y);
  }
  function appendCubic(parts, curve) {
    parts.push("C" + formatNumber(curve.control1.x) + " " + formatNumber(curve.control1.y) + " " + formatNumber(curve.control2.x) + " " + formatNumber(curve.control2.y) + " " + formatNumber(curve.end.x) + " " + formatNumber(curve.end.y));
  }
  function vectorAngle(ux, uy, vx, vy) {
    const dot = ux * vx + uy * vy;
    const length = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    const angle = Math.acos(Math.max(-1, Math.min(1, dot / length)));
    return ux * vy - uy * vx < 0 ? -angle : angle;
  }
  function arcToCubics(start2, rxValue, ryValue, rotationDegrees, largeArc, sweep, end) {
    let rx = Math.abs(rxValue);
    let ry = Math.abs(ryValue);
    if (largeArc !== 0 && largeArc !== 1 || sweep !== 0 && sweep !== 1) return null;
    if (start2.x === end.x && start2.y === end.y) return [];
    if (rx === 0 || ry === 0) return [{ control1: end, control2: end, end }];
    const phi = rotationDegrees % 360 * Math.PI / 180;
    const cosine = Math.cos(phi);
    const sine = Math.sin(phi);
    const halfX = (start2.x - end.x) / 2;
    const halfY = (start2.y - end.y) / 2;
    const xPrime = cosine * halfX + sine * halfY;
    const yPrime = -sine * halfX + cosine * halfY;
    const lambda = xPrime * xPrime / (rx * rx) + yPrime * yPrime / (ry * ry);
    if (lambda > 1) {
      const scale = Math.sqrt(lambda);
      rx *= scale;
      ry *= scale;
    }
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    const x2 = xPrime * xPrime;
    const y2 = yPrime * yPrime;
    const denominator = rx2 * y2 + ry2 * x2;
    const numerator = Math.max(0, rx2 * ry2 - rx2 * y2 - ry2 * x2);
    const sign = largeArc === sweep ? -1 : 1;
    const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
    const centerPrimeX = coefficient * rx * yPrime / ry;
    const centerPrimeY = coefficient * -ry * xPrime / rx;
    const centerX = cosine * centerPrimeX - sine * centerPrimeY + (start2.x + end.x) / 2;
    const centerY = sine * centerPrimeX + cosine * centerPrimeY + (start2.y + end.y) / 2;
    const ux = (xPrime - centerPrimeX) / rx;
    const uy = (yPrime - centerPrimeY) / ry;
    const vx = (-xPrime - centerPrimeX) / rx;
    const vy = (-yPrime - centerPrimeY) / ry;
    const theta = vectorAngle(1, 0, ux, uy);
    let delta = vectorAngle(ux, uy, vx, vy);
    if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
    if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
    const count = Math.ceil(Math.abs(delta) / (Math.PI / 2));
    const transform = (x, y) => point(centerX + cosine * x - sine * y, centerY + sine * x + cosine * y);
    const derivative = (angle) => point(-rx * Math.sin(angle), ry * Math.cos(angle));
    const curves = [];
    for (let index = 0; index < count; index += 1) {
      const angle1 = theta + delta * index / count;
      const angle2 = theta + delta * (index + 1) / count;
      const step = angle2 - angle1;
      const factor = 4 / 3 * Math.tan(step / 4);
      const p1 = transform(rx * Math.cos(angle1), ry * Math.sin(angle1));
      const p2 = transform(rx * Math.cos(angle2), ry * Math.sin(angle2));
      const d1 = derivative(angle1);
      const d2 = derivative(angle2);
      curves.push({
        control1: transform(rx * Math.cos(angle1) + factor * d1.x, ry * Math.sin(angle1) + factor * d1.y),
        control2: transform(rx * Math.cos(angle2) - factor * d2.x, ry * Math.sin(angle2) - factor * d2.y),
        end: p2
      });
    }
    if (curves.length > 0) {
      const last = curves[curves.length - 1];
      if (last !== void 0) curves[curves.length - 1] = { control1: last.control1, control2: last.control2, end };
    }
    return curves;
  }
  function normalizePathData(source) {
    const tokens = pathTokens(source);
    if (tokens === null || tokens.length === 0) return null;
    const parts = [];
    let cursor = 0;
    let activeCommand = null;
    let current = point(0, 0);
    let subpathStart = point(0, 0);
    let previousCommand = "";
    let previousCubicControl = current;
    let previousQuadraticControl = current;
    let hasMove = false;
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token?.kind === "command") {
        activeCommand = token.value;
        cursor += 1;
        if (activeCommand.toUpperCase() === "Z") {
          if (!hasMove) return null;
          parts.push("Z");
          current = subpathStart;
          previousCommand = "Z";
          activeCommand = null;
        }
        continue;
      }
      if (activeCommand === null) return null;
      const inputCommand = activeCommand;
      const command = inputCommand.toUpperCase();
      const relative = inputCommand !== command;
      const count = command === "H" || command === "V" ? 1 : command === "M" || command === "L" || command === "T" ? 2 : command === "S" || command === "Q" ? 4 : command === "C" ? 6 : command === "A" ? 7 : 0;
      if (count === 0 || cursor + count > tokens.length) return null;
      const values = [];
      for (let index = 0; index < count; index += 1) {
        const value = tokens[cursor + index];
        if (value?.kind !== "number") return null;
        values.push(value.value);
      }
      cursor += count;
      const x = (value) => relative ? current.x + value : value;
      const y = (value) => relative ? current.y + value : value;
      if (command === "M") {
        current = point(x(values[0] ?? 0), y(values[1] ?? 0));
        subpathStart = current;
        parts.push("M" + formatNumber(current.x) + " " + formatNumber(current.y));
        hasMove = true;
        activeCommand = relative ? "l" : "L";
        previousCommand = "M";
        previousCubicControl = current;
        previousQuadraticControl = current;
        continue;
      }
      if (!hasMove) return null;
      if (command === "L" || command === "H" || command === "V") {
        const end = command === "H" ? point(x(values[0] ?? 0), current.y) : command === "V" ? point(current.x, y(values[0] ?? 0)) : point(x(values[0] ?? 0), y(values[1] ?? 0));
        parts.push("L" + formatNumber(end.x) + " " + formatNumber(end.y));
        current = end;
        previousCommand = command;
        previousCubicControl = current;
        previousQuadraticControl = current;
        continue;
      }
      if (command === "C") {
        const control1 = point(x(values[0] ?? 0), y(values[1] ?? 0));
        const control2 = point(x(values[2] ?? 0), y(values[3] ?? 0));
        const end = point(x(values[4] ?? 0), y(values[5] ?? 0));
        appendCubic(parts, { control1, control2, end });
        current = end;
        previousCubicControl = control2;
        previousQuadraticControl = current;
        previousCommand = "C";
        continue;
      }
      if (command === "S") {
        const control1 = previousCommand === "C" || previousCommand === "S" ? reflected(previousCubicControl, current) : current;
        const control2 = point(x(values[0] ?? 0), y(values[1] ?? 0));
        const end = point(x(values[2] ?? 0), y(values[3] ?? 0));
        appendCubic(parts, { control1, control2, end });
        current = end;
        previousCubicControl = control2;
        previousQuadraticControl = current;
        previousCommand = "S";
        continue;
      }
      if (command === "Q" || command === "T") {
        const control = command === "Q" ? point(x(values[0] ?? 0), y(values[1] ?? 0)) : previousCommand === "Q" || previousCommand === "T" ? reflected(previousQuadraticControl, current) : current;
        const end = command === "Q" ? point(x(values[2] ?? 0), y(values[3] ?? 0)) : point(x(values[0] ?? 0), y(values[1] ?? 0));
        appendCubic(parts, {
          control1: point(current.x + (control.x - current.x) * 2 / 3, current.y + (control.y - current.y) * 2 / 3),
          control2: point(end.x + (control.x - end.x) * 2 / 3, end.y + (control.y - end.y) * 2 / 3),
          end
        });
        current = end;
        previousQuadraticControl = control;
        previousCubicControl = current;
        previousCommand = command;
        continue;
      }
      if (command === "A") {
        const end = point(x(values[5] ?? 0), y(values[6] ?? 0));
        const curves = arcToCubics(current, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0, values[4] ?? 0, end);
        if (curves === null) return null;
        if (curves.length === 0) {
          current = end;
        } else if (values[0] === 0 || values[1] === 0) {
          parts.push("L" + formatNumber(end.x) + " " + formatNumber(end.y));
          current = end;
        } else {
          for (const curve of curves) appendCubic(parts, curve);
          current = end;
        }
        previousCubicControl = current;
        previousQuadraticControl = current;
        previousCommand = "A";
        continue;
      }
      return null;
    }
    return parts.length === 0 ? null : parts.join(" ");
  }
  function numberAttribute(attributes, name, fallback) {
    const raw = attributes.get(name);
    if (raw === void 0 && fallback !== void 0) return fallback;
    const value = finiteNumber(raw);
    if (value === null) throw new Error("SVG contains an invalid " + name + " value");
    return value;
  }
  function rectPath(attributes) {
    const x = numberAttribute(attributes, "x", 0);
    const y = numberAttribute(attributes, "y", 0);
    const width = numberAttribute(attributes, "width");
    const height = numberAttribute(attributes, "height");
    if (width <= 0 || height <= 0) throw new Error("SVG rectangle must have positive dimensions");
    const radiusX = Math.max(0, Math.min(numberAttribute(attributes, "rx", numberAttribute(attributes, "ry", 0)), width / 2));
    const radiusY = Math.max(0, Math.min(numberAttribute(attributes, "ry", radiusX), height / 2));
    if (radiusX === 0 || radiusY === 0) {
      return "M" + formatNumber(x) + " " + formatNumber(y) + " L" + formatNumber(x + width) + " " + formatNumber(y) + " L" + formatNumber(x + width) + " " + formatNumber(y + height) + " L" + formatNumber(x) + " " + formatNumber(y + height) + " Z";
    }
    const right = x + width;
    const bottom = y + height;
    const kx = CURVE_KAPPA * radiusX;
    const ky = CURVE_KAPPA * radiusY;
    return [
      "M" + formatNumber(x + radiusX) + " " + formatNumber(y),
      "L" + formatNumber(right - radiusX) + " " + formatNumber(y),
      "C" + formatNumber(right - radiusX + kx) + " " + formatNumber(y) + " " + formatNumber(right) + " " + formatNumber(y + radiusY - ky) + " " + formatNumber(right) + " " + formatNumber(y + radiusY),
      "L" + formatNumber(right) + " " + formatNumber(bottom - radiusY),
      "C" + formatNumber(right) + " " + formatNumber(bottom - radiusY + ky) + " " + formatNumber(right - radiusX + kx) + " " + formatNumber(bottom) + " " + formatNumber(right - radiusX) + " " + formatNumber(bottom),
      "L" + formatNumber(x + radiusX) + " " + formatNumber(bottom),
      "C" + formatNumber(x + radiusX - kx) + " " + formatNumber(bottom) + " " + formatNumber(x) + " " + formatNumber(bottom - radiusY + ky) + " " + formatNumber(x) + " " + formatNumber(bottom - radiusY),
      "L" + formatNumber(x) + " " + formatNumber(y + radiusY),
      "C" + formatNumber(x) + " " + formatNumber(y + radiusY - ky) + " " + formatNumber(x + radiusX - kx) + " " + formatNumber(y) + " " + formatNumber(x + radiusX) + " " + formatNumber(y),
      "Z"
    ].join(" ");
  }
  function ellipsePath2(cx, cy, rx, ry) {
    if (rx <= 0 || ry <= 0) throw new Error("SVG ellipse must have positive radii");
    const kx = CURVE_KAPPA * rx;
    const ky = CURVE_KAPPA * ry;
    return [
      "M" + formatNumber(cx + rx) + " " + formatNumber(cy),
      "C" + formatNumber(cx + rx) + " " + formatNumber(cy + ky) + " " + formatNumber(cx + kx) + " " + formatNumber(cy + ry) + " " + formatNumber(cx) + " " + formatNumber(cy + ry),
      "C" + formatNumber(cx - kx) + " " + formatNumber(cy + ry) + " " + formatNumber(cx - rx) + " " + formatNumber(cy + ky) + " " + formatNumber(cx - rx) + " " + formatNumber(cy),
      "C" + formatNumber(cx - rx) + " " + formatNumber(cy - ky) + " " + formatNumber(cx - kx) + " " + formatNumber(cy - ry) + " " + formatNumber(cx) + " " + formatNumber(cy - ry),
      "C" + formatNumber(cx + kx) + " " + formatNumber(cy - ry) + " " + formatNumber(cx + rx) + " " + formatNumber(cy - ky) + " " + formatNumber(cx + rx) + " " + formatNumber(cy),
      "Z"
    ].join(" ");
  }
  function paintAttributes(attributes) {
    const result = /* @__PURE__ */ new Map();
    const style = /* @__PURE__ */ new Map();
    for (const declaration of (attributes.get("style") ?? "").split(";")) {
      const separator = declaration.indexOf(":");
      if (separator <= 0) continue;
      style.set(declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim());
    }
    for (const name of ["fill", "stroke", "stroke-width", "stroke-linejoin"]) {
      const value = attributes.get(name) ?? style.get(name);
      if (value === void 0 || value === "") continue;
      if (name === "fill" || name === "stroke") {
        if (!/^(?:none|#[\da-f]{3,8}|[a-z]+)$/i.test(value)) throw new Error("SVG contains an unsupported paint value");
        result.set(name, value);
      } else if (name === "stroke-width") {
        const width = finiteNumber(value);
        if (width === null || width < 0) throw new Error("SVG contains an invalid stroke width");
        result.set(name, formatNumber(width));
      } else {
        if (value !== "miter" && value !== "round" && value !== "bevel") throw new Error("SVG contains an unsupported stroke join");
        result.set(name, value);
      }
    }
    return result;
  }
  function escapeAttribute(value) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }
  function serializePathElement(data, paints) {
    const attributes = ['d="' + escapeAttribute(data) + '"'];
    for (const name of ["fill", "stroke", "stroke-width", "stroke-linejoin"]) {
      const value = paints.get(name);
      if (value !== void 0) attributes.push(name + '="' + escapeAttribute(value) + '"');
    }
    return "<path " + attributes.join(" ") + "/>";
  }
  function serializeShape(element) {
    const paints = paintAttributes(element.attributes);
    let data;
    if (element.name === "path") {
      const source = element.attributes.get("d");
      data = source === void 0 ? null : normalizePathData(source);
    } else if (element.name === "rect") {
      data = rectPath(element.attributes);
    } else if (element.name === "circle") {
      data = ellipsePath2(numberAttribute(element.attributes, "cx", 0), numberAttribute(element.attributes, "cy", 0), numberAttribute(element.attributes, "r"), numberAttribute(element.attributes, "r"));
    } else {
      data = ellipsePath2(numberAttribute(element.attributes, "cx", 0), numberAttribute(element.attributes, "cy", 0), numberAttribute(element.attributes, "rx"), numberAttribute(element.attributes, "ry"));
    }
    if (data === null) throw new Error("SVG contains unsupported path data");
    return serializePathElement(data, paints);
  }
  function parseViewBox(value) {
    if (value === void 0) return null;
    const pieces = value.trim().split(/[\s,]+/);
    if (pieces.length !== 4) return null;
    const values = pieces.map((piece) => finiteNumber(piece));
    if (values.some((number) => number === null)) return null;
    const left = values[0];
    const top = values[1];
    const width = values[2];
    const height = values[3];
    if (left === void 0 || top === void 0 || width === void 0 || height === void 0 || left === null || top === null || width === null || height === null || width <= 0 || height <= 0) return null;
    return [left, top, width, height];
  }
  function formatFrame(viewBox) {
    const [x, y, width, height] = viewBox;
    return '<rect id="vp-frame" x="' + formatNumber(x) + '" y="' + formatNumber(y) + '" width="' + formatNumber(width) + '" height="' + formatNumber(height) + '" fill="none" stroke="none"/>';
  }
  function serializeSvgForIllustrator(svgText) {
    const source = svgText.charCodeAt(0) === 65279 ? svgText.slice(1) : svgText;
    const parsed = parseSimpleSvg(source);
    if (parsed === null) throw new Error("Cannot prepare malformed or unsupported SVG for Illustrator");
    if (parsed.rootAttributes.get("xmlns") !== SVG_NAMESPACE) throw new Error("SVG is missing its namespace");
    const viewBox = parseViewBox(parsed.rootAttributes.get("viewBox"));
    if (viewBox === null) throw new Error("SVG is missing a finite, positive viewBox");
    const width = finiteNumber(parsed.rootAttributes.get("width"));
    const height = finiteNumber(parsed.rootAttributes.get("height"));
    if (width === null || height === null || width <= 0 || height <= 0) throw new Error("SVG is missing explicit positive dimensions");
    const [x, y, viewWidth, viewHeight] = viewBox;
    const frame = formatFrame(viewBox);
    const body = parsed.children.map(serializeShape).join("");
    return XML_DECLARATION + '\n<svg xmlns="' + SVG_NAMESPACE + '" width="' + formatNumber(viewWidth) + '" height="' + formatNumber(viewHeight) + '" viewBox="' + [x, y, viewWidth, viewHeight].map(formatNumber).join(" ") + '">' + frame + body + "</svg>";
  }
  function hasOnlyAttributes(attributes, allowed) {
    for (const name of attributes.keys()) if (!allowed.includes(name)) return false;
    return true;
  }
  function isCanonicalNumber(value, parsed) {
    return value !== void 0 && parsed !== null && formatNumber(parsed) === value;
  }
  function isCanonicalPathData(data) {
    const normalized = normalizePathData(data);
    return normalized !== null && normalized === data;
  }
  function validateSvgForPlacement(svgText, expectedSvgText) {
    if (svgText.trim() === "") return { kind: "invalid", reason: "empty" };
    if (svgText.charCodeAt(0) === 65279) return { kind: "invalid", reason: "bom" };
    if (!svgText.startsWith(XML_DECLARATION + "\n")) {
      if (/\bencoding\s*=\s*(['"])(.*?)\1/i.test(svgText) && !/\bencoding\s*=\s*(['"])utf-8\1/i.test(svgText)) return { kind: "invalid", reason: "encoding" };
      return { kind: "invalid", reason: "malformed-xml" };
    }
    if (/\b(?:NaN|Infinity)\b/i.test(svgText)) return { kind: "invalid", reason: "non-finite" };
    const document2 = parseSimpleSvg(svgText, false);
    if (document2 === null) return { kind: "invalid", reason: "malformed-xml" };
    if (document2.rootAttributes.get("xmlns") !== SVG_NAMESPACE) return { kind: "invalid", reason: "missing-namespace" };
    if (!hasOnlyAttributes(document2.rootAttributes, ["xmlns", "width", "height", "viewBox"])) return { kind: "invalid", reason: "unsafe-content" };
    const width = finiteNumber(document2.rootAttributes.get("width"));
    const height = finiteNumber(document2.rootAttributes.get("height"));
    const viewBox = parseViewBox(document2.rootAttributes.get("viewBox"));
    if (width === null || height === null || width <= 0 || height <= 0 || viewBox === null) return { kind: "invalid", reason: "invalid-dimensions" };
    const expectedViewBox = viewBox.map(formatNumber).join(" ");
    if (!isCanonicalNumber(document2.rootAttributes.get("width"), width) || !isCanonicalNumber(document2.rootAttributes.get("height"), height) || document2.rootAttributes.get("viewBox") !== expectedViewBox || width !== viewBox[2] || height !== viewBox[3]) return { kind: "invalid", reason: "invalid-dimensions" };
    if (document2.children.length < 2) return { kind: "invalid", reason: "unsafe-content" };
    const frame = document2.children[0];
    if (frame === void 0 || frame.name !== "rect" || !hasOnlyAttributes(frame.attributes, ["id", "x", "y", "width", "height", "fill", "stroke"])) return { kind: "invalid", reason: "unsafe-content" };
    const frameX = finiteNumber(frame.attributes.get("x"));
    const frameY = finiteNumber(frame.attributes.get("y"));
    const frameWidth = finiteNumber(frame.attributes.get("width"));
    const frameHeight = finiteNumber(frame.attributes.get("height"));
    if (!isCanonicalNumber(frame.attributes.get("x"), frameX) || !isCanonicalNumber(frame.attributes.get("y"), frameY) || !isCanonicalNumber(frame.attributes.get("width"), frameWidth) || !isCanonicalNumber(frame.attributes.get("height"), frameHeight)) return { kind: "invalid", reason: "unsafe-content" };
    if (frame.attributes.get("id") !== "vp-frame" || frame.attributes.get("fill") !== "none" || frame.attributes.get("stroke") !== "none" || frameX !== viewBox[0] || frameY !== viewBox[1] || frameWidth !== viewBox[2] || frameHeight !== viewBox[3]) return { kind: "invalid", reason: "unsafe-content" };
    for (const element of document2.children.slice(1)) {
      if (element.name !== "path" || !hasOnlyAttributes(element.attributes, ["d", "fill", "stroke", "stroke-width", "stroke-linejoin"])) return { kind: "invalid", reason: "unsafe-content" };
      const data = element.attributes.get("d");
      if (data === void 0 || !isCanonicalPathData(data)) return { kind: "invalid", reason: "path-commands" };
      const strokeWidth = element.attributes.get("stroke-width");
      if (strokeWidth !== void 0 && !isCanonicalNumber(strokeWidth, finiteNumber(strokeWidth))) return { kind: "invalid", reason: "unsafe-content" };
      try {
        paintAttributes(element.attributes);
      } catch {
        return { kind: "invalid", reason: "unsafe-content" };
      }
    }
    if (expectedSvgText !== void 0 && svgText !== serializeSvgForIllustrator(expectedSvgText)) return { kind: "invalid", reason: "stale-content" };
    return { kind: "valid" };
  }

  // src/result-svg-file.ts
  function writeResultSvgAtomically(svgPath, jobId, svgText, fileSystem) {
    const temporaryPath = svgPath + "." + jobId + ".tmp";
    try {
      fileSystem.writeFileSync(temporaryPath, serializeSvgForIllustrator(svgText), { encoding: "utf8", flag: "wx" });
      fileSystem.renameSync(temporaryPath, svgPath);
    } catch (error) {
      try {
        fileSystem.rmSync(temporaryPath, { force: true });
      } catch (_) {
      }
      throw error;
    }
  }

  // src/step-selection.ts
  function initialActiveStep() {
    return "colors";
  }
  function reduceActiveStep(current, event) {
    switch (event.kind) {
      case "tab-selected":
        return event.step;
      case "preset-selected":
        return "colors";
      case "progress":
      case "rerun-started":
      case "rerun-completed":
        return current;
      default: {
        const exhaustive = event;
        return exhaustive;
      }
    }
  }
  function isLabStep(value) {
    return LAB_STEPS.some((step) => step === value);
  }

  // src/thumbnail-state.ts
  function initialThumbnailState() {
    return { kind: "empty", generation: 0 };
  }
  function isCurrentThumbnailCapture(state, generation) {
    return state.kind === "loading" && state.generation === generation;
  }
  function reduceThumbnailState(state, event) {
    switch (event.kind) {
      case "capture-started":
        return event.generation > state.generation ? { kind: "loading", generation: event.generation } : state;
      case "capture-completed":
        return isCurrentThumbnailCapture(state, event.generation) ? { kind: "ready", generation: event.generation, dataUrl: event.dataUrl } : state;
      case "capture-failed":
        return isCurrentThumbnailCapture(state, event.generation) ? { kind: "empty", generation: event.generation } : state;
      default: {
        const exhaustive = event;
        return exhaustive;
      }
    }
  }

  // src/crop-geometry.ts
  var CROP_SUGGEST_PIXELS = 3145728;
  function estimateRgbaBytes(size) {
    assertRasterSize(size);
    const bytes = size.width * size.height * 4;
    if (!Number.isSafeInteger(bytes)) throw new RangeError("RGBA byte size exceeds safe integer range");
    return bytes;
  }
  function requiresCropChoice(size) {
    assertRasterSize(size);
    return size.width * size.height > CROP_SUGGEST_PIXELS;
  }
  function formatRasterMegapixels(size) {
    assertRasterSize(size);
    const megapixels = size.width * size.height / 1e6;
    return megapixels > 0 && megapixels < 0.1 ? "<0.1" : megapixels.toFixed(1);
  }
  function thumbnailPointToSourcePixels(point2, thumbnailSize, sourceSize) {
    assertRasterSize(thumbnailSize);
    assertRasterSize(sourceSize);
    return {
      x: clamp(point2.x / thumbnailSize.width * sourceSize.width, 0, sourceSize.width),
      y: clamp(point2.y / thumbnailSize.height * sourceSize.height, 0, sourceSize.height)
    };
  }
  function clampCropRect(rect, sourceSize) {
    assertRasterSize(sourceSize);
    const rawRight = rect.x + rect.width;
    const rawBottom = rect.y + rect.height;
    const left = clamp(Math.floor(Math.min(rect.x, rawRight)), 0, sourceSize.width - 1);
    const top = clamp(Math.floor(Math.min(rect.y, rawBottom)), 0, sourceSize.height - 1);
    const right = clamp(Math.ceil(Math.max(rect.x, rawRight)), left + 1, sourceSize.width);
    const bottom = clamp(Math.ceil(Math.max(rect.y, rawBottom)), top + 1, sourceSize.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  function moveCropRect(rect, dx, dy, sourceSize) {
    assertRasterSize(sourceSize);
    const width = Math.min(Math.max(1, Math.round(rect.width)), sourceSize.width);
    const height = Math.min(Math.max(1, Math.round(rect.height)), sourceSize.height);
    const x = clamp(Math.round(rect.x + dx), 0, sourceSize.width - width);
    const y = clamp(Math.round(rect.y + dy), 0, sourceSize.height - height);
    return { x, y, width, height };
  }
  function cropRectToArtboardBounds(sourceBounds, sourceSize, cropRect) {
    assertRasterSize(sourceSize);
    const rect = clampCropRect(cropRect, sourceSize);
    const [left, top, right, bottom] = sourceBounds;
    const pointsPerPixelX = (right - left) / sourceSize.width;
    const pointsPerPixelY = (top - bottom) / sourceSize.height;
    return [
      left + rect.x * pointsPerPixelX,
      top - rect.y * pointsPerPixelY,
      left + (rect.x + rect.width) * pointsPerPixelX,
      top - (rect.y + rect.height) * pointsPerPixelY
    ];
  }
  function cropRgba(rgba, sourceSize, cropRect) {
    assertRasterSize(sourceSize);
    if (rgba.length !== estimateRgbaBytes(sourceSize)) throw new RangeError("RGBA data does not match raster size");
    const rect = clampCropRect(cropRect, sourceSize);
    const cropped = new Uint8Array(rect.width * rect.height * 4);
    for (let y = 0; y < rect.height; y += 1) {
      const sourceStart = ((rect.y + y) * sourceSize.width + rect.x) * 4;
      const targetStart = y * rect.width * 4;
      cropped.set(rgba.subarray(sourceStart, sourceStart + rect.width * 4), targetStart);
    }
    return cropped;
  }
  function assertRasterSize(size) {
    if (!Number.isSafeInteger(size.width) || size.width < 1 || !Number.isSafeInteger(size.height) || size.height < 1) {
      throw new RangeError("Raster dimensions must be positive safe integers");
    }
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  // src/panel.ts
  var HostTimeoutError = class extends Error {
    constructor() {
      super("Illustrator \u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E20\u0E32\u0E22\u0E43\u0E19\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E01\u0E33\u0E2B\u0E19\u0E14");
    }
  };
  var PLAN_TIMEOUT_MS = 18e4;
  var PROGRESS_LABELS = {
    capture: "\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E",
    colors: "\u0E41\u0E22\u0E01\u0E2A\u0E35",
    backdrop: "\u0E25\u0E1A\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07",
    punch: "\u0E40\u0E08\u0E32\u0E30\u0E0A\u0E48\u0E2D\u0E07",
    trace: "\u0E41\u0E1B\u0E25\u0E07\u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C (VTracer)",
    fit: "\u0E1B\u0E23\u0E31\u0E1A\u0E40\u0E2A\u0E49\u0E19",
    fair: "\u0E40\u0E01\u0E25\u0E35\u0E48\u0E22\u0E40\u0E2A\u0E49\u0E19",
    seal: "\u0E1B\u0E34\u0E14\u0E23\u0E2D\u0E22\u0E15\u0E48\u0E2D"
  };
  var workerConstructor;
  function loadWorkerConstructor() {
    if (workerConstructor !== void 0) return workerConstructor;
    try {
      const module = __require("worker_threads");
      workerConstructor = typeof module.Worker === "function" ? module.Worker : null;
    } catch {
      workerConstructor = null;
    }
    return workerConstructor;
  }
  function parsePlanWorkerMessage(value) {
    if (!isRecord(value)) return null;
    if (value.kind === "error" && typeof value.error === "string") return { kind: "error", error: value.error };
    if (value.kind === "progress" && isRecord(value.progress)) {
      const payload = value.progress;
      const step = LAB_STEPS.find((candidate) => candidate === payload.step);
      const fraction = payload.fraction;
      const percent = payload.percent;
      if (step === void 0 || typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 || typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) return null;
      return { kind: "progress", progress: { step, fraction, percent } };
    }
    if (value.kind !== "plan") return null;
    const plan = parseTracePlan(value.plan);
    if (value.plan !== null && plan === null) return null;
    return { kind: "plan", plan };
  }
  function parseTracePlan(value) {
    if (!isRecord(value) || !Number.isInteger(value.width) || !Number.isInteger(value.height) || !Array.isArray(value.plates)) return null;
    if (typeof value.width !== "number" || typeof value.height !== "number") return null;
    if (value.droppedColor !== null && typeof value.droppedColor !== "string") return null;
    const plates = [];
    for (const candidate of value.plates) {
      const plate = parsePlannedPlate(candidate);
      if (plate === null) return null;
      plates.push(plate);
    }
    let rasterStages;
    if (value.rasterStages !== void 0) {
      rasterStages = parseRasterStages(value.rasterStages) ?? void 0;
      if (rasterStages === void 0) return null;
    }
    return {
      width: value.width,
      height: value.height,
      droppedColor: value.droppedColor,
      plates,
      ...rasterStages === void 0 ? {} : { rasterStages }
    };
  }
  function parsePlannedPlate(value) {
    if (!isRecord(value) || !(value.png instanceof Uint8Array)) return null;
    if (typeof value.scale !== "number" || typeof value.originX !== "number" || typeof value.originY !== "number") return null;
    if (value.borderColor !== null && typeof value.borderColor !== "string") return null;
    const request = parseTraceRequest(value.request);
    if (request === null) return null;
    return {
      png: Buffer.from(value.png),
      scale: value.scale,
      originX: value.originX,
      originY: value.originY,
      borderColor: value.borderColor,
      ...value.cutOut === true ? { cutOut: true } : {},
      ...isSourceRaster(value.source) ? { source: value.source } : {},
      request
    };
  }
  function isSourceRaster(value) {
    return isRecord(value) && value.rgba instanceof Uint8Array && typeof value.width === "number" && typeof value.height === "number" && value.rgba.length === value.width * value.height * 4;
  }
  function parseTraceRequest(value) {
    if (!isRecord(value)) return null;
    const preset = value.preset;
    const stacking = value.stacking;
    if (preset !== "logo" && preset !== "icon" && preset !== "photo" && preset !== "poster") return null;
    if (stacking !== "cutout" && stacking !== "stacked") return null;
    if (typeof value.maxColors !== "number" || typeof value.smoothness !== "number" || typeof value.removeBackground !== "boolean") return null;
    const request = { preset, stacking, maxColors: value.maxColors, smoothness: value.smoothness, removeBackground: value.removeBackground };
    if (value.palette !== void 0) {
      if (!Array.isArray(value.palette) || !value.palette.every((color) => typeof color === "string")) return null;
      return {
        ...request,
        palette: value.palette,
        ...optionalRequestFields(value)
      };
    }
    return { ...request, ...optionalRequestFields(value) };
  }
  function optionalRequestFields(value) {
    const result = {};
    if (typeof value.colorPrecision === "number") result.colorPrecision = value.colorPrecision;
    if (typeof value.filterSpeckle === "number") result.filterSpeckle = value.filterSpeckle;
    if (value.clustering === "watershed" || value.clustering === "off") result.clustering = value.clustering;
    if (typeof value.watershedDetail === "number") result.watershedDetail = value.watershedDetail;
    if (typeof value.simplify === "number") result.simplify = value.simplify;
    return result;
  }
  function parseRasterStages(value) {
    if (!isRecord(value) || !(value.colors instanceof Uint8Array) || !(value.backdrop instanceof Uint8Array) || !(value.punchInput instanceof Uint8Array) || !(value.punch instanceof Uint8Array) || !(value.traceInput instanceof Uint8Array)) return null;
    if (value.mode !== "logo" && value.mode !== "icon" && value.mode !== "photo" && value.mode !== "poster") return null;
    if (value.droppedColor !== null && typeof value.droppedColor !== "string") return null;
    if (typeof value.spread !== "number" || typeof value.paletteSize !== "number") return null;
    const segmentation = parseSegmentColorStage(value.segmentation);
    if (value.segmentation !== null && segmentation === null) return null;
    return {
      mode: value.mode,
      colors: value.colors,
      backdrop: value.backdrop,
      punchInput: value.punchInput,
      punch: value.punch,
      traceInput: value.traceInput,
      droppedColor: value.droppedColor,
      spread: value.spread,
      paletteSize: value.paletteSize,
      segmentation
    };
  }
  function parseSegmentColorStage(value) {
    if (!isRecord(value) || !(value.colors instanceof Uint8Array) || !(value.labels instanceof Int16Array) || !(value.punchLabels instanceof Int16Array) || !(value.opaque instanceof Uint8Array) || !Array.isArray(value.palette) || typeof value.spread !== "number") return null;
    if (!value.palette.every((color) => isRecord(color) && typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number")) return null;
    return value;
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  var PRESET_CONTROL_LABELS = {
    maxColors: "\u0E40\u0E1E\u0E14\u0E32\u0E19\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35",
    snapBlends: "\u0E22\u0E38\u0E1A\u0E2A\u0E35\u0E1C\u0E2A\u0E21",
    speckArea: "\u0E02\u0E19\u0E32\u0E14\u0E08\u0E38\u0E14\u0E1D\u0E38\u0E48\u0E19",
    removeBackground: "\u0E25\u0E1A\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07",
    backdropSpread: "\u0E40\u0E01\u0E13\u0E11\u0E4C\u0E02\u0E2D\u0E1A\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07",
    opaqueAt: "\u0E40\u0E01\u0E13\u0E11\u0E4C\u0E04\u0E27\u0E32\u0E21\u0E17\u0E36\u0E1A",
    traceColors: "\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35\u0E15\u0E2D\u0E19\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19",
    lockPalette: "\u0E25\u0E47\u0E2D\u0E01\u0E0A\u0E38\u0E14\u0E2A\u0E35",
    colorPrecision: "\u0E04\u0E27\u0E32\u0E21\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E2A\u0E35",
    filterSpeckle: "\u0E01\u0E23\u0E2D\u0E07\u0E08\u0E38\u0E14\u0E40\u0E25\u0E47\u0E01",
    clustering: "\u0E01\u0E32\u0E23\u0E41\u0E22\u0E01\u0E42\u0E0B\u0E19",
    watershedDetail: "\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14 watershed",
    simplify: "\u0E04\u0E27\u0E32\u0E21\u0E04\u0E25\u0E32\u0E14\u0E40\u0E04\u0E25\u0E37\u0E48\u0E2D\u0E19\u0E02\u0E2D\u0E07\u0E40\u0E2A\u0E49\u0E19",
    stacking: "\u0E01\u0E32\u0E23\u0E27\u0E32\u0E07\u0E23\u0E39\u0E1B",
    dropPlate: "\u0E17\u0E34\u0E49\u0E07\u0E41\u0E1C\u0E48\u0E19\u0E2A\u0E35",
    fitGeometry: "\u0E08\u0E31\u0E1A\u0E23\u0E39\u0E1B\u0E17\u0E23\u0E07",
    smoothness: "\u0E04\u0E27\u0E32\u0E21\u0E40\u0E23\u0E35\u0E22\u0E1A",
    corner: "\u0E04\u0E27\u0E32\u0E21\u0E04\u0E21\u0E02\u0E2D\u0E07\u0E21\u0E38\u0E21",
    seal: "\u0E16\u0E21\u0E23\u0E2D\u0E22\u0E23\u0E30\u0E2B\u0E27\u0E48\u0E32\u0E07\u0E0A\u0E34\u0E49\u0E19",
    sealWidth: "\u0E04\u0E27\u0E32\u0E21\u0E2B\u0E19\u0E32\u0E02\u0E2D\u0E07\u0E23\u0E2D\u0E22\u0E17\u0E35\u0E48\u0E16\u0E21"
  };
  var SVG_NS = "http://www.w3.org/2000/svg";
  var SAFE_ATTRS = ["viewBox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linejoin", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "transform", "opacity", "fill-rule", "id"];
  function getElement(id) {
    const value = document.getElementById(id);
    if (value === null) throw new Error("Missing panel element: " + id);
    return value;
  }
  function getButton(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLButtonElement)) throw new Error("Expected button: " + id);
    return value;
  }
  function getInput(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLInputElement)) throw new Error("Expected input: " + id);
    return value;
  }
  function getOutput(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLOutputElement)) throw new Error("Expected output: " + id);
    return value;
  }
  function getProgress(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLProgressElement)) throw new Error("Expected progress bar: " + id);
    return value;
  }
  function getImage(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLImageElement)) throw new Error("Expected image: " + id);
    return value;
  }
  function getSvg(id) {
    const value = getElement(id);
    if (!(value instanceof SVGSVGElement)) throw new Error("Expected SVG: " + id);
    return value;
  }
  function getUi() {
    const preview = getElement("preview");
    const preset = getElement("preset");
    const brushCanvas = getElement("brush-canvas");
    if (!(preview instanceof HTMLImageElement)) throw new Error("Expected preview image");
    if (!(preset instanceof HTMLSelectElement)) throw new Error("Expected preset selector");
    if (!(brushCanvas instanceof HTMLCanvasElement)) throw new Error("Expected brush canvas");
    const clustering = getElement("clustering");
    if (!(clustering instanceof HTMLSelectElement)) throw new Error("Expected clustering selector");
    const stacking = getElement("stacking");
    if (!(stacking instanceof HTMLSelectElement)) throw new Error("Expected stacking selector");
    const controls = {
      mode: preset,
      maxColors: getInput("max-colors"),
      snapBlends: getInput("snap"),
      speckArea: getInput("speck"),
      removeBackground: getInput("backdrop"),
      backdropSpread: getInput("spread"),
      opaqueAt: getInput("opaque"),
      traceColors: getInput("trace-colors"),
      lockPalette: getInput("lock"),
      colorPrecision: getInput("precision"),
      filterSpeckle: getInput("speckle"),
      clustering,
      watershedDetail: getInput("watershed"),
      simplify: getInput("simplify"),
      stacking,
      dropPlate: getInput("drop-plate"),
      fitGeometry: getInput("fit"),
      smoothness: getInput("smooth"),
      corner: getInput("corner"),
      seal: getInput("seal"),
      sealWidth: getInput("seal-width")
    };
    const controlStatus = /* @__PURE__ */ new Map();
    for (const field of PRESET_CONTROL_FIELDS) {
      const element = controls[field];
      const label = element instanceof HTMLInputElement && element.type === "checkbox" ? element.closest("label") : null;
      const anchor = label ?? element;
      const marker = document.createElement("div");
      marker.id = "control-state-" + field;
      marker.className = "control-state";
      marker.hidden = true;
      const note = document.createElement("span");
      note.textContent = "\u0E41\u0E01\u0E49\u0E44\u0E02\u0E41\u0E25\u0E49\u0E27";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "control-reset";
      reset.textContent = "\u0E04\u0E37\u0E19\u0E04\u0E48\u0E32 preset";
      reset.setAttribute("aria-label", "\u0E04\u0E37\u0E19\u0E04\u0E48\u0E32 preset: " + PRESET_CONTROL_LABELS[field]);
      marker.append(note, reset);
      anchor.insertAdjacentElement("afterend", marker);
      controlStatus.set(field, { marker, reset });
    }
    return {
      selectionDetails: getElement("selection-details"),
      selectionThumbnail: getImage("selection-thumbnail"),
      selectionThumbnailPlaceholder: getElement("selection-thumbnail-placeholder"),
      selectionCropOverlay: getSvg("selection-crop-overlay"),
      largeImageNotice: getElement("large-image-notice"),
      largeImageNoticeText: getElement("large-image-notice-text"),
      cropStart: getButton("crop-start"),
      useFullImage: getButton("use-full-image"),
      cropEditor: getElement("crop-editor"),
      cropSizeLive: getElement("crop-size-live"),
      cropApply: getButton("crop-apply"),
      cropCancel: getButton("crop-cancel"),
      cropControls: getElement("crop-controls"),
      cropAgain: getButton("crop-again"),
      cropClear: getButton("crop-clear"),
      presetsSection: getElement("presets-section"),
      presetCards: Array.from(document.querySelectorAll("#preset-gallery .preset-card")),
      presetConfirm: getElement("preset-confirm"),
      presetConfirmText: getElement("preset-confirm-text"),
      presetConfirmApply: getButton("preset-confirm-apply"),
      presetConfirmCancel: getButton("preset-confirm-cancel"),
      controlsSection: getElement("controls-section"),
      presetOrigin: getElement("preset-origin"),
      controlStatus,
      status: getElement("status"),
      phase: getElement("phase"),
      progressStatus: getElement("progress-status"),
      progressBar: getProgress("progress-bar"),
      progressLabel: getElement("progress-label"),
      progressValue: getElement("progress-value"),
      preview,
      previewEmpty: getElement("preview-empty"),
      stage: getElement("vector-stage"),
      brushCanvas,
      refresh: getButton("refresh"),
      trace: getButton("trace"),
      cancel: getButton("cancel"),
      apply: getButton("apply"),
      batch: getButton("batch"),
      preset,
      reset: getButton("reset-controls"),
      stepButtons: Array.from(document.querySelectorAll("#step-tabs button")),
      stepFields: Array.from(document.querySelectorAll("#step-controls fieldset")),
      controls,
      facts: getElement("facts"),
      factPaths: getElement("fact-paths"),
      factAnchors: getElement("fact-anchors"),
      factHoles: getElement("fact-holes"),
      factColors: getElement("fact-colors"),
      factNote: getElement("fact-note"),
      palette: getElement("palette"),
      viewPixels: getButton("view-pixels"),
      viewVectors: getButton("view-vectors"),
      zoomIn: getButton("zoom-in"),
      zoomOut: getButton("zoom-out"),
      editTools: getElement("edit-tools"),
      toolDrag: getButton("tool-drag"),
      toolErase: getButton("tool-erase"),
      toolBrush: getButton("tool-brush"),
      brushTrace: getButton("brush-trace")
    };
  }
  function illustratorHost() {
    const cep = window.__adobe_cep__;
    if (cep === void 0 || typeof CSInterface === "undefined") return null;
    return new CSInterface();
  }
  function parseHostResult(raw) {
    if (raw === "EvalScript error.") throw new Error("Illustrator \u0E40\u0E23\u0E35\u0E22\u0E01\u0E2A\u0E04\u0E23\u0E34\u0E1B\u0E15\u0E4C\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
    const parts = raw.split("|");
    const kind = parts[0];
    if (kind === "ERR") throw new Error(decodeURIComponent(parts[1] ?? "Illustrator error"));
    if (kind !== "OK") throw new Error("Illustrator \u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E23\u0E39\u0E49\u0E08\u0E31\u0E01");
    return parts.slice(1).map((part) => decodeURIComponent(part));
  }
  function parsePositiveNumber(raw, label) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error("\u0E04\u0E48\u0E32\u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: " + label);
    return value;
  }
  function parseFiniteNumber(raw, label) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("\u0E04\u0E48\u0E32\u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: " + label);
    return value;
  }
  function parseSelection(parts) {
    if (parts.length !== 11) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
    const itemType = parts[3] ?? "";
    if (itemType === "") throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
    const uuid = parts[4];
    if (!uuid) throw new Error("\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E21\u0E35 Illustrator UUID");
    const left = parseFiniteNumber(parts[5], "left");
    const top = parseFiniteNumber(parts[6], "top");
    const right = parseFiniteNumber(parts[7], "right");
    const bottom = parseFiniteNumber(parts[8], "bottom");
    return {
      documentName: parts[0] ?? "",
      documentIdentity: parts[1] ?? "",
      itemName: parts[2] ?? "",
      itemType,
      uuid,
      bounds: [left, top, right, bottom],
      widthPt: parsePositiveNumber(String(right - left), "width"),
      heightPt: parsePositiveNumber(String(top - bottom), "height"),
      embedded: parts[9] === "1",
      fromResult: parts[10] === "1"
    };
  }
  function selectionKey(selection) {
    return JSON.stringify([selection.documentIdentity, selection.uuid]);
  }
  function sameSelectionSourceAndBounds(first, second) {
    return selectionKey(first) === selectionKey(second) && first.bounds.join(",") === second.bounds.join(",");
  }
  function capturedPngDataUrl(pngPath) {
    return "data:image/png;base64," + fs.readFileSync(pngPath).toString("base64");
  }
  function capturedPngBytes(dataUrl) {
    const prefix = "data:image/png;base64,";
    if (!dataUrl.startsWith(prefix)) throw new Error("\u0E20\u0E32\u0E1E\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07 PNG \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    return Buffer.from(dataUrl.slice(prefix.length), "base64");
  }
  function cropPngBytes(png, sourceSize, rect) {
    const image = readRgbaPng(png);
    if (image === null || image.width !== sourceSize.width || image.height !== sourceSize.height) {
      throw new Error("\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E04\u0E23\u0E2D\u0E1B\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
    }
    const clipped = clampCropRect(rect, sourceSize);
    return encodeRgbaPng(clipped.width, clipped.height, cropRgba(image.rgba, sourceSize, clipped));
  }
  function cropJobInput(job, selection, capture) {
    if (capture.choice.kind !== "cropped") return job;
    const sourcePng = fs.readFileSync(job.pngPath);
    const croppedPng = cropPngBytes(sourcePng, capture.size, capture.choice.rect);
    fs.writeFileSync(job.pngPath, croppedPng);
    return {
      ...job,
      placementBounds: cropRectToArtboardBounds(selection.bounds, capture.size, capture.choice.rect)
    };
  }
  function callHost(host, method, args = []) {
    const encoded = args.map((value) => '"' + encodeURIComponent(value) + '"').join(",");
    const script = method + "(" + encoded + ")";
    return new Promise((resolve, reject) => {
      let finished = false;
      const timer = window.setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(new HostTimeoutError());
      }, 18e4);
      host.evalScript(script, (raw) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        try {
          resolve(parseHostResult(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function newJob(settings, controls, selection) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vector-panel-"));
    return {
      id: crypto.randomBytes(8).toString("hex"),
      directory,
      pngPath: path.join(directory, "source.png"),
      svgPath: path.join(directory, "result.svg"),
      settings,
      controls,
      placementBounds: selection.bounds,
      cancelled: false
    };
  }
  function cleanJob(job) {
    try {
      fs.rmSync(job.directory, { recursive: true, force: true });
    } catch (_) {
    }
  }
  function cleanStaleJobs() {
    try {
      const root = os.tmpdir();
      for (const name of fs.readdirSync(root)) {
        if (!name.startsWith("vector-panel-")) continue;
        const directory = path.join(root, name);
        const stat = fs.statSync(directory);
        if (stat.isDirectory() && Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1e3) {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
    } catch (_) {
    }
  }
  function runVtracer(binary, job, inputPath, outputPath, request, onStart) {
    return new Promise((resolve, reject) => {
      const child = childProcess.spawn(binary, vtracerArguments(inputPath, outputPath, request), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      onStart(child);
      let stderr = "";
      child.stderr?.on("data", (chunk2) => {
        if (stderr.length < 4e3) stderr += chunk2.toString("utf8").slice(0, 4e3 - stderr.length);
      });
      child.once("error", (error) => reject(error));
      child.once("close", (code) => {
        if (job.cancelled) {
          reject(new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27"));
        } else if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          resolve();
        } else {
          reject(new Error("VTracer \u0E41\u0E1B\u0E25\u0E07\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" + (stderr ? ": " + stderr.trim() : "")));
        }
      });
    });
  }
  function readControls(ui) {
    const fields = ui.controls;
    const mode = fields.mode.value;
    if (mode !== "logo" && mode !== "icon" && mode !== "photo" && mode !== "poster") throw new Error("Preset \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    return {
      mode,
      maxColors: Number(fields.maxColors.value),
      snapBlends: fields.snapBlends.checked,
      speckArea: Number(fields.speckArea.value),
      removeBackground: fields.removeBackground.checked,
      backdropSpread: Number(fields.backdropSpread.value),
      opaqueAt: Number(fields.opaqueAt.value),
      traceColors: Number(fields.traceColors.value),
      lockPalette: fields.lockPalette.checked,
      colorPrecision: Number(fields.colorPrecision.value),
      filterSpeckle: Number(fields.filterSpeckle.value),
      clustering: fields.clustering.value === "watershed" ? "watershed" : "off",
      watershedDetail: Number(fields.watershedDetail.value),
      simplify: Number(fields.simplify.value),
      stacking: fields.stacking.value === "stacked" ? "stacked" : "cutout",
      dropPlate: fields.dropPlate.checked,
      fitGeometry: fields.fitGeometry.checked,
      smoothness: Number(fields.smoothness.value),
      corner: Number(fields.corner.value),
      seal: fields.seal.checked,
      sealWidth: Number(fields.sealWidth.value)
    };
  }
  function applyControls(ui, controls) {
    const fields = ui.controls;
    fields.mode.value = controls.mode;
    fields.maxColors.value = String(controls.maxColors);
    fields.snapBlends.checked = controls.snapBlends;
    fields.speckArea.value = String(controls.speckArea);
    fields.removeBackground.checked = controls.removeBackground;
    fields.backdropSpread.value = String(controls.backdropSpread);
    fields.opaqueAt.value = String(controls.opaqueAt);
    fields.traceColors.value = String(controls.traceColors);
    fields.lockPalette.checked = controls.lockPalette;
    fields.colorPrecision.value = String(controls.colorPrecision);
    fields.filterSpeckle.value = String(controls.filterSpeckle);
    fields.clustering.value = controls.clustering;
    fields.watershedDetail.value = String(controls.watershedDetail);
    fields.simplify.value = String(controls.simplify);
    fields.stacking.value = controls.stacking;
    fields.dropPlate.checked = controls.dropPlate;
    fields.fitGeometry.checked = controls.fitGeometry;
    fields.smoothness.value = String(controls.smoothness);
    fields.corner.value = String(controls.corner);
    fields.seal.checked = controls.seal;
    fields.sealWidth.value = String(controls.sealWidth);
    syncControlOutputs(ui);
  }
  function syncControlOutputs(ui) {
    const fields = ui.controls;
    const values = {
      "max-colors": fields.maxColors.value === "0" ? "\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34" : fields.maxColors.value,
      speck: fields.speckArea.value,
      spread: fields.backdropSpread.value,
      opaque: fields.opaqueAt.value,
      "trace-colors": fields.traceColors.value,
      precision: fields.colorPrecision.value,
      speckle: fields.filterSpeckle.value,
      simplify: Number(fields.simplify.value).toFixed(2),
      watershed: fields.watershedDetail.value,
      smooth: Number(fields.smoothness.value).toFixed(1),
      corner: fields.corner.value + "\xB0",
      "seal-width": Number(fields.sealWidth.value).toFixed(1)
    };
    for (const [id, value] of Object.entries(values)) {
      const output = getOutput(id + "-value");
      output.value = value;
      output.textContent = value;
    }
    fields.traceColors.disabled = fields.lockPalette.checked;
    fields.watershedDetail.disabled = fields.clustering.value !== "watershed";
    fields.sealWidth.disabled = !fields.seal.checked;
  }
  function svgDataUrl(svg) {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  }
  function pngDataUrl(bytes) {
    if (typeof Buffer !== "undefined") return "data:image/png;base64," + Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index] ?? 0);
    return "data:image/png;base64," + btoa(binary);
  }
  function settingsNote(settings) {
    return "preset=" + settings.preset + ";colors=" + settings.maxColors + ";smooth=" + settings.smoothness + ";corner=" + settings.corner + ";stacking=" + settings.stacking + ";background=" + (settings.removeBackground ? "removed" : "kept");
  }
  function sameControls(left, right) {
    return CONTROL_STEPS.every(({ field }) => left[field] === right[field]);
  }
  function showFacts(ui, facts) {
    if (facts === null) {
      ui.facts.hidden = true;
      ui.factNote.hidden = true;
      ui.factNote.textContent = "";
      return;
    }
    ui.factPaths.textContent = String(facts.paths);
    ui.factAnchors.textContent = String(facts.anchors);
    ui.factHoles.textContent = String(facts.holes);
    ui.factColors.textContent = String(facts.colors);
    ui.facts.hidden = false;
    const note = [holeNote(facts.holes), shapeNote(facts)].filter((item) => item !== null).join(" \xB7 ");
    ui.factNote.hidden = note === "";
    ui.factNote.textContent = note;
  }
  function currentCropRect(capture) {
    return capture.choice.kind === "cropped" ? capture.choice.rect : null;
  }
  function cropStatsLabel(size) {
    return size.width + " \xD7 " + size.height + " px \xB7 \u0E1B\u0E23\u0E30\u0E21\u0E32\u0E13 " + formatRasterMegapixels(size) + " MP";
  }
  function isCropHandle(value) {
    return value === "nw" || value === "n" || value === "ne" || value === "e" || value === "se" || value === "s" || value === "sw" || value === "w";
  }
  function resizeCropRect(rect, handle, dx, dy, size) {
    let left = rect.x;
    let top = rect.y;
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;
    if (handle.includes("w")) left = Math.min(right - 1, Math.max(0, rect.x + dx));
    if (handle.includes("e")) right = Math.max(left + 1, Math.min(size.width, rect.x + rect.width + dx));
    if (handle.includes("n")) top = Math.min(bottom - 1, Math.max(0, rect.y + dy));
    if (handle.includes("s")) bottom = Math.max(top + 1, Math.min(size.height, rect.y + rect.height + dy));
    return clampCropRect({ x: left, y: top, width: right - left, height: bottom - top }, size);
  }
  function drawCropOverlay(ui, size, rect) {
    const overlay = ui.selectionCropOverlay;
    overlay.setAttribute("viewBox", "0 0 " + size.width + " " + size.height);
    overlay.setAttribute("preserveAspectRatio", "none");
    overlay.replaceChildren();
    const hitArea = document.createElementNS(SVG_NS, "rect");
    hitArea.setAttribute("class", "crop-hit-area");
    hitArea.setAttribute("width", String(size.width));
    hitArea.setAttribute("height", String(size.height));
    overlay.append(hitArea);
    const shade = document.createElementNS(SVG_NS, "path");
    shade.setAttribute("class", "crop-shade");
    shade.setAttribute("d", "M0 0H" + size.width + "V" + size.height + "H0Z M" + rect.x + " " + rect.y + "H" + (rect.x + rect.width) + "V" + (rect.y + rect.height) + "H" + rect.x + "Z");
    overlay.append(shade);
    const selection = document.createElementNS(SVG_NS, "rect");
    selection.setAttribute("class", "crop-selection");
    selection.setAttribute("x", String(rect.x));
    selection.setAttribute("y", String(rect.y));
    selection.setAttribute("width", String(rect.width));
    selection.setAttribute("height", String(rect.height));
    overlay.append(selection);
    const x1 = rect.x;
    const x2 = rect.x + rect.width / 2;
    const x3 = rect.x + rect.width;
    const y1 = rect.y;
    const y2 = rect.y + rect.height / 2;
    const y3 = rect.y + rect.height;
    const radius = Math.max(4, Math.min(size.width, size.height) * 0.035);
    const handles = [
      ["nw", x1, y1],
      ["n", x2, y1],
      ["ne", x3, y1],
      ["e", x3, y2],
      ["se", x3, y3],
      ["s", x2, y3],
      ["sw", x1, y3],
      ["w", x1, y2]
    ];
    for (const [handle, x, y] of handles) {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("class", "crop-handle");
      circle.setAttribute("data-handle", handle);
      circle.setAttribute("cx", String(x));
      circle.setAttribute("cy", String(y));
      circle.setAttribute("r", String(radius));
      overlay.append(circle);
    }
  }
  function showSelection(ui, selection, thumbnail, capture, cropDraft) {
    ui.selectionDetails.replaceChildren();
    if (selection === null) {
      ui.selectionThumbnail.removeAttribute("src");
      ui.selectionThumbnail.alt = "";
      ui.selectionThumbnail.hidden = true;
      ui.selectionThumbnailPlaceholder.textContent = "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E20\u0E32\u0E1E\u0E2B\u0E23\u0E37\u0E2D\u0E01\u0E25\u0E38\u0E48\u0E21\u0E1A\u0E19 artboard";
      ui.selectionThumbnailPlaceholder.hidden = false;
      ui.selectionCropOverlay.setAttribute("hidden", "");
      ui.selectionCropOverlay.replaceChildren();
      ui.largeImageNotice.hidden = true;
      ui.cropEditor.hidden = true;
      ui.cropControls.hidden = true;
    } else {
      const matchingCapture = capture !== null && capture.selectionKey === selectionKey(selection) ? capture : null;
      const title = document.createElement("strong");
      title.textContent = selection.itemName || selection.itemType;
      const detail = document.createElement("small");
      const kind = selection.itemType === "GroupItem" ? "\u0E01\u0E25\u0E38\u0E48\u0E21" : selection.itemType === "PlacedItem" ? "linked" : selection.embedded ? "embedded" : "raster";
      detail.textContent = selection.documentName + " \xB7 " + kind + " \xB7 " + Math.round(selection.widthPt) + " \xD7 " + Math.round(selection.heightPt) + " pt";
      if (matchingCapture !== null) {
        const rect = cropDraft?.rect ?? currentCropRect(matchingCapture);
        const shownSize = rect === null ? matchingCapture.size : { width: rect.width, height: rect.height };
        detail.textContent += " \xB7 " + cropStatsLabel(shownSize);
      }
      if (selection.fromResult) detail.textContent += " \xB7 \u0E41\u0E1B\u0E25\u0E07\u0E0B\u0E49\u0E33\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48";
      ui.selectionDetails.append(title, detail);
      if (thumbnail.kind === "ready") {
        const displayUrl = cropDraft !== null && matchingCapture !== null ? matchingCapture.fullDataUrl : thumbnail.dataUrl;
        if (ui.selectionThumbnail.getAttribute("src") !== displayUrl) ui.selectionThumbnail.src = displayUrl;
        ui.selectionThumbnail.alt = selection.itemName || "\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01";
        ui.selectionThumbnail.hidden = false;
        ui.selectionThumbnailPlaceholder.hidden = true;
      } else {
        ui.selectionThumbnail.removeAttribute("src");
        ui.selectionThumbnail.alt = "";
        ui.selectionThumbnail.hidden = true;
        ui.selectionThumbnailPlaceholder.textContent = thumbnail.kind === "loading" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u2026" : "\u0E41\u0E2A\u0E14\u0E07\u0E20\u0E32\u0E1E\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49";
        ui.selectionThumbnailPlaceholder.hidden = false;
      }
      const canCrop = matchingCapture !== null && thumbnail.kind === "ready" && requiresCropChoice(matchingCapture.size);
      const needsChoice = canCrop && matchingCapture.choice.kind === "needs-choice";
      ui.largeImageNotice.hidden = !needsChoice || cropDraft !== null;
      if (matchingCapture !== null) {
        ui.largeImageNoticeText.textContent = "\u0E20\u0E32\u0E1E\u0E43\u0E2B\u0E0D\u0E48 (\u0E1B\u0E23\u0E30\u0E21\u0E32\u0E13 " + formatRasterMegapixels(matchingCapture.size) + " MP) \u0E2D\u0E32\u0E08\u0E0A\u0E49\u0E32 \u2014 \u0E04\u0E23\u0E2D\u0E1B\u0E01\u0E48\u0E2D\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E44\u0E2B\u0E21?";
      }
      ui.cropEditor.hidden = cropDraft === null;
      ui.cropControls.hidden = !canCrop || needsChoice || cropDraft !== null;
      ui.cropAgain.textContent = matchingCapture?.choice.kind === "cropped" ? "\u0E41\u0E01\u0E49\u0E04\u0E23\u0E2D\u0E1B" : "\u0E04\u0E23\u0E2D\u0E1B\u0E20\u0E32\u0E1E";
      ui.cropClear.hidden = matchingCapture?.choice.kind !== "cropped";
      if (cropDraft !== null && matchingCapture !== null) {
        drawCropOverlay(ui, matchingCapture.size, cropDraft.rect);
        ui.selectionCropOverlay.removeAttribute("hidden");
        ui.cropSizeLive.textContent = cropStatsLabel({ width: cropDraft.rect.width, height: cropDraft.rect.height });
      } else {
        ui.selectionCropOverlay.setAttribute("hidden", "");
        ui.selectionCropOverlay.replaceChildren();
      }
    }
  }
  function currentSelection(state) {
    switch (state.kind) {
      case "empty":
        return null;
      case "loading":
        return null;
      case "selected":
      case "capturing":
      case "planning":
      case "tracing":
      case "preview":
      case "applying":
        return state.selection;
      default: {
        const exhaustive = state;
        return exhaustive;
      }
    }
  }
  function previewOf(state) {
    if (state.kind === "preview" || state.kind === "applying") return state;
    return null;
  }
  function copySvgElement(node) {
    const name = node.localName;
    if (name !== "svg" && name !== "g" && name !== "path" && name !== "circle" && name !== "ellipse" && name !== "rect") return null;
    const next = document.createElementNS(SVG_NS, name);
    for (const attr of SAFE_ATTRS) {
      const value = node.getAttribute(attr);
      if (value !== null && !/^\s*javascript:/i.test(value)) next.setAttribute(attr, value);
    }
    for (const child of Array.from(node.children)) {
      const copied = copySvgElement(child);
      if (copied !== null) next.append(copied);
    }
    return next;
  }
  function adoptSvg(svgText) {
    const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (parsed.querySelector("parsererror") !== null) return null;
    const root = parsed.documentElement;
    if (root.localName !== "svg") return null;
    const copy = copySvgElement(root);
    return copy instanceof SVGSVGElement ? copy : null;
  }
  function pathDataAt(svg, pathIndex) {
    const tags = svg.match(/<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>/gi) ?? [];
    const tag = tags[pathIndex];
    if (tag === void 0) return null;
    const match = /\bd\s*=\s*"([^"]*)"|\bd\s*=\s*'([^']*)'/i.exec(tag);
    return match?.[1] ?? match?.[2] ?? null;
  }
  function svgPoint(svg, event) {
    const matrix = svg.getScreenCTM();
    if (matrix === null) return null;
    const point2 = svg.createSVGPoint();
    point2.x = event.clientX;
    point2.y = event.clientY;
    const local = point2.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  }
  function start() {
    const ui = getUi();
    let state = { kind: "empty" };
    let thumbnailState = initialThumbnailState();
    let thumbnailGeneration = 0;
    let cachedCapture = null;
    let capturedImage = null;
    let cropDraft = null;
    let cropDrag = null;
    let view = "vector";
    let zoom = 1;
    let tool = "none";
    let brushColor = null;
    let brushPixels = null;
    let batching = false;
    let stopBatch = false;
    let pendingFocus = null;
    let edited = false;
    let selectedStep = initialActiveStep();
    let presetState = emptyPresetState();
    let pendingPreset = null;
    const browserFixture = new URLSearchParams(window.location.search).get("fixture") === "1";
    let latestPlan = null;
    let latestSvgs = [];
    let latestVectors = null;
    let latestPreview = null;
    let fixtureControls = null;
    let retraceTimer = 0;
    let retraceQueued = false;
    let liveControls = null;
    const host = illustratorHost();
    const extensionPath = host === null ? "" : host.getSystemPath(SystemPath.EXTENSION);
    let progressTimer = 0;
    let pendingProgress = null;
    let progressOperationLabel = null;
    let progressDone = false;
    let displayedProgress = -1;
    function clearCachedCapture() {
      if (cachedCapture === null) return;
      cleanJob(cachedCapture.job);
      cachedCapture = null;
    }
    function beginThumbnailCapture() {
      thumbnailGeneration += 1;
      thumbnailState = reduceThumbnailState(thumbnailState, { kind: "capture-started", generation: thumbnailGeneration });
      render();
      return thumbnailGeneration;
    }
    function completeThumbnailCapture(generation, dataUrl) {
      const next = reduceThumbnailState(thumbnailState, { kind: "capture-completed", generation, dataUrl });
      if (next === thumbnailState) return false;
      thumbnailState = next;
      render();
      return true;
    }
    function failThumbnailCapture(generation) {
      const next = reduceThumbnailState(thumbnailState, { kind: "capture-failed", generation });
      if (next === thumbnailState) return false;
      thumbnailState = next;
      render();
      return true;
    }
    function cropChoicePending(selection) {
      return selection !== null && capturedImage !== null && capturedImage.selectionKey === selectionKey(selection) && capturedImage.choice.kind === "needs-choice";
    }
    function recordCaptureThumbnail(selection, job, generation) {
      if (!isCurrentThumbnailCapture(thumbnailState, generation)) return false;
      const png = fs.readFileSync(job.pngPath);
      const size = readPngDimensions(png);
      if (size === null) throw new Error("\u0E2D\u0E48\u0E32\u0E19\u0E02\u0E19\u0E32\u0E14\u0E20\u0E32\u0E1E PNG \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
      const key = selectionKey(selection);
      const previous = capturedImage;
      const retainChoice = previous !== null && previous.selectionKey === key && previous.size.width === size.width && previous.size.height === size.height;
      let choice;
      if (retainChoice && previous !== null) choice = previous.choice;
      else choice = requiresCropChoice(size) ? { kind: "needs-choice" } : { kind: "not-required" };
      const fullDataUrl = "data:image/png;base64," + png.toString("base64");
      const nextCapture = { selectionKey: key, size, fullDataUrl, choice };
      const displayedPng = choice.kind === "cropped" ? cropPngBytes(png, size, choice.rect) : png;
      capturedImage = nextCapture;
      if (!completeThumbnailCapture(generation, "data:image/png;base64," + displayedPng.toString("base64"))) {
        capturedImage = previous;
        return false;
      }
      return true;
    }
    async function ensureCurrentSelection(selection) {
      if (host === null) return false;
      try {
        const liveSelection = parseSelection(await callHost(host, "VP_snapshot"));
        if (sameSelectionSourceAndBounds(selection, liveSelection)) return true;
        message("\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01 \xB7 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E43\u0E2B\u0E21\u0E48");
      } catch {
      }
      await refresh();
      return false;
    }
    function updateThumbnailDataUrl(dataUrl) {
      if (thumbnailState.kind !== "ready") return;
      thumbnailState = { ...thumbnailState, dataUrl };
    }
    async function openCropEditor() {
      if (capturedImage === null || !requiresCropChoice(capturedImage.size)) return;
      const selection = currentSelection(state);
      if (selection === null || !await ensureCurrentSelection(selection)) return;
      if (capturedImage === null) return;
      const existing = currentCropRect(capturedImage);
      const rect = existing ?? clampCropRect({
        x: capturedImage.size.width * 0.1,
        y: capturedImage.size.height * 0.1,
        width: capturedImage.size.width * 0.8,
        height: capturedImage.size.height * 0.8
      }, capturedImage.size);
      cropDraft = { rect };
      cropDrag = null;
      render();
    }
    async function acceptFullImage() {
      if (capturedImage === null || capturedImage.choice.kind !== "needs-choice") return;
      const selection = currentSelection(state);
      if (selection === null || !await ensureCurrentSelection(selection)) return;
      if (capturedImage === null || capturedImage.choice.kind !== "needs-choice") return;
      capturedImage = { ...capturedImage, choice: { kind: "full" } };
      updateThumbnailDataUrl(capturedImage.fullDataUrl);
      message("\u0E43\u0E0A\u0E49\u0E17\u0E31\u0E49\u0E07\u0E20\u0E32\u0E1E\u0E41\u0E25\u0E49\u0E27 \xB7 \u0E01\u0E14\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E41\u0E1B\u0E25\u0E07");
      render();
    }
    function discardPreviewAfterCropChange() {
      if (state.kind !== "preview") return;
      if (state.job !== null) cleanJob(state.job);
      state = { kind: "selected", selection: state.selection };
      latestPlan = null;
      latestSvgs = [];
      latestVectors = null;
      latestPreview = null;
    }
    async function applyCropSelection() {
      if (capturedImage === null || cropDraft === null) return false;
      const selection = currentSelection(state);
      if (selection === null || !await ensureCurrentSelection(selection)) return false;
      if (capturedImage === null || cropDraft === null) return false;
      const rect = clampCropRect(cropDraft.rect, capturedImage.size);
      const png = cropPngBytes(capturedPngBytes(capturedImage.fullDataUrl), capturedImage.size, rect);
      discardPreviewAfterCropChange();
      capturedImage = { ...capturedImage, choice: { kind: "cropped", rect } };
      updateThumbnailDataUrl("data:image/png;base64," + png.toString("base64"));
      cropDraft = null;
      cropDrag = null;
      render();
      return true;
    }
    async function clearCropSelection() {
      if (capturedImage === null || capturedImage.choice.kind !== "cropped") return;
      const selection = currentSelection(state);
      if (selection === null || !await ensureCurrentSelection(selection)) return;
      if (capturedImage === null || capturedImage.choice.kind !== "cropped") return;
      discardPreviewAfterCropChange();
      capturedImage = { ...capturedImage, choice: { kind: "full" } };
      updateThumbnailDataUrl(capturedImage.fullDataUrl);
      cropDraft = null;
      cropDrag = null;
      message("\u0E25\u0E49\u0E32\u0E07\u0E04\u0E23\u0E2D\u0E1B\u0E41\u0E25\u0E49\u0E27 \xB7 \u0E43\u0E0A\u0E49\u0E20\u0E32\u0E1E\u0E40\u0E15\u0E47\u0E21");
      render();
    }
    function flushProgress() {
      progressTimer = 0;
      if (pendingProgress === null) return;
      const progress = pendingProgress;
      pendingProgress = null;
      const percent = Math.min(100, Math.max(0, Math.round(progress.percent)));
      ui.progressStatus.hidden = false;
      ui.progressLabel.textContent = progressDone ? "\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E41\u0E25\u0E49\u0E27" : progressOperationLabel ?? "\u0E01\u0E33\u0E25\u0E31\u0E07" + PROGRESS_LABELS[progress.step];
      ui.progressValue.textContent = String(percent) + "%";
      ui.progressBar.value = percent;
      displayedProgress = percent;
    }
    function queueProgress(progress) {
      pendingProgress = progress;
      if (displayedProgress < 0 || progress.percent >= 100) {
        if (progressTimer !== 0) window.clearTimeout(progressTimer);
        flushProgress();
        return;
      }
      if (progressTimer === 0) progressTimer = window.setTimeout(flushProgress, 50);
    }
    function beginProgress(from, label = null) {
      if (progressTimer !== 0) window.clearTimeout(progressTimer);
      progressTimer = 0;
      pendingProgress = null;
      progressOperationLabel = label;
      progressDone = false;
      displayedProgress = -1;
      ui.progressStatus.hidden = false;
      return createProgressReporter(from, queueProgress);
    }
    function finishProgress(progress) {
      progress.finish();
      progressDone = true;
      pendingProgress = { step: "seal", fraction: 1, percent: 100 };
      flushProgress();
    }
    function hideProgress() {
      if (progressTimer !== 0) window.clearTimeout(progressTimer);
      progressTimer = 0;
      pendingProgress = null;
      progressDone = false;
      displayedProgress = -1;
      progressOperationLabel = null;
      ui.progressStatus.hidden = true;
    }
    function presetName(preset) {
      return PRESET_PRESENTATION.find((option) => option.preset === preset)?.label ?? preset;
    }
    function runFixtureRetrace() {
      if (browserFixture) scheduleRetrace();
    }
    function activatePreset(preset) {
      const selected = selectPreset(preset);
      presetState = selected;
      pendingPreset = null;
      applyControls(ui, selected.controls);
      selectedStep = reduceActiveStep(selectedStep, { kind: "preset-selected" });
      render();
      if (host !== null) void trace();
      else runFixtureRetrace();
    }
    function choosePreset(preset) {
      if (presetState.kind === "selected" && presetState.preset === preset) {
        pendingPreset = null;
        render();
        if (host !== null) void trace();
        else runFixtureRetrace();
        return;
      }
      if (hasPresetEdits(presetState)) {
        pendingPreset = preset;
        render();
        return;
      }
      activatePreset(preset);
    }
    function updatePresetUi(busy) {
      const selectionAvailable = currentSelection(state) !== null && state.kind !== "loading";
      ui.presetsSection.hidden = !selectionAvailable;
      ui.controlsSection.hidden = !selectionAvailable || presetState.kind === "unselected";
      for (const card of ui.presetCards) {
        card.disabled = busy || !selectionAvailable;
        card.setAttribute("aria-pressed", presetState.kind === "selected" && card.dataset.preset === presetState.preset ? "true" : "false");
      }
      ui.presetConfirm.hidden = pendingPreset === null || busy;
      if (pendingPreset !== null && presetState.kind === "selected") {
        const count = modifiedPresetControlCount(presetState);
        ui.presetConfirmText.textContent = "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E08\u0E32\u0E01 " + presetName(presetState.preset) + " \u0E40\u0E1B\u0E47\u0E19 " + presetName(pendingPreset) + " \u0E41\u0E25\u0E30\u0E40\u0E23\u0E34\u0E48\u0E21\u0E14\u0E49\u0E27\u0E22\u0E04\u0E48\u0E32 preset \u0E43\u0E2B\u0E21\u0E48\u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E21\u0E48? (\u0E41\u0E01\u0E49\u0E44\u0E02\u0E41\u0E25\u0E49\u0E27 " + String(count) + " \u0E04\u0E48\u0E32)";
      }
      if (presetState.kind === "selected") {
        const count = modifiedPresetControlCount(presetState);
        ui.presetOrigin.textContent = "\u0E08\u0E32\u0E01 preset: " + presetName(presetState.preset) + (count === 0 ? " \u2022 \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E41\u0E01\u0E49\u0E44\u0E02" : " \u2022 \u0E41\u0E01\u0E49\u0E44\u0E02\u0E41\u0E25\u0E49\u0E27 " + String(count) + " \u0E04\u0E48\u0E32");
      } else {
        ui.presetOrigin.textContent = "";
      }
      const modified = new Set(modifiedPresetControls(presetState));
      for (const field of PRESET_CONTROL_FIELDS) {
        const isModified = modified.has(field);
        const control = ui.controls[field];
        const label = control instanceof HTMLInputElement && control.type === "checkbox" ? control.closest("label") : null;
        control.classList.toggle("is-modified", isModified);
        label?.classList.toggle("is-modified", isModified);
        const status = ui.controlStatus.get(field);
        if (status !== void 0) {
          status.marker.hidden = !isModified;
          if (isModified) control.setAttribute("aria-describedby", status.marker.id);
          else control.removeAttribute("aria-describedby");
        }
      }
      ui.reset.disabled = busy || !hasPresetEdits(presetState);
    }
    function message(value, isError = false) {
      ui.status.textContent = value;
      ui.status.classList.toggle("error", isError);
    }
    function showStep() {
      for (const button of ui.stepButtons) button.setAttribute("aria-pressed", button.dataset.step === selectedStep ? "true" : "false");
      for (const field of ui.stepFields) field.hidden = field.id !== "fields-" + selectedStep;
    }
    function syncOutputs() {
      syncControlOutputs(ui);
    }
    function commitSvg(svgText, focus = null) {
      if (state.kind !== "preview") return;
      pendingFocus = focus;
      if (state.job !== null) writeResultSvgAtomically(state.job.svgPath, state.job.id, svgText, fs);
      state = { ...state, svgText, facts: scoreSvg(svgText), dataUrl: svgDataUrl(svgText) };
      latestPreview = state;
      render();
    }
    function showPalette() {
      const preview = previewOf(state);
      const palette = preview?.facts.palette ?? [];
      ui.palette.replaceChildren();
      if (palette.length === 0) {
        ui.palette.hidden = true;
        return;
      }
      for (const color of palette) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.title = color;
        button.setAttribute("aria-label", color);
        button.setAttribute("aria-pressed", color === brushColor ? "true" : "false");
        if (/^#[0-9a-f]{6}$/i.test(color)) button.style.backgroundColor = color;
        button.addEventListener("click", () => {
          brushColor = color;
          tool = "brush";
          view = "pixels";
          message("\u0E23\u0E30\u0E1A\u0E32\u0E22\u0E1A\u0E19\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25 \u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E41\u0E1B\u0E25\u0E07\u0E08\u0E32\u0E01\u0E41\u0E1B\u0E23\u0E07");
          render();
        });
        item.append(button);
        ui.palette.append(item);
      }
      ui.palette.hidden = false;
    }
    function mountStage(svgText) {
      ui.stage.replaceChildren();
      const svg = adoptSvg(svgText);
      if (svg === null) return;
      const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/) ?? [];
      const boxWidth = Number(viewBox[2] ?? svg.getAttribute("width") ?? 100);
      const radius = Math.max(2.5, (Number.isFinite(boxWidth) ? boxWidth : 100) / 48);
      svg.classList.toggle("zoom-2", zoom === 2);
      svg.classList.toggle("zoom-4", zoom === 4);
      let shapeIndex = 0;
      let pathIndex = 0;
      const shapes = svg.querySelectorAll("path, circle, ellipse, rect");
      shapes.forEach((shape) => {
        const currentShape = shapeIndex;
        shapeIndex += 1;
        shape.setAttribute("data-shape-index", String(currentShape));
        if (tool === "erase") {
          shape.addEventListener("pointerdown", (event) => {
            if (!(event instanceof PointerEvent) || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            if (state.kind !== "preview") return;
            const next = removeShape(state.svgText, currentShape);
            if (next === state.svgText) {
              message("\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E0A\u0E34\u0E49\u0E19\u0E2A\u0E38\u0E14\u0E17\u0E49\u0E32\u0E22\u0E41\u0E25\u0E49\u0E27", true);
              return;
            }
            edited = true;
            message("\u0E25\u0E1A\u0E0A\u0E34\u0E49\u0E19\u0E41\u0E25\u0E49\u0E27");
            commitSvg(next);
          });
        }
        if (shape.localName !== "path" || tool !== "drag") return;
        const currentPath = pathIndex;
        pathIndex += 1;
        shape.setAttribute("data-path-index", String(currentPath));
        const parent = shape.parentElement ?? svg;
        for (const anchor of listAnchors(svgText).filter((item) => item.pathIndex === currentPath)) {
          const handle = document.createElementNS(SVG_NS, "circle");
          handle.setAttribute("class", "anchor-handle");
          handle.setAttribute("cx", String(anchor.x));
          handle.setAttribute("cy", String(anchor.y));
          handle.setAttribute("r", String(radius));
          handle.setAttribute("fill", "#cfb6ff");
          handle.setAttribute("stroke", "#241735");
          handle.setAttribute("stroke-width", String(Math.max(0.4, radius / 5)));
          handle.setAttribute("tabindex", "0");
          handle.setAttribute("role", "button");
          handle.setAttribute("aria-label", "\u0E08\u0E38\u0E14\u0E22\u0E36\u0E14 " + String(anchor.anchorIndex + 1));
          parent.append(handle);
          let live = svgText;
          const follow = (next) => {
            live = next;
            const data = pathDataAt(next, currentPath);
            if (data !== null) shape.setAttribute("d", data);
            const points = listAnchors(next);
            svg.querySelectorAll(".anchor-handle").forEach((node, index) => {
              const point2 = points[index];
              if (point2 === void 0) return;
              node.setAttribute("cx", String(point2.x));
              node.setAttribute("cy", String(point2.y));
            });
          };
          handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            handle.classList.add("dragging");
            handle.setPointerCapture(event.pointerId);
          });
          handle.addEventListener("pointermove", (event) => {
            if (!handle.hasPointerCapture(event.pointerId)) return;
            const point2 = svgPoint(svg, event);
            if (point2 === null) return;
            follow(moveAnchor(live, currentPath, anchor.anchorIndex, point2.x, point2.y));
          });
          handle.addEventListener("lostpointercapture", () => {
            handle.classList.remove("dragging");
            if (live === svgText) return;
            edited = true;
            commitSvg(live, { pathIndex: currentPath, anchorIndex: anchor.anchorIndex });
          });
          handle.addEventListener("keydown", (event) => {
            const step = event.shiftKey ? 8 : 1;
            const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
            const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
            if (dx === 0 && dy === 0) return;
            event.preventDefault();
            const current = listAnchors(live).find((item) => item.pathIndex === currentPath && item.anchorIndex === anchor.anchorIndex);
            if (current === void 0) return;
            edited = true;
            commitSvg(moveAnchor(live, currentPath, anchor.anchorIndex, current.x + dx, current.y + dy), { pathIndex: currentPath, anchorIndex: anchor.anchorIndex });
          });
        }
      });
      ui.stage.append(svg);
      if (pendingFocus !== null) {
        const target = pendingFocus;
        pendingFocus = null;
        const handles = svg.querySelectorAll(".anchor-handle");
        const index = listAnchors(svgText).findIndex((item) => item.pathIndex === target.pathIndex && item.anchorIndex === target.anchorIndex);
        const handle = handles[index];
        if (handle instanceof SVGElement) handle.focus();
      }
    }
    function drawBrush() {
      const preview = previewOf(state);
      if (preview?.raster == null) return;
      const pixels = brushPixels ?? preview.raster.rgba;
      if (ui.brushCanvas.width !== preview.raster.width) ui.brushCanvas.width = preview.raster.width;
      if (ui.brushCanvas.height !== preview.raster.height) ui.brushCanvas.height = preview.raster.height;
      const context = ui.brushCanvas.getContext("2d");
      if (context === null) return;
      const image = context.createImageData(preview.raster.width, preview.raster.height);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
    }
    function render() {
      showStep();
      showSelection(ui, currentSelection(state), thumbnailState, capturedImage, cropDraft);
      const busy = batching || state.kind === "loading" || state.kind === "capturing" || state.kind === "planning" || state.kind === "tracing" || state.kind === "applying";
      updatePresetUi(busy);
      ui.refresh.disabled = busy;
      ui.trace.disabled = busy || state.kind === "empty" || presetState.kind === "unselected" || cropDraft !== null || cropChoicePending(currentSelection(state));
      ui.batch.disabled = busy || presetState.kind === "unselected" || cropChoicePending(currentSelection(state));
      ui.cropStart.disabled = busy;
      ui.useFullImage.disabled = busy;
      ui.cropApply.disabled = busy;
      ui.cropCancel.disabled = busy;
      ui.cropAgain.disabled = busy;
      ui.cropClear.disabled = busy;
      ui.trace.textContent = currentSelection(state)?.fromResult ? "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48" : "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07";
      ui.apply.disabled = state.kind !== "preview" || state.job === null || !sameControls(state.job.controls, readControls(ui));
      ui.cancel.hidden = state.kind !== "planning" && state.kind !== "tracing" && !batching;
      ui.phase.textContent = state.kind === "loading" ? "\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E" : state.kind === "capturing" ? "\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E" : state.kind === "planning" ? "\u0E08\u0E31\u0E14\u0E2A\u0E35" : state.kind === "tracing" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E1B\u0E25\u0E07" : state.kind === "applying" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E43\u0E2A\u0E48\u0E1C\u0E25" : batching ? "\u0E41\u0E1B\u0E25\u0E07\u0E2B\u0E25\u0E32\u0E22\u0E20\u0E32\u0E1E" : state.kind === "preview" ? "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2A\u0E48\u0E1C\u0E25" : "\u0E1E\u0E23\u0E49\u0E2D\u0E21";
      const currentPreview = previewOf(state);
      const preview = currentPreview ?? (state.kind === "planning" || state.kind === "tracing" ? latestPreview : null);
      const showing = preview !== null;
      const outputStep = selectedStep === "seal";
      ui.viewPixels.hidden = !showing || !outputStep;
      ui.viewVectors.hidden = !showing || !outputStep;
      ui.zoomIn.hidden = !showing;
      ui.zoomOut.hidden = !showing;
      ui.editTools.hidden = !showing || !outputStep || state.kind !== "preview";
      ui.viewPixels.setAttribute("aria-pressed", view === "pixels" ? "true" : "false");
      ui.viewVectors.setAttribute("aria-pressed", view === "vector" ? "true" : "false");
      ui.toolDrag.setAttribute("aria-pressed", tool === "drag" ? "true" : "false");
      ui.toolErase.setAttribute("aria-pressed", tool === "erase" ? "true" : "false");
      ui.toolBrush.setAttribute("aria-pressed", tool === "brush" ? "true" : "false");
      ui.brushTrace.disabled = !showing || brushPixels === null || preview?.job == null || state.kind !== "preview";
      ui.preview.classList.toggle("zoom-2", showing && zoom === 2);
      ui.preview.classList.toggle("zoom-4", showing && zoom === 4);
      ui.brushCanvas.classList.toggle("zoom-2", showing && zoom === 2);
      ui.brushCanvas.classList.toggle("zoom-4", showing && zoom === 4);
      const editingVectors = showing && outputStep && state.kind === "preview" && view === "vector" && (tool === "drag" || tool === "erase");
      const brushing = showing && outputStep && state.kind === "preview" && tool === "brush";
      if (preview !== null) {
        ui.previewEmpty.hidden = true;
        showFacts(ui, preview.facts);
        showPalette();
        if (brushing) {
          ui.preview.hidden = true;
          ui.stage.hidden = true;
          ui.brushCanvas.hidden = false;
          drawBrush();
        } else if (editingVectors) {
          ui.preview.hidden = true;
          ui.brushCanvas.hidden = true;
          ui.stage.hidden = false;
          const editable = tool === "drag" ? expandPrimitives(preview.svgText) : preview.svgText;
          if (tool === "drag" && editable !== preview.svgText && state.kind === "preview") {
            commitSvg(editable);
            return;
          }
          mountStage(editable);
        } else {
          ui.stage.hidden = true;
          ui.brushCanvas.hidden = true;
          ui.preview.hidden = false;
          if (!outputStep) {
            const raster = selectedStep === "capture" ? preview.raster?.rgba : latestPlan?.rasterStages?.[selectedStep === "colors" ? "colors" : selectedStep === "backdrop" ? "backdrop" : "punch"];
            const vector = selectedStep === "trace" ? latestVectors?.trace : selectedStep === "fit" ? latestVectors?.fitted : selectedStep === "fair" ? latestVectors?.faired : null;
            if (vector !== null && vector !== void 0) ui.preview.src = svgDataUrl(vector);
            else if (raster !== void 0 && raster !== null && preview.raster !== null) {
              ui.preview.src = pngDataUrl(encodeRgbaPng(preview.raster.width, preview.raster.height, raster));
            } else ui.preview.removeAttribute("src");
          } else {
            ui.preview.src = view === "pixels" ? preview.pngUrl : preview.dataUrl;
          }
        }
      } else {
        ui.preview.removeAttribute("src");
        ui.preview.hidden = true;
        ui.stage.hidden = true;
        ui.brushCanvas.hidden = true;
        ui.previewEmpty.hidden = false;
        showFacts(ui, null);
        showPalette();
      }
    }
    function planInWorker(selection, job, sourcePng, previousPlan, from, progress) {
      liveControls = job.controls;
      const Ctor = loadWorkerConstructor();
      let worker = null;
      if (Ctor !== null) {
        try {
          worker = new Ctor(path.join(extensionPath, "js", "pipeline-worker.js"));
        } catch {
          workerConstructor = null;
          worker = null;
        }
      }
      if (worker === null) return planInPanel(selection, job, sourcePng, previousPlan, from, progress);
      const activeWorker = worker;
      state = { kind: "planning", selection, job, runner: { cancel: () => {
        void activeWorker.terminate();
      } }, from };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E41\u0E25\u0E30\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E02\u0E31\u0E49\u0E19\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u2026");
      render();
      return new Promise((resolve, reject) => {
        let settled = false;
        let received = false;
        const timer = window.setTimeout(() => {
          fail(new Error("\u0E02\u0E31\u0E49\u0E19\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E43\u0E0A\u0E49\u0E40\u0E27\u0E25\u0E32\u0E19\u0E32\u0E19\u0E40\u0E01\u0E34\u0E19 " + String(Math.round(PLAN_TIMEOUT_MS / 1e3)) + " \u0E27\u0E34\u0E19\u0E32\u0E17\u0E35 \xB7 \u0E25\u0E2D\u0E07\u0E25\u0E14\u0E02\u0E19\u0E32\u0E14\u0E20\u0E32\u0E1E\u0E2B\u0E23\u0E37\u0E2D\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35"));
        }, PLAN_TIMEOUT_MS);
        const settle = () => {
          if (settled) return false;
          settled = true;
          window.clearTimeout(timer);
          void activeWorker.terminate();
          return true;
        };
        const finish = (plan) => {
          if (settle()) resolve(plan);
        };
        const fail = (error) => {
          if (settle()) reject(error);
        };
        const fallback = () => {
          workerConstructor = null;
          if (!settle()) return;
          if (job.cancelled) {
            reject(new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27"));
            return;
          }
          planInPanel(selection, job, sourcePng, previousPlan, from, progress).then(resolve, reject);
        };
        activeWorker.on("message", (value) => {
          if (job.cancelled) {
            fail(new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27"));
            return;
          }
          const result = parsePlanWorkerMessage(value);
          if (result === null) {
            fail(new Error("\u0E1C\u0E25\u0E08\u0E32\u0E01\u0E02\u0E31\u0E49\u0E19\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07"));
          } else if (result.kind === "progress") {
            progress.report(result.progress.step, result.progress.fraction);
          } else if (result.kind === "error") {
            received = true;
            fail(new Error(result.error));
          } else {
            received = true;
            finish(result.plan);
          }
        });
        activeWorker.once("error", () => {
          if (job.cancelled) fail(new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27"));
          else fallback();
        });
        activeWorker.once("exit", (code) => {
          if (settled) return;
          if (job.cancelled) fail(new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27"));
          else if (!received) fallback();
          else fail(new Error("\u0E02\u0E31\u0E49\u0E19\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E2B\u0E22\u0E38\u0E14\u0E01\u0E48\u0E2D\u0E19\u0E08\u0E1A (" + String(code) + ")"));
        });
        try {
          activeWorker.postMessage({
            sourcePng: new Uint8Array(sourcePng),
            settings: job.settings,
            controls: job.controls,
            previousStages: previousPlan?.rasterStages ?? null,
            from
          });
        } catch {
          fallback();
        }
      });
    }
    async function planInPanel(selection, job, sourcePng, previousPlan, from, progress) {
      let cancelled = false;
      state = { kind: "planning", selection, job, runner: { cancel: () => {
        cancelled = true;
      } }, from };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E41\u0E25\u0E30\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E02\u0E31\u0E49\u0E19\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u2026");
      render();
      await new Promise((resolve) => {
        window.setTimeout(resolve, 50);
      });
      if (job.cancelled) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
      const plan = await planTraceAsync(sourcePng, job.settings, job.controls, previousPlan?.rasterStages ?? null, from, (step, fraction) => progress.report(step, fraction), () => cancelled || job.cancelled);
      if (job.cancelled || cancelled) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
      return plan;
    }
    async function vectorize(selection, job, palette, previousPlan = null, from = "colors", progress = beginProgress(from)) {
      if (!fs.existsSync(job.pngPath) || fs.statSync(job.pngPath).size === 0) throw new Error("Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E20\u0E32\u0E1E PNG \u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32");
      const binary = resolveVtracer(path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer"));
      if (!fs.existsSync(binary)) throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A VTracer \u0E17\u0E35\u0E48 " + binary);
      const sourcePng = fs.readFileSync(job.pngPath);
      liveControls = job.controls;
      const flatMode = job.controls.mode === "logo" || job.controls.mode === "icon";
      const reuseExistingPlan = previousPlan !== null && (from === "trace" || flatMode && LAB_STEPS.indexOf(from) > LAB_STEPS.indexOf("colors"));
      let plan = reuseExistingPlan ? replanTracePlan(previousPlan, job.controls) : await planInWorker(selection, job, sourcePng, previousPlan, from, progress);
      if (reuseExistingPlan && flatMode) {
        if (LAB_STEPS.indexOf(from) <= LAB_STEPS.indexOf("backdrop")) progress.report("backdrop", 1);
        if (LAB_STEPS.indexOf(from) <= LAB_STEPS.indexOf("punch")) progress.report("punch", 1);
      }
      const controls = liveControls ?? job.controls;
      job = { ...job, controls, settings: settingsFromControls(controls) };
      if (plan !== null) plan = replanTracePlan(plan, controls);
      if (plan === null || plan.plates.length === 0) throw new Error("\u0E2D\u0E48\u0E32\u0E19 PNG \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
      progress.report("trace", 0);
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E22\u0E01\u0E42\u0E0B\u0E19\u0E2A\u0E35 \u0E41\u0E25\u0E49\u0E27\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C\u2026");
      const svgs = [];
      for (let index = 0; index < plan.plates.length; index += 1) {
        const plate = plan.plates[index];
        if (plate === void 0) continue;
        const pngPath = path.join(job.directory, "trace-" + String(index) + ".png");
        const svgPath = path.join(job.directory, "trace-" + String(index) + ".svg");
        fs.writeFileSync(pngPath, plate.png);
        const brushed = palette !== void 0 && job.settings.preset !== "logo" && job.settings.preset !== "icon";
        const request = brushed ? { ...plate.request, maxColors: 0, palette: cappedPalette(palette, "#ff00ff") } : plate.request;
        progress.report("trace", index / plan.plates.length);
        await runVtracer(binary, job, pngPath, svgPath, request, (child) => {
          state = { kind: "tracing", selection, job, child };
          render();
        });
        svgs.push(fs.readFileSync(svgPath, "utf8"));
        progress.report("trace", (index + 1) / plan.plates.length);
      }
      const finishedControls = liveControls ?? job.controls;
      job = { ...job, controls: finishedControls, settings: settingsFromControls(finishedControls) };
      edited = false;
      latestPlan = plan;
      latestSvgs = svgs;
      latestVectors = vectorStagesForPlan(svgs, plan, job.controls, progress.report);
      const svgText = latestVectors.sealed;
      writeResultSvgAtomically(job.svgPath, job.id, svgText, fs);
      const decoded = readRgbaPng(sourcePng);
      brushPixels = null;
      tool = "none";
      view = "vector";
      zoom = 1;
      state = {
        kind: "preview",
        selection,
        job,
        dataUrl: svgDataUrl(svgText),
        pngUrl: pngDataUrl(sourcePng),
        svgText,
        raster: decoded === null ? null : { width: decoded.width, height: decoded.height, rgba: decoded.rgba },
        placementBounds: job.placementBounds,
        facts: scoreSvg(svgText)
      };
      latestPreview = state;
      liveControls = null;
      finishProgress(progress);
      message("\u0E40\u0E17\u0E35\u0E22\u0E1A\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25\u0E01\u0E31\u0E1A\u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C \u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E43\u0E2A\u0E48\u0E43\u0E19 Illustrator");
      render();
    }
    async function refresh() {
      if (host === null) {
        message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
        return;
      }
      if (state.kind === "loading" || state.kind === "capturing" || state.kind === "planning" || state.kind === "tracing" || state.kind === "applying" || batching) return;
      if (state.kind === "preview" && state.job !== null) cleanJob(state.job);
      clearCachedCapture();
      capturedImage = null;
      cropDraft = null;
      cropDrag = null;
      latestPlan = null;
      latestSvgs = [];
      latestVectors = null;
      latestPreview = null;
      liveControls = null;
      const generation = beginThumbnailCapture();
      const progress = beginProgress("capture", "\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E");
      state = { kind: "loading" };
      render();
      try {
        const selection = parseSelection(await callHost(host, "VP_snapshot"));
        if (!isCurrentThumbnailCapture(thumbnailState, generation)) return;
        let captureError = null;
        let job = null;
        try {
          const controls = readControls(ui);
          job = newJob(settingsFromControls(controls), controls, selection);
          await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
          if (!isCurrentThumbnailCapture(thumbnailState, generation)) {
            cleanJob(job);
            return;
          }
          if (!recordCaptureThumbnail(selection, job, generation)) {
            cleanJob(job);
            return;
          }
          cachedCapture = { selectionKey: selectionKey(selection), job };
        } catch (error) {
          if (job !== null) cleanJob(job);
          if (!failThumbnailCapture(generation)) return;
          captureError = error;
        }
        if (captureError === null) {
          progress.report("capture", 1);
          finishProgress(progress);
        } else {
          hideProgress();
        }
        state = { kind: "selected", selection };
        message(captureError === null ? "\u0E20\u0E32\u0E1E\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E41\u0E1B\u0E25\u0E07" : "\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49: " + errorMessage(captureError), captureError !== null);
      } catch (error) {
        if (!failThumbnailCapture(generation)) return;
        hideProgress();
        state = { kind: "empty" };
        message(errorMessage(error), true);
      }
      render();
    }
    async function trace() {
      if (host === null) {
        message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
        return;
      }
      if (state.kind !== "selected" && state.kind !== "preview") return;
      const selection = state.selection;
      if (!await ensureCurrentSelection(selection)) return;
      if (state.kind !== "selected" && state.kind !== "preview") return;
      if (cropDraft !== null) {
        message("\u0E43\u0E0A\u0E49\u0E04\u0E23\u0E2D\u0E1B\u0E19\u0E35\u0E49\u0E2B\u0E23\u0E37\u0E2D\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E41\u0E1B\u0E25\u0E07", true);
        render();
        return;
      }
      if (cropChoicePending(selection)) {
        message("\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E04\u0E23\u0E2D\u0E1B\u0E2B\u0E23\u0E37\u0E2D\u0E43\u0E0A\u0E49\u0E17\u0E31\u0E49\u0E07\u0E20\u0E32\u0E1E\u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E41\u0E1B\u0E25\u0E07", true);
        render();
        return;
      }
      if (state.kind === "preview" && state.job !== null) cleanJob(state.job);
      latestPlan = null;
      latestSvgs = [];
      latestVectors = null;
      latestPreview = null;
      liveControls = null;
      const controls = readControls(ui);
      const cached = cachedCapture;
      cachedCapture = null;
      let reusedCapture = false;
      let job;
      if (cached !== null && cached.selectionKey === selectionKey(selection)) {
        job = { ...cached.job, settings: settingsFromControls(controls), controls, cancelled: false };
        reusedCapture = true;
      } else {
        if (cached !== null) cleanJob(cached.job);
        job = newJob(settingsFromControls(controls), controls, selection);
      }
      const progress = beginProgress("capture");
      const thumbnailRequest = reusedCapture ? null : beginThumbnailCapture();
      try {
        state = { kind: "capturing", selection, job };
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Illustrator\u2026");
        render();
        if (!reusedCapture) {
          await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
          if (thumbnailRequest !== null && !recordCaptureThumbnail(selection, job, thumbnailRequest)) return;
          if (cropChoicePending(selection)) {
            cachedCapture = { selectionKey: selectionKey(selection), job };
            state = { kind: "selected", selection };
            progress.report("capture", 1);
            finishProgress(progress);
            message("\u0E20\u0E32\u0E1E\u0E43\u0E2B\u0E0D\u0E48 \u0E40\u0E25\u0E37\u0E2D\u0E01\u0E04\u0E23\u0E2D\u0E1B\u0E2B\u0E23\u0E37\u0E2D\u0E43\u0E0A\u0E49\u0E17\u0E31\u0E49\u0E07\u0E20\u0E32\u0E1E\u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E41\u0E1B\u0E25\u0E07");
            render();
            return;
          }
        }
        if (capturedImage !== null && capturedImage.selectionKey === selectionKey(selection)) {
          job = cropJobInput(job, selection, capturedImage);
        }
        progress.report("capture", 1);
        const capturedControls = readControls(ui);
        job = { ...job, settings: settingsFromControls(capturedControls), controls: capturedControls, cancelled: false };
        retraceQueued = false;
        while (true) {
          try {
            await vectorize(selection, job, void 0, null, "colors", progress);
            break;
          } catch (error) {
            if (!job.cancelled || !retraceQueued) throw error;
            retraceQueued = false;
            const currentControls = readControls(ui);
            job = { ...job, settings: settingsFromControls(currentControls), controls: currentControls, cancelled: false };
            state = { kind: "capturing", selection, job };
            message("\u0E43\u0E0A\u0E49\u0E04\u0E48\u0E32\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14 \u0E41\u0E25\u0E49\u0E27\u0E40\u0E23\u0E34\u0E48\u0E21\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E43\u0E2B\u0E21\u0E48\u2026");
            render();
          }
        }
        if (retraceQueued) {
          retraceQueued = false;
          await retraceFromCapture();
        }
      } catch (error) {
        if (thumbnailRequest !== null) failThumbnailCapture(thumbnailRequest);
        if (!job.cancelled || !retraceQueued) hideProgress();
        cleanJob(job);
        state = { kind: "selected", selection };
        latestPreview = null;
        liveControls = null;
        message(errorMessage(error), true);
        render();
      }
    }
    async function apply() {
      if (host === null || state.kind !== "preview" || state.job === null) return false;
      if (!batching && !await ensureCurrentSelection(state.selection)) return false;
      if (state.kind !== "preview" || state.job === null) return false;
      if (!batching && !sameControls(state.job.controls, readControls(ui))) {
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E1B\u0E23\u0E31\u0E1A\u0E1C\u0E25\u0E43\u0E2B\u0E49\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A\u0E04\u0E48\u0E32\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14\u2026");
        scheduleRetrace();
        render();
        return false;
      }
      const preview = state;
      const job = state.job;
      let svgFileText = "";
      try {
        const svgBytes = fs.readFileSync(job.svgPath);
        svgFileText = svgBytes.toString("utf8");
        if (!Buffer.from(svgFileText, "utf8").equals(svgBytes)) throw new Error("\u0E44\u0E1F\u0E25\u0E4C\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 UTF-8");
      } catch {
        message("\u0E27\u0E32\u0E07\u0E25\u0E07 Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49: \u0E44\u0E1F\u0E25\u0E4C\u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C\u0E44\u0E21\u0E48\u0E2A\u0E21\u0E1A\u0E39\u0E23\u0E13\u0E4C \u0E25\u0E2D\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E43\u0E2B\u0E21\u0E48", true);
        render();
        return false;
      }
      if (validateSvgForPlacement(svgFileText, preview.svgText).kind === "invalid") {
        message("\u0E27\u0E32\u0E07\u0E25\u0E07 Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49: \u0E44\u0E1F\u0E25\u0E4C\u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C\u0E44\u0E21\u0E48\u0E2A\u0E21\u0E1A\u0E39\u0E23\u0E13\u0E4C \u0E25\u0E2D\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E43\u0E2B\u0E21\u0E48", true);
        render();
        return false;
      }
      state = { ...preview, kind: "applying" };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E19\u0E33 path \u0E40\u0E02\u0E49\u0E32 Illustrator\u2026");
      render();
      try {
        const result = await callHost(host, "VP_commit", [preview.selection.uuid, job.svgPath, job.id, settingsNote(job.settings), preview.selection.bounds.join(","), preview.placementBounds.join(","), preview.selection.documentIdentity]);
        message("\u0E43\u0E2A\u0E48\u0E1C\u0E25\u0E41\u0E25\u0E49\u0E27: " + (result[1] ?? "0") + " paths \xB7 \u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E22\u0E31\u0E07\u0E2D\u0E22\u0E39\u0E48");
        cleanJob(job);
        state = { kind: "selected", selection: preview.selection };
        render();
        return true;
      } catch (error) {
        if (error instanceof HostTimeoutError) {
          message("\u0E27\u0E32\u0E07\u0E25\u0E07 Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49: Illustrator \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A \u0E15\u0E23\u0E27\u0E08 Layers \u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E25\u0E0B\u0E49\u0E33", true);
          state = { kind: "selected", selection: preview.selection };
        } else {
          message("\u0E27\u0E32\u0E07\u0E25\u0E07 Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49: " + errorMessage(error), true);
          state = preview;
        }
        render();
        return false;
      }
    }
    async function batch() {
      if (host === null) {
        message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
        return;
      }
      if (batching || state.kind === "loading" || state.kind === "capturing" || state.kind === "planning" || state.kind === "tracing" || state.kind === "applying") return;
      if (state.kind === "preview" && state.job !== null) cleanJob(state.job);
      clearCachedCapture();
      batching = true;
      stopBatch = false;
      render();
      let finished = 0;
      try {
        const list = parseBatchFields(await callHost(host, "VP_list"));
        if (list.items.length === 0) throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E20\u0E32\u0E1E raster \u0E43\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23");
        for (const item of list.items) {
          if (stopBatch) break;
          const selection = {
            documentName: list.documentName,
            documentIdentity: list.documentIdentity,
            itemName: item.name || "\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01",
            itemType: item.itemType,
            uuid: item.uuid,
            bounds: item.bounds,
            widthPt: item.bounds[2] - item.bounds[0],
            heightPt: item.bounds[1] - item.bounds[3],
            embedded: item.embedded,
            fromResult: false
          };
          const controls = readControls(ui);
          const job = newJob(settingsFromControls(controls), controls, selection);
          const progress = beginProgress("capture");
          message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E1B\u0E25\u0E07\u0E20\u0E32\u0E1E " + String(finished + 1) + "/" + String(list.items.length) + " \xB7 " + selection.itemName);
          state = { kind: "capturing", selection, job };
          const thumbnailRequest = beginThumbnailCapture();
          render();
          try {
            await callHost(host, "VP_capture", [item.uuid, job.pngPath, list.documentIdentity, "1"]);
            completeThumbnailCapture(thumbnailRequest, capturedPngDataUrl(job.pngPath));
            progress.report("capture", 1);
            await vectorize(selection, job, void 0, null, "colors", progress);
            const placed = await apply();
            if (!placed) return;
            finished += 1;
          } catch (error) {
            failThumbnailCapture(thumbnailRequest);
            hideProgress();
            cleanJob(job);
            throw error;
          }
        }
        message(stopBatch ? "\u0E2B\u0E22\u0E38\u0E14\u0E17\u0E35\u0E48\u0E20\u0E32\u0E1E " + String(finished) : "\u0E41\u0E1B\u0E25\u0E07\u0E04\u0E23\u0E1A " + String(finished) + " \u0E20\u0E32\u0E1E");
      } catch (error) {
        hideProgress();
        message(errorMessage(error), true);
      } finally {
        batching = false;
        stopBatch = false;
        render();
      }
    }
    async function retraceBrush() {
      if (state.kind !== "preview" || state.job === null || state.raster === null || brushPixels === null) {
        message("\u0E23\u0E30\u0E1A\u0E32\u0E22\u0E2A\u0E35\u0E01\u0E48\u0E2D\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E08\u0E32\u0E01\u0E41\u0E1B\u0E23\u0E07", true);
        return;
      }
      const palette = paletteFromRaster(brushPixels);
      const selection = state.selection;
      const job = state.job;
      try {
        fs.writeFileSync(job.pngPath, encodeRgbaPng(state.raster.width, state.raster.height, brushPixels));
        const flat = job.settings.preset === "logo" || job.settings.preset === "icon";
        message(flat ? "\u0E41\u0E1B\u0E25\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E08\u0E32\u0E01\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E32\u0E22" : palette === null ? "\u0E2A\u0E35\u0E21\u0E32\u0E01\u0E01\u0E27\u0E48\u0E32 32 \u0E2A\u0E35 \u0E08\u0E36\u0E07\u0E43\u0E2B\u0E49 VTracer \u0E08\u0E31\u0E14\u0E01\u0E25\u0E38\u0E48\u0E21\u0E2A\u0E35\u0E40\u0E2D\u0E07" : "\u0E43\u0E0A\u0E49\u0E2A\u0E35\u0E08\u0E32\u0E01\u0E41\u0E1B\u0E23\u0E07 " + String(palette.length) + " \u0E2A\u0E35");
        await vectorize(selection, job, flat ? void 0 : palette ?? void 0);
      } catch (error) {
        message(errorMessage(error), true);
        render();
      }
    }
    function paintEvent(event) {
      const preview = previewOf(state);
      if (preview?.raster == null || brushColor === null || tool !== "brush") return;
      const rect = ui.brushCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = (event.clientX - rect.left) * preview.raster.width / rect.width;
      const y = (event.clientY - rect.top) * preview.raster.height / rect.height;
      const radius = Math.max(2, preview.raster.width / 28);
      brushPixels = paintDisc(brushPixels ?? preview.raster.rgba, preview.raster.width, preview.raster.height, x, y, radius, brushColor);
      drawBrush();
      ui.brushTrace.disabled = preview.job === null;
    }
    function chooseTool(next, note) {
      tool = tool === next ? "none" : next;
      if (tool === "brush") view = "pixels";
      if (tool === "drag" || tool === "erase") view = "vector";
      message(tool === "none" ? "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2A\u0E48\u0E1C\u0E25" : note);
      render();
    }
    function scheduleRetrace() {
      window.clearTimeout(retraceTimer);
      retraceTimer = window.setTimeout(() => {
        void retraceFromCapture();
      }, 150);
    }
    function updateStylePreview(from, controls) {
      if (state.kind !== "preview" || state.job === null || latestPlan === null || latestVectors === null) return;
      if (edited) {
        message("\u0E41\u0E01\u0E49\u0E0A\u0E34\u0E49\u0E19\u0E41\u0E25\u0E49\u0E27 \u0E08\u0E36\u0E07\u0E44\u0E21\u0E48\u0E40\u0E02\u0E35\u0E22\u0E19\u0E17\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02 \u0E08\u0E19\u0E01\u0E27\u0E48\u0E32\u0E08\u0E30\u0E41\u0E1B\u0E25\u0E07\u0E43\u0E2B\u0E21\u0E48", true);
        return;
      }
      const previous = state;
      const currentJob = previous.job;
      if (currentJob === null) return;
      const progress = beginProgress(from);
      const job = { ...currentJob, settings: settingsFromControls(controls), controls };
      let vectors = latestVectors;
      if (from === "fit") {
        vectors = vectorStagesForPlan(latestSvgs, latestPlan, controls, progress.report);
      } else if (from === "fair") {
        progress.report("fair", 0);
        const faired = fairLabVector(vectors.fitted, controls);
        progress.report("fair", 1);
        progress.report("seal", 0);
        vectors = { ...vectors, faired, sealed: sealLabVector(faired, controls) };
        progress.report("seal", 1);
      } else {
        progress.report("seal", 0);
        vectors = { ...vectors, sealed: sealLabVector(vectors.faired, controls) };
        progress.report("seal", 1);
      }
      latestVectors = vectors;
      writeResultSvgAtomically(job.svgPath, job.id, vectors.sealed, fs);
      const nextPreview = { ...previous, job, svgText: vectors.sealed, facts: scoreSvg(vectors.sealed), dataUrl: svgDataUrl(vectors.sealed) };
      state = { kind: "preview", ...nextPreview };
      latestPreview = nextPreview;
      finishProgress(progress);
      message("\u0E1B\u0E23\u0E31\u0E1A\u0E02\u0E31\u0E49\u0E19 " + from + " \u0E41\u0E25\u0E49\u0E27");
      render();
    }
    async function retraceFromCapture() {
      if (batching) return;
      if (state.kind === "planning") {
        const controls2 = readControls(ui);
        const baseline = liveControls ?? state.job.controls;
        if (sameControls(baseline, controls2)) return;
        const changed = earliestChangedStep(baseline, controls2);
        if (LAB_STEPS.indexOf(changed) > LAB_STEPS.indexOf("punch")) {
          liveControls = controls2;
          message("\u0E04\u0E48\u0E32\u0E02\u0E31\u0E49\u0E19\u0E16\u0E31\u0E14\u0E44\u0E1B\u0E08\u0E30\u0E43\u0E0A\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35\u0E17\u0E35\u0E48\u0E01\u0E32\u0E23\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E08\u0E1A");
          return;
        }
        liveControls = controls2;
        retraceQueued = true;
        state.job.cancelled = true;
        state.runner.cancel();
        message("\u0E04\u0E48\u0E32\u0E1B\u0E23\u0E31\u0E1A\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E25\u0E49\u0E27 \xB7 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2B\u0E22\u0E38\u0E14\u0E01\u0E32\u0E23\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E40\u0E01\u0E48\u0E32\u2026");
        return;
      }
      if (state.kind === "tracing") {
        const controls2 = readControls(ui);
        const baseline = liveControls ?? state.job.controls;
        if (sameControls(baseline, controls2)) return;
        const changed = earliestChangedStep(baseline, controls2);
        if (LAB_STEPS.indexOf(changed) >= LAB_STEPS.indexOf("fit")) {
          liveControls = controls2;
          message("\u0E04\u0E48\u0E32\u0E02\u0E31\u0E49\u0E19 " + changed + " \u0E08\u0E30\u0E43\u0E0A\u0E49\u0E2B\u0E25\u0E31\u0E07\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E08\u0E1A");
          return;
        }
        liveControls = controls2;
        retraceQueued = true;
        state.job.cancelled = true;
        state.child.kill();
        message("\u0E04\u0E48\u0E32\u0E1B\u0E23\u0E31\u0E1A\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E25\u0E49\u0E27 \xB7 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2B\u0E22\u0E38\u0E14\u0E40\u0E2A\u0E49\u0E19\u0E40\u0E01\u0E48\u0E32\u2026");
        return;
      }
      if (state.kind === "capturing") {
        retraceQueued = true;
        return;
      }
      if (state.kind === "applying" || batching) return;
      if (state.kind !== "preview") return;
      const current = state.job;
      const controls = readControls(ui);
      if (current === null) {
        if (fixtureControls === null || latestVectors === null || sameControls(fixtureControls, controls)) return;
        if (edited) {
          message("\u0E41\u0E01\u0E49\u0E0A\u0E34\u0E49\u0E19\u0E41\u0E25\u0E49\u0E27 \u0E08\u0E36\u0E07\u0E44\u0E21\u0E48\u0E40\u0E02\u0E35\u0E22\u0E19\u0E17\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02 \u0E08\u0E19\u0E01\u0E27\u0E48\u0E32\u0E08\u0E30\u0E41\u0E1B\u0E25\u0E07\u0E43\u0E2B\u0E21\u0E48", true);
          return;
        }
        const svg = latestVectors.trace;
        const styled = styleLabVectors(svg, controls, null, null);
        latestVectors = { trace: svg, ...styled };
        fixtureControls = controls;
        const nextPreview = { ...state, dataUrl: svgDataUrl(styled.sealed), svgText: styled.sealed, facts: scoreSvg(styled.sealed) };
        state = { kind: "preview", ...nextPreview };
        latestPreview = nextPreview;
        render();
        return;
      }
      if (!fs.existsSync(current.pngPath)) return;
      retraceQueued = false;
      const previous = state;
      if (sameControls(current.controls, controls)) return;
      const from = earliestChangedStep(current.controls, controls);
      if (LAB_STEPS.indexOf(from) >= LAB_STEPS.indexOf("fit")) {
        updateStylePreview(from, controls);
        return;
      }
      const job = {
        id: current.id,
        directory: current.directory,
        pngPath: current.pngPath,
        svgPath: current.svgPath,
        settings: settingsFromControls(controls),
        controls,
        placementBounds: current.placementBounds,
        cancelled: false
      };
      try {
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E04\u0E33\u0E19\u0E27\u0E13\u0E02\u0E31\u0E49\u0E19 " + from + " \u0E41\u0E25\u0E49\u0E27\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E43\u0E2B\u0E21\u0E48\u2026");
        await vectorize(previous.selection, job, void 0, latestPlan, from);
      } catch (error) {
        state = previous;
        latestPreview = previous;
        if (job.cancelled && retraceQueued) {
          retraceQueued = false;
          await retraceFromCapture();
          return;
        }
        hideProgress();
        liveControls = null;
        message(errorMessage(error), true);
        render();
      }
      if (retraceQueued) {
        retraceQueued = false;
        void retraceFromCapture();
      }
    }
    function loadFixture() {
      const radians = 15 * Math.PI / 180;
      let stair = "M88,18";
      for (let step = 0; step < 14; step += 1) stair += " h1 v1";
      const kink = "M88,78 L98,78 L" + (98 + 10 * Math.cos(radians)).toFixed(2) + "," + (78 - 10 * Math.sin(radians)).toFixed(2);
      const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><path fill="#d6363e" d="M8,8 H58 V58 H8 Z"/><path fill="#2e66d6" d="' + stair + '"/><path fill="#f2b830" d="' + kink + '"/></svg>';
      edited = false;
      const width = 80;
      const height = 48;
      const rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const color = x < 27 ? [214, 54, 62] : x < 54 ? [46, 102, 214] : [242, 184, 48];
          const offset = (y * width + x) * 4;
          rgba[offset] = color[0] ?? 0;
          rgba[offset + 1] = color[1] ?? 0;
          rgba[offset + 2] = color[2] ?? 0;
          rgba[offset + 3] = 255;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      let pngUrl = "";
      if (context !== null) {
        const image = context.createImageData(width, height);
        image.data.set(rgba);
        context.putImageData(image, 0, 0);
        pngUrl = canvas.toDataURL("image/png");
      }
      const styled = styleLabVectors(svgText, readControls(ui), null, null);
      latestVectors = { trace: svgText, ...styled };
      fixtureControls = readControls(ui);
      state = {
        kind: "preview",
        selection: {
          documentName: "\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07",
          documentIdentity: "fixture",
          itemName: "\u0E20\u0E32\u0E1E\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07",
          itemType: "RasterItem",
          uuid: "fixture",
          bounds: [0, 100, 160, 0],
          widthPt: 160,
          heightPt: 100,
          embedded: true,
          fromResult: false
        },
        job: null,
        dataUrl: svgDataUrl(styled.sealed),
        pngUrl,
        svgText: styled.sealed,
        raster: { width, height, rgba },
        placementBounds: [0, 100, 160, 0],
        facts: scoreSvg(styled.sealed)
      };
      latestPreview = state;
      message("\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E43\u0E19\u0E40\u0E1A\u0E23\u0E32\u0E27\u0E4C\u0E40\u0E0B\u0E2D\u0E23\u0E4C: \u0E25\u0E32\u0E01\u0E08\u0E38\u0E14 \u0E25\u0E1A\u0E0A\u0E34\u0E49\u0E19 \u0E2B\u0E23\u0E37\u0E2D\u0E23\u0E30\u0E1A\u0E32\u0E22\u0E2A\u0E35\u0E44\u0E14\u0E49");
      render();
    }
    ui.refresh.addEventListener("click", () => {
      void refresh();
    });
    ui.cropStart.addEventListener("click", () => {
      void openCropEditor();
    });
    ui.cropAgain.addEventListener("click", () => {
      void openCropEditor();
    });
    ui.useFullImage.addEventListener("click", () => {
      void acceptFullImage();
    });
    ui.cropApply.addEventListener("click", async () => {
      try {
        if (await applyCropSelection()) message("\u0E43\u0E0A\u0E49\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E04\u0E23\u0E2D\u0E1B\u0E41\u0E25\u0E49\u0E27 \xB7 \u0E01\u0E14\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E41\u0E1B\u0E25\u0E07");
      } catch (error) {
        message(errorMessage(error), true);
      }
    });
    ui.cropCancel.addEventListener("click", () => {
      cropDraft = null;
      cropDrag = null;
      render();
    });
    ui.cropClear.addEventListener("click", () => {
      void clearCropSelection();
    });
    function cropPoint(event) {
      if (capturedImage === null) return null;
      const bounds2 = ui.selectionCropOverlay.getBoundingClientRect();
      if (bounds2.width <= 0 || bounds2.height <= 0) return null;
      return thumbnailPointToSourcePixels(
        { x: event.clientX - bounds2.left, y: event.clientY - bounds2.top },
        { width: bounds2.width, height: bounds2.height },
        capturedImage.size
      );
    }
    ui.selectionCropOverlay.addEventListener("pointerdown", (event) => {
      if (cropDraft === null || capturedImage === null) return;
      const point2 = cropPoint(event);
      if (point2 === null) return;
      const target = event.target instanceof SVGElement ? event.target : null;
      const handle = target?.dataset.handle;
      const initialRect = cropDraft.rect;
      if (isCropHandle(handle)) {
        cropDrag = { kind: "resize", pointerId: event.pointerId, start: point2, initialRect, handle };
      } else if (target !== null && target.closest(".crop-selection") !== null) {
        cropDrag = { kind: "move", pointerId: event.pointerId, start: point2, initialRect };
      } else {
        cropDrag = { kind: "draw", pointerId: event.pointerId, start: point2, initialRect };
      }
      ui.selectionCropOverlay.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    ui.selectionCropOverlay.addEventListener("pointermove", (event) => {
      if (cropDrag === null || cropDrag.pointerId !== event.pointerId || capturedImage === null) return;
      const point2 = cropPoint(event);
      if (point2 === null) return;
      const deltaX = point2.x - cropDrag.start.x;
      const deltaY = point2.y - cropDrag.start.y;
      let rect;
      if (cropDrag.kind === "draw") {
        rect = clampCropRect({ x: cropDrag.start.x, y: cropDrag.start.y, width: deltaX, height: deltaY }, capturedImage.size);
      } else if (cropDrag.kind === "move") {
        rect = moveCropRect(cropDrag.initialRect, deltaX, deltaY, capturedImage.size);
      } else {
        rect = resizeCropRect(cropDrag.initialRect, cropDrag.handle, deltaX, deltaY, capturedImage.size);
      }
      cropDraft = { rect };
      render();
    });
    function endCropDrag(event) {
      if (cropDrag === null || cropDrag.pointerId !== event.pointerId) return;
      cropDrag = null;
      render();
    }
    ui.selectionCropOverlay.addEventListener("pointerup", endCropDrag);
    ui.selectionCropOverlay.addEventListener("pointercancel", endCropDrag);
    for (const card of ui.presetCards) {
      card.addEventListener("click", () => {
        const option = PRESET_PRESENTATION.find((candidate) => candidate.preset === card.dataset.preset);
        if (option !== void 0) choosePreset(option.preset);
      });
    }
    ui.presetConfirmApply.addEventListener("click", () => {
      if (pendingPreset !== null) activatePreset(pendingPreset);
    });
    ui.presetConfirmCancel.addEventListener("click", () => {
      pendingPreset = null;
      render();
    });
    for (const [field, status] of ui.controlStatus) {
      status.reset.addEventListener("click", () => {
        if (presetState.kind === "unselected") return;
        const reset = resetPresetControl(presetState, field);
        presetState = reset;
        if (reset.kind === "selected") applyControls(ui, reset.controls);
        render();
        scheduleRetrace();
      });
    }
    ui.trace.addEventListener("click", () => {
      void trace();
    });
    ui.apply.addEventListener("click", () => {
      void apply();
    });
    ui.batch.addEventListener("click", () => {
      void batch();
    });
    ui.brushTrace.addEventListener("click", () => {
      void retraceBrush();
    });
    ui.cancel.addEventListener("click", () => {
      stopBatch = true;
      if (state.kind === "planning") {
        retraceQueued = false;
        window.clearTimeout(retraceTimer);
        state.job.cancelled = true;
        state.runner.cancel();
        hideProgress();
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
        return;
      }
      if (state.kind !== "tracing") return;
      retraceQueued = false;
      window.clearTimeout(retraceTimer);
      state.job.cancelled = true;
      state.child.kill();
      hideProgress();
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
    });
    const modeField = ui.controls.mode;
    for (const field of Object.values(ui.controls)) {
      if (field === modeField) continue;
      field.addEventListener("input", () => {
        if (field === ui.controls.stacking) ui.controls.sealWidth.value = field.value === "cutout" ? "2" : "0.8";
        syncOutputs();
        presetState = updatePresetControls(presetState, readControls(ui));
        render();
        scheduleRetrace();
      });
      field.addEventListener("change", () => {
        if (field === ui.controls.stacking) ui.controls.sealWidth.value = field.value === "cutout" ? "2" : "0.8";
        syncOutputs();
        presetState = updatePresetControls(presetState, readControls(ui));
        render();
        scheduleRetrace();
      });
    }
    ui.reset.addEventListener("click", () => {
      presetState = resetPresetControls(presetState);
      if (presetState.kind === "selected") applyControls(ui, presetState.controls);
      render();
      scheduleRetrace();
    });
    for (const button of ui.stepButtons) {
      button.addEventListener("click", () => {
        const step = button.dataset.step;
        if (!isLabStep(step)) return;
        selectedStep = reduceActiveStep(selectedStep, { kind: "tab-selected", step });
        render();
      });
    }
    ui.viewPixels.addEventListener("click", () => {
      view = "pixels";
      if (tool === "drag" || tool === "erase") tool = "none";
      render();
    });
    ui.viewVectors.addEventListener("click", () => {
      view = "vector";
      if (tool === "brush") tool = "none";
      render();
    });
    ui.zoomIn.addEventListener("click", () => {
      zoom = zoom === 1 ? 2 : 4;
      render();
    });
    ui.zoomOut.addEventListener("click", () => {
      zoom = zoom === 4 ? 2 : 1;
      render();
    });
    ui.toolDrag.addEventListener("click", () => {
      chooseTool("drag", "\u0E25\u0E32\u0E01\u0E08\u0E38\u0E14 \u0E2B\u0E23\u0E37\u0E2D\u0E43\u0E0A\u0E49\u0E1B\u0E38\u0E48\u0E21\u0E25\u0E39\u0E01\u0E28\u0E23\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E08\u0E38\u0E14\u0E16\u0E39\u0E01\u0E40\u0E25\u0E37\u0E2D\u0E01");
    });
    ui.toolErase.addEventListener("click", () => {
      chooseTool("erase", "\u0E41\u0E15\u0E30\u0E0A\u0E34\u0E49\u0E19\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E25\u0E1A");
    });
    ui.toolBrush.addEventListener("click", () => {
      chooseTool("brush", "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E35\u0E08\u0E32\u0E01\u0E41\u0E16\u0E1A \u0E41\u0E25\u0E49\u0E27\u0E23\u0E30\u0E1A\u0E32\u0E22\u0E1A\u0E19\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25");
    });
    ui.brushCanvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || brushColor === null) return;
      ui.brushCanvas.setPointerCapture(event.pointerId);
      paintEvent(event);
    });
    ui.brushCanvas.addEventListener("pointermove", (event) => {
      if (!ui.brushCanvas.hasPointerCapture(event.pointerId)) return;
      paintEvent(event);
    });
    window.addEventListener("beforeunload", () => {
      if ((state.kind === "preview" || state.kind === "applying") && state.job !== null) cleanJob(state.job);
      if (state.kind === "tracing") {
        state.job.cancelled = true;
        state.child.kill();
        cleanJob(state.job);
      }
      if (state.kind === "planning") {
        state.job.cancelled = true;
        state.runner.cancel();
        cleanJob(state.job);
      }
    });
    if (browserFixture) {
      const selected = selectPreset("logo");
      presetState = selected;
      applyControls(ui, selected.controls);
    } else {
      applyControls(ui, controlsFor(readControls(ui).mode));
    }
    if (host !== null) {
      cleanStaleJobs();
      render();
      void refresh();
    } else if (browserFixture) {
      loadFixture();
    } else {
      render();
      message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
    }
  }
  function showFatal(error) {
    const status = document.getElementById("status");
    if (status === null) return;
    status.textContent = "Panel \u0E02\u0E31\u0E14\u0E02\u0E49\u0E2D\u0E07: " + (error instanceof Error ? error.message : String(error));
    status.classList.add("error");
  }
  window.addEventListener("error", (event) => {
    showFatal(event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    showFatal(event.reason);
  });
  try {
    start();
  } catch (error) {
    showFatal(error);
  }
})();

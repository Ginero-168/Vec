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
  var import_worker_threads = __require("worker_threads");
  var crypto = __toESM(__require("crypto"));
  var fs = __toESM(__require("fs"));
  var os = __toESM(__require("os"));
  var path = __toESM(__require("path"));

  // src/edit.ts
  var ARG_COUNT = { m: 2, l: 2, h: 1, v: 1, c: 6, z: 0 };
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
        const point = pointOf(parsed, locations[anchorIndex]);
        if (point === null) continue;
        anchors.push({ pathIndex, anchorIndex, x: point.x, y: point.y });
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
    const hex = match[1] ?? "";
    return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
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
      const point = points[pointIndex];
      if (point === void 0) continue;
      const gap = distanceToSegment(point, start2, end);
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
        const point = points[index];
        if (point === void 0) continue;
        const gap = distance(origin, point);
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
      const point = points[index];
      if (point === void 0) continue;
      const gap = distance(start2, point);
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
      const point = samples[index];
      if (point === void 0) continue;
      const error = distanceToSegment(point, first, end);
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
    for (let sampleIndex = 1; sampleIndex < samples.length - 1; sampleIndex += 1) {
      const point = samples[sampleIndex];
      if (point === void 0) continue;
      const error = distanceToCubic(point, cubic);
      if (error > distanceWorst) {
        distanceWorst = error;
        index = sampleIndex;
      }
    }
    return { distance: distanceWorst, index };
  }
  function maxSegmentDistance(samples, start2, end) {
    let worst = 0;
    for (const point of samples) worst = Math.max(worst, distanceToSegment(point, start2, end));
    return worst;
  }
  function distanceToSegment(point, start2, end) {
    const dx = end.x - start2.x;
    const dy = end.y - start2.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-8) return distance(point, start2);
    const t = Math.min(1, Math.max(0, ((point.x - start2.x) * dx + (point.y - start2.y) * dy) / lengthSquared));
    return distance(point, { x: start2.x + dx * t, y: start2.y + dy * t });
  }
  function distanceToCubic(point, cubic) {
    let best = Infinity;
    for (let step = 0; step <= 24; step += 1) {
      best = Math.min(best, distance(point, bezier(cubic, step / 24)));
    }
    return best;
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
    for (const sample of samples) worst = Math.max(worst, distanceToCubic(sample, cubic));
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
  function unit(point) {
    const length = lengthOf(point);
    if (length < 1e-6) return null;
    return { x: point.x / length, y: point.y / length };
  }
  function lengthOf(point) {
    return Math.hypot(point.x, point.y);
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
  function shift(point, dx, dy) {
    return { x: point.x + dx, y: point.y + dy };
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
  function pair(point) {
    return fmt(point.x) + "," + fmt(point.y);
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

  // src/png-alpha.ts
  var zlib = __toESM(__require("zlib"));
  function pngSignature() {
    return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  }
  var CRC_TABLE = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
    CRC_TABLE[index] = value;
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
    for (const point of measured.samples) {
      if (point.x <= 1) left = true;
      if (point.y <= 1) top = true;
      if (point.x >= width - 1) right = true;
      if (point.y >= height - 1) bottom = true;
    }
    return Number(left) + Number(right) + Number(top) + Number(bottom);
  }
  function samePaint(fill, border) {
    if (fill === border) return true;
    const left = rgbOf(fill);
    const right = rgbOf(border);
    if (left === null || right === null) return false;
    return Math.abs(left[0] - right[0]) <= 18 && Math.abs(left[1] - right[1]) <= 18 && Math.abs(left[2] - right[2]) <= 18;
  }
  function rgbOf(fill) {
    const match = /^#([0-9a-f]{6})$/i.exec(fill);
    if (match === null) return null;
    const hex = match[1] ?? "";
    return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
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
    let result = "";
    let cursor = 0;
    for (const tag of tags) {
      result += svg.slice(cursor, tag.index);
      result += fittedMarkup(tag) ?? tag.source;
      cursor = tag.index + tag.length;
    }
    return result + svg.slice(cursor);
  }
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
  function fittedMarkup(tag) {
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
    const circle = fitCircle(measured);
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
    for (const point of measured.samples) {
      const nearLeft = Math.abs(point.x - measured.minX);
      const nearRight = Math.abs(point.x - measured.maxX);
      const nearTop = Math.abs(point.y - measured.minY);
      const nearBottom = Math.abs(point.y - measured.maxY);
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
    for (const point of measured.samples) {
      const qx = Math.abs(point.x - cx) - (halfW - radius);
      const qy = Math.abs(point.y - cy) - (halfH - radius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      maxError = Math.max(maxError, Math.abs(outside + inside - radius));
      if (qx > 0.4 && qy > 0.4) arc = true;
      if (qx <= 0.4 && qy > radius * 0.4 || qy <= 0.4 && qx > radius * 0.4) side = true;
    }
    return arc && side ? maxError : null;
  }
  function fitCircle(measured) {
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
    for (const point of points) {
      const x = point.x;
      const y = point.y;
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
    for (const point of points) radius += Math.hypot(point.x - cx, point.y - cy);
    radius /= count;
    if (!(radius > 1.5)) return null;
    let maxError = 0;
    for (const point of points) maxError = Math.max(maxError, Math.abs(Math.hypot(point.x - cx, point.y - cy) - radius));
    if (maxError > Math.max(1.25, radius * 0.04)) return null;
    const expected = Math.PI * radius * radius;
    if (Math.abs(measured.area - expected) / expected > 0.12) return null;
    return { cx, cy, r: radius };
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
    for (const point of measured.samples) {
      maxError = Math.max(maxError, Math.abs(Math.hypot((point.x - cx) / rx, (point.y - cy) / ry) - 1));
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
      const hex = short[1] ?? "";
      return "#" + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
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
    function track(point) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
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
        const point = { x, y };
        open.push(point);
        track(point);
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
          const point = bezier2(start2, cubic.p1, cubic.p2, cubic.p3, t);
          open.push(point);
          track(point);
        }
        prevControl = cubic.control;
        addAnchor(cubic.p3.x, cubic.p3.y, true);
      } else if (op === "a") {
        const end = arcEnd(relative, args, cx, cy);
        addAnchor(end.x, end.y, false);
      } else if (op === "z") {
        if (Math.hypot(cx - sx, cy - sy) >= 0.05) {
          const point = { x: sx, y: sy };
          open.push(point);
          track(point);
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
  function reflect(control, point) {
    if (control === null) return point;
    return { x: point.x * 2 - control.x, y: point.y * 2 - control.y };
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
    for (const point of points) {
      x += point.x;
      y += point.y;
    }
    const count = points.length || 1;
    return { x: x / count, y: y / count };
  }
  function pointInPoly(point, poly) {
    let inside = false;
    for (let index = 0, previous = poly.length - 1; index < poly.length; previous = index, index += 1) {
      const current = poly[index];
      const prior = poly[previous];
      if (current === void 0 || prior === void 0) continue;
      const crosses = current.y > point.y !== prior.y > point.y;
      if (!crosses) continue;
      const x = (prior.x - current.x) * (point.y - current.y) / (prior.y - current.y) + current.x;
      if (point.x < x) inside = !inside;
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
    return fitGeometry ? fitShapes(merged) : merged;
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
  function vectorStagesFromPlan(svgs, plates, width, height, droppedColor, controls) {
    const trace = mergePlates(svgs, plates, width, height, null, false, false);
    const fitted = mergePlates(svgs, plates, width, height, droppedColor, controls.dropPlate, controls.fitGeometry);
    const faired = fairLabVector(fitted, controls);
    const sealed = sealLabVector(faired, controls);
    return { trace, fitted, faired, sealed };
  }

  // src/trace-pipeline.ts
  function vectorStagesForPlan(svgs, plan, controls) {
    return vectorStagesFromPlan(svgs, plan.plates, plan.width, plan.height, plan.droppedColor, controls);
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

  // src/panel.ts
  var HostTimeoutError = class extends Error {
    constructor() {
      super("Illustrator \u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E20\u0E32\u0E22\u0E43\u0E19\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E01\u0E33\u0E2B\u0E19\u0E14");
    }
  };
  function parsePlanWorkerMessage(value) {
    if (!isRecord(value)) return null;
    if (value.kind === "error" && typeof value.error === "string") return { kind: "error", error: value.error };
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
      request
    };
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
    return {
      selection: getElement("selection"),
      status: getElement("status"),
      phase: getElement("phase"),
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
      controls: {
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
      },
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
  function newJob(settings, controls) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vector-panel-"));
    return {
      id: crypto.randomBytes(8).toString("hex"),
      directory,
      pngPath: path.join(directory, "source.png"),
      svgPath: path.join(directory, "result.svg"),
      settings,
      controls,
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
  function showSelection(ui, selection) {
    ui.selection.replaceChildren();
    if (selection === null) {
      ui.selection.textContent = "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E20\u0E32\u0E1E\u0E2B\u0E23\u0E37\u0E2D\u0E01\u0E25\u0E38\u0E48\u0E21\u0E1A\u0E19 artboard";
      return;
    }
    const title = document.createElement("strong");
    title.textContent = selection.itemName || selection.itemType;
    const detail = document.createElement("small");
    const kind = selection.itemType === "GroupItem" ? "\u0E01\u0E25\u0E38\u0E48\u0E21" : selection.itemType === "PlacedItem" ? "linked" : selection.embedded ? "embedded" : "raster";
    detail.textContent = selection.documentName + " \xB7 " + kind + " \xB7 " + Math.round(selection.widthPt) + " \xD7 " + Math.round(selection.heightPt) + " pt";
    if (selection.fromResult) detail.textContent += " \xB7 \u0E41\u0E1B\u0E25\u0E07\u0E0B\u0E49\u0E33\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48";
    ui.selection.append(title, detail);
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
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  }
  function start() {
    const ui = getUi();
    let state = { kind: "empty" };
    let view = "vector";
    let zoom = 1;
    let tool = "none";
    let brushColor = null;
    let brushPixels = null;
    let batching = false;
    let stopBatch = false;
    let pendingFocus = null;
    let edited = false;
    let selectedStep = "colors";
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
      if (state.job !== null) fs.writeFileSync(state.job.svgPath, svgText);
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
              const point = points[index];
              if (point === void 0) return;
              node.setAttribute("cx", String(point.x));
              node.setAttribute("cy", String(point.y));
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
            const point = svgPoint(svg, event);
            if (point === null) return;
            follow(moveAnchor(live, currentPath, anchor.anchorIndex, point.x, point.y));
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
      showSelection(ui, currentSelection(state));
      const busy = batching || state.kind === "loading" || state.kind === "capturing" || state.kind === "planning" || state.kind === "tracing" || state.kind === "applying";
      ui.refresh.disabled = busy;
      ui.trace.disabled = busy || state.kind === "empty";
      ui.batch.disabled = busy;
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
    function planInWorker(selection, job, sourcePng, previousPlan, from) {
      const worker = new import_worker_threads.Worker(path.join(extensionPath, "js", "pipeline-worker.js"));
      liveControls = job.controls;
      state = { kind: "planning", selection, job, worker, from };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E41\u0E25\u0E30\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E02\u0E31\u0E49\u0E19\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u2026");
      render();
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (plan) => {
          if (settled) return;
          settled = true;
          void worker.terminate();
          resolve(plan);
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          void worker.terminate();
          reject(error);
        };
        worker.once("message", (value) => {
          if (job.cancelled) {
            fail(new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27"));
            return;
          }
          const result = parsePlanWorkerMessage(value);
          if (result === null) {
            fail(new Error("\u0E1C\u0E25\u0E08\u0E32\u0E01\u0E02\u0E31\u0E49\u0E19\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07"));
          } else if (result.kind === "error") {
            fail(new Error(result.error));
          } else {
            finish(result.plan);
          }
        });
        worker.once("error", (error) => fail(error));
        worker.once("exit", (code) => {
          if (!settled) fail(new Error(job.cancelled ? "\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27" : "\u0E02\u0E31\u0E49\u0E19\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E2B\u0E22\u0E38\u0E14\u0E01\u0E48\u0E2D\u0E19\u0E08\u0E1A (" + String(code) + ")"));
        });
        worker.postMessage({
          sourcePng: new Uint8Array(sourcePng),
          settings: job.settings,
          controls: job.controls,
          previousStages: previousPlan?.rasterStages ?? null,
          from
        });
      });
    }
    async function vectorize(selection, job, palette, previousPlan = null, from = "colors") {
      if (!fs.existsSync(job.pngPath) || fs.statSync(job.pngPath).size === 0) throw new Error("Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E20\u0E32\u0E1E PNG \u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32");
      const binary = resolveVtracer(path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer"));
      if (!fs.existsSync(binary)) throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A VTracer \u0E17\u0E35\u0E48 " + binary);
      const sourcePng = fs.readFileSync(job.pngPath);
      liveControls = job.controls;
      let plan = previousPlan !== null && from === "trace" ? replanTracePlan(previousPlan, job.controls) : await planInWorker(selection, job, sourcePng, previousPlan, from);
      const controls = liveControls ?? job.controls;
      job = { ...job, controls, settings: settingsFromControls(controls) };
      if (plan !== null) plan = replanTracePlan(plan, controls);
      if (plan === null || plan.plates.length === 0) throw new Error("\u0E2D\u0E48\u0E32\u0E19 PNG \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
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
        await runVtracer(binary, job, pngPath, svgPath, request, (child) => {
          state = { kind: "tracing", selection, job, child };
          render();
        });
        svgs.push(fs.readFileSync(svgPath, "utf8"));
      }
      const finishedControls = liveControls ?? job.controls;
      job = { ...job, controls: finishedControls, settings: settingsFromControls(finishedControls) };
      edited = false;
      latestPlan = plan;
      latestSvgs = svgs;
      latestVectors = vectorStagesForPlan(svgs, plan, job.controls);
      const svgText = latestVectors.sealed;
      fs.writeFileSync(job.svgPath, svgText);
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
        facts: scoreSvg(svgText)
      };
      selectedStep = "seal";
      latestPreview = state;
      liveControls = null;
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
      latestPlan = null;
      latestSvgs = [];
      latestVectors = null;
      latestPreview = null;
      liveControls = null;
      state = { kind: "loading" };
      render();
      try {
        const selection = parseSelection(await callHost(host, "VP_snapshot"));
        state = { kind: "selected", selection };
        message("\u0E20\u0E32\u0E1E\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E41\u0E1B\u0E25\u0E07");
      } catch (error) {
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
      if (state.kind === "preview" && state.job !== null) cleanJob(state.job);
      latestPlan = null;
      latestSvgs = [];
      latestVectors = null;
      latestPreview = null;
      liveControls = null;
      const controls = readControls(ui);
      let job = newJob(settingsFromControls(controls), controls);
      try {
        state = { kind: "capturing", selection, job };
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Illustrator\u2026");
        render();
        await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
        const capturedControls = readControls(ui);
        job = { ...job, settings: settingsFromControls(capturedControls), controls: capturedControls, cancelled: false };
        retraceQueued = false;
        while (true) {
          try {
            await vectorize(selection, job);
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
      if (!batching && !sameControls(state.job.controls, readControls(ui))) {
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E1B\u0E23\u0E31\u0E1A\u0E1C\u0E25\u0E43\u0E2B\u0E49\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A\u0E04\u0E48\u0E32\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14\u2026");
        scheduleRetrace();
        render();
        return false;
      }
      const preview = state;
      const job = state.job;
      state = { ...preview, kind: "applying" };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E19\u0E33 path \u0E40\u0E02\u0E49\u0E32 Illustrator\u2026");
      render();
      try {
        const result = await callHost(host, "VP_commit", [preview.selection.uuid, job.svgPath, job.id, settingsNote(job.settings), preview.selection.bounds.join(","), preview.selection.documentIdentity]);
        message("\u0E43\u0E2A\u0E48\u0E1C\u0E25\u0E41\u0E25\u0E49\u0E27: " + (result[1] ?? "0") + " paths \xB7 \u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E22\u0E31\u0E07\u0E2D\u0E22\u0E39\u0E48");
        cleanJob(job);
        state = { kind: "selected", selection: preview.selection };
        render();
        return true;
      } catch (error) {
        if (error instanceof HostTimeoutError) {
          message("Illustrator \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A \u0E15\u0E23\u0E27\u0E08 Layers \u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E25\u0E0B\u0E49\u0E33", true);
          state = { kind: "selected", selection: preview.selection };
        } else {
          message(errorMessage(error), true);
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
          const job = newJob(settingsFromControls(controls), controls);
          message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E1B\u0E25\u0E07\u0E20\u0E32\u0E1E " + String(finished + 1) + "/" + String(list.items.length) + " \xB7 " + selection.itemName);
          state = { kind: "capturing", selection, job };
          render();
          try {
            await callHost(host, "VP_capture", [item.uuid, job.pngPath, list.documentIdentity, "1"]);
            await vectorize(selection, job);
            const placed = await apply();
            if (!placed) return;
            finished += 1;
          } catch (error) {
            cleanJob(job);
            throw error;
          }
        }
        message(stopBatch ? "\u0E2B\u0E22\u0E38\u0E14\u0E17\u0E35\u0E48\u0E20\u0E32\u0E1E " + String(finished) : "\u0E41\u0E1B\u0E25\u0E07\u0E04\u0E23\u0E1A " + String(finished) + " \u0E20\u0E32\u0E1E");
      } catch (error) {
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
      const job = { ...currentJob, settings: settingsFromControls(controls), controls };
      let vectors = latestVectors;
      if (from === "fit") {
        vectors = vectorStagesForPlan(latestSvgs, latestPlan, controls);
      } else if (from === "fair") {
        const faired = fairLabVector(vectors.fitted, controls);
        vectors = { ...vectors, faired, sealed: sealLabVector(faired, controls) };
      } else {
        vectors = { ...vectors, sealed: sealLabVector(vectors.faired, controls) };
      }
      latestVectors = vectors;
      fs.writeFileSync(job.svgPath, vectors.sealed);
      const nextPreview = { ...previous, job, svgText: vectors.sealed, facts: scoreSvg(vectors.sealed), dataUrl: svgDataUrl(vectors.sealed) };
      state = { kind: "preview", ...nextPreview };
      latestPreview = nextPreview;
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
        void state.worker.terminate();
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
      selectedStep = "seal";
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
        facts: scoreSvg(styled.sealed)
      };
      latestPreview = state;
      message("\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E43\u0E19\u0E40\u0E1A\u0E23\u0E32\u0E27\u0E4C\u0E40\u0E0B\u0E2D\u0E23\u0E4C: \u0E25\u0E32\u0E01\u0E08\u0E38\u0E14 \u0E25\u0E1A\u0E0A\u0E34\u0E49\u0E19 \u0E2B\u0E23\u0E37\u0E2D\u0E23\u0E30\u0E1A\u0E32\u0E22\u0E2A\u0E35\u0E44\u0E14\u0E49");
      render();
    }
    ui.refresh.addEventListener("click", () => {
      void refresh();
    });
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
        void state.worker.terminate();
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
        return;
      }
      if (state.kind !== "tracing") return;
      retraceQueued = false;
      window.clearTimeout(retraceTimer);
      state.job.cancelled = true;
      state.child.kill();
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
    });
    const modeField = ui.controls.mode;
    for (const field of Object.values(ui.controls)) {
      if (field === modeField) continue;
      field.addEventListener("input", () => {
        if (field === ui.controls.stacking) ui.controls.sealWidth.value = field.value === "cutout" ? "2" : "0.8";
        syncOutputs();
        render();
        scheduleRetrace();
      });
      field.addEventListener("change", () => {
        if (field === ui.controls.stacking) ui.controls.sealWidth.value = field.value === "cutout" ? "2" : "0.8";
        syncOutputs();
        render();
        scheduleRetrace();
      });
    }
    modeField.addEventListener("change", () => {
      const mode = modeField.value;
      if (mode !== "logo" && mode !== "icon" && mode !== "photo" && mode !== "poster") return;
      applyControls(ui, controlsFor(mode));
      render();
      scheduleRetrace();
    });
    ui.reset.addEventListener("click", () => {
      applyControls(ui, controlsFor(readControls(ui).mode));
      render();
      scheduleRetrace();
    });
    for (const button of ui.stepButtons) {
      button.addEventListener("click", () => {
        const step = LAB_STEPS.find((candidate) => candidate === button.dataset.step);
        if (step === void 0) return;
        selectedStep = step;
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
        void state.worker.terminate();
        cleanJob(state.job);
      }
    });
    applyControls(ui, controlsFor(readControls(ui).mode));
    if (host !== null) {
      cleanStaleJobs();
      render();
      void refresh();
    } else if (new URLSearchParams(window.location.search).get("fixture") === "1") {
      loadFixture();
    } else {
      render();
      message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
    }
  }
  start();
})();

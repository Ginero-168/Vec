"use strict";
(() => {
  // src/edit.ts
  var ARG_COUNT = { m: 2, l: 2, h: 1, v: 1, c: 6, z: 0 };
  function shapePattern() {
    return /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;
  }
  function fairTolerance(smoothness) {
    const clamped = Math.min(3, Math.max(0, Number.isFinite(smoothness) ? smoothness : 0));
    return Math.round((0.4 + clamped * 2.2) * 100) / 100;
  }
  function fairPaths(svg2, options) {
    const tolerance = options.tolerance ?? fairTolerance(options.smoothness);
    const minTurn = 90 - Math.min(90, Math.max(0, Number.isFinite(options.cornerDegrees) ? options.cornerDegrees : 0));
    return svg2.replace(shapePattern(), (tag) => {
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
  function listAnchors(svg2) {
    const anchors = [];
    let pathIndex = 0;
    for (const tag of svg2.match(shapePattern()) ?? []) {
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
      const start = points[from];
      const end = points[to];
      if (chain.length > 1 && start !== void 0 && end !== void 0) cubics.push(straightCubic(start, end));
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
    const start = points[from];
    const end = points[to];
    if (start === void 0 || end === void 0) return;
    let worst = 0;
    let at = -1;
    for (let index = 1; index < chain.length - 1; index += 1) {
      const pointIndex = chain[index] ?? 0;
      const point = points[pointIndex];
      if (point === void 0) continue;
      const gap = distanceToSegment(point, start, end);
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
    for (let start = 0; start < points.length; start += 1) {
      const origin = points[start];
      if (origin === void 0) continue;
      for (let index = start + 1; index < points.length; index += 1) {
        const point = points[index];
        if (point === void 0) continue;
        const gap = distance(origin, point);
        if (gap > best) {
          best = gap;
          left = start;
          right = index;
        }
      }
    }
    return uniqueSorted([left, right]);
  }
  function farthestIndex(points, origin) {
    const start = points[origin];
    if (start === void 0) return origin;
    let best = 0;
    let at = origin;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (point === void 0) continue;
      const gap = distance(start, point);
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
  function maxSegmentDistance(samples, start, end) {
    let worst = 0;
    for (const point of samples) worst = Math.max(worst, distanceToSegment(point, start, end));
    return worst;
  }
  function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-8) return distance(point, start);
    const t = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
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
  function straightCubic(start, end) {
    return {
      p0: start,
      p1: { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 },
      p2: { x: start.x + 2 * (end.x - start.x) / 3, y: start.y + 2 * (end.y - start.y) / 3 },
      p3: end
    };
  }
  function fitCubic(samples, tanStart, tanEnd) {
    const start = samples[0];
    const end = samples[samples.length - 1];
    if (start === void 0 || end === void 0) return straightCubic(start ?? { x: 0, y: 0 }, end ?? { x: 0, y: 0 });
    const fallback = cubicFromTangents(start, end, tanStart, tanEnd);
    const startDir = unit(tanStart);
    const endDir = unit(tanEnd);
    if (startDir === null || endDir === null || samples.length < 4) return fallback;
    const parameters = chordParameters(samples);
    const solved = solveCubic(samples, parameters, start, end, startDir, endDir);
    const refined = solved === null ? null : solveCubic(samples, projectParameters(samples, solved), start, end, startDir, endDir);
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
  function solveCubic(samples, parameters, start, end, startDir, endDir) {
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
      const baseX = (u * u * u + b1) * start.x + (b2 + t * t * t) * end.x;
      const baseY = (u * u * u + b1) * start.y + (b2 + t * t * t) * end.y;
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
    const limit = distance(start, end) * 3;
    if (!(alpha > 0.05) || !(beta > 0.05) || alpha > limit || beta > limit) return null;
    return {
      p0: start,
      p1: { x: start.x + startDir.x * alpha, y: start.y + startDir.y * alpha },
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
  function cubicFromTangents(start, end, tanStart, tanEnd) {
    const handle = distance(start, end) / 3;
    const startDir = unit(tanStart) ?? unit({ x: end.x - start.x, y: end.y - start.y }) ?? { x: 1, y: 0 };
    const endDir = unit(tanEnd) ?? startDir;
    return {
      p0: start,
      p1: { x: start.x + startDir.x * handle, y: start.y + startDir.y * handle },
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
  function line(start, end) {
    return straightCubic(start, end);
  }
  function anchorLocations(subpaths) {
    const locations = [];
    subpaths.forEach((subpath, subIndex) => {
      if (subpath.cubics.length === 0) return;
      locations.push({ subIndex, kind: "start", cubicIndex: 0 });
      subpath.cubics.forEach((cubic, cubicIndex) => {
        const start = subpath.cubics[0]?.p0;
        const closing = subpath.closed && start !== void 0 && cubicIndex === subpath.cubics.length - 1 && distance(cubic.p3, start) < 0.05;
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
  function scoreSvg(svg2) {
    const palette = [];
    const seen = /* @__PURE__ */ new Set();
    let paths = 0;
    let anchors = 0;
    let holes = 0;
    let circles = 0;
    let ellipses = 0;
    let rects = 0;
    let roundRects = 0;
    for (const tag of pathTags(svg2)) {
      const name = elementName(tag.source);
      const attrs = tagAttrs(tag.source);
      const fill = normalizeFill(fillOf(attrs));
      if (name === "path") {
        const data = readAttr(attrs, "d");
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
        const rx = Number(readAttr(attrs, "rx") ?? "0");
        const ry = Number(readAttr(attrs, "ry") ?? "0");
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
  function dropCanvasBackground(svg2, borderColor) {
    if (borderColor === void 0 || borderColor === null || borderColor.trim() === "") return svg2;
    const border = normalizeFill(borderColor);
    if (border === null) return svg2;
    const size = canvasSize(svg2);
    if (size === null) return svg2;
    const matches = pathTags(svg2);
    if (matches.length < 2) return svg2;
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
    let result = svg2;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const tag = matches[index];
      const next = sources[index] ?? "";
      if (tag === void 0 || next === tag.source) continue;
      result = result.slice(0, tag.index) + next + result.slice(tag.index + tag.length);
    }
    return result;
  }
  function borderSplit(source2, border, width2, height2) {
    const attrs = tagAttrs(source2);
    const fill = normalizeFill(fillOf(attrs));
    if (fill === null || !samePaint(fill, border)) return null;
    if (elementName(source2) !== "path") {
      const measured = measureTag({ index: 0, length: source2.length, source: source2 });
      if (measured === null || edgesTouched(measured, width2, height2) < 3) return null;
      return { kept: "", holes: [] };
    }
    const data = readAttr(attrs, "d");
    if (data === null) return null;
    const parts = pathSubpaths(data);
    const pieces = parts.map((part) => ({ part, measured: measurePath(part) }));
    const shells = pieces.filter((piece) => edgesTouched(piece.measured, width2, height2) >= 3);
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
    const at = source2.indexOf(quoted);
    if (at < 0) return { kept: "", holes };
    return { kept: source2.slice(0, at + 1) + kept.map((piece) => piece.part).join(" ") + source2.slice(at + quoted.length - 1), holes };
  }
  function canvasPlateBelow(sources, before, width2, height2, border) {
    for (let index = before - 1; index >= 0; index -= 1) {
      const source2 = sources[index] ?? "";
      if (source2 === "") continue;
      const fill = normalizeFill(fillOf(tagAttrs(source2)));
      if (fill === null || samePaint(fill, border)) continue;
      const data = readAttr(tagAttrs(source2), "d");
      if (data !== null) {
        if (pathSubpaths(data).some((part) => edgesTouched(measurePath(part), width2, height2) >= 3)) return index;
        continue;
      }
      const measured = measureTag({ index: 0, length: source2.length, source: source2 });
      if (measured !== null && edgesTouched(measured, width2, height2) >= 3) return index;
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
  function edgesTouched(measured, width2, height2) {
    let left = false;
    let right = false;
    let top = false;
    let bottom = false;
    for (const point of measured.samples) {
      if (point.x <= 1) left = true;
      if (point.y <= 1) top = true;
      if (point.x >= width2 - 1) right = true;
      if (point.y >= height2 - 1) bottom = true;
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
    const hex3 = match[1] ?? "";
    return [Number.parseInt(hex3.slice(0, 2), 16), Number.parseInt(hex3.slice(2, 4), 16), Number.parseInt(hex3.slice(4, 6), 16)];
  }
  function dropFill(svg2, fill) {
    const target = normalizeFill(fill);
    if (target === null) return svg2;
    const tags = pathTags(svg2);
    const matches = tags.filter((tag) => normalizeFill(fillOf(tagAttrs(tag.source))) === target);
    if (matches.length === 0 || matches.length >= tags.length) return svg2;
    let result = svg2;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const tag = matches[index];
      if (tag === void 0) continue;
      result = result.slice(0, tag.index) + result.slice(tag.index + tag.length);
    }
    return result;
  }
  function fitShapes(svg2) {
    const tags = pathTags(svg2);
    if (tags.length === 0) return svg2;
    let result = "";
    let cursor = 0;
    for (const tag of tags) {
      result += svg2.slice(cursor, tag.index);
      result += fittedMarkup(tag) ?? tag.source;
      cursor = tag.index + tag.length;
    }
    return result + svg2.slice(cursor);
  }
  function sealGaps(svg2, strokeWidth = 0.8) {
    const width2 = Math.round(Math.min(4, Math.max(0.8, strokeWidth)) * 10) / 10;
    return svg2.replace(/<(path|circle|ellipse|rect)\b([^>]*?)\s*(\/?)\s*>/gi, (full, name, attrs, slash) => {
      if (/\bstroke\s*=/i.test(attrs)) return full;
      const fill = fillOf(attrs);
      const paint = normalizeFill(fill);
      if (fill === null || paint === null) return full;
      return "<" + name + attrs + ' stroke="' + fill.replace(/"/g, "") + '" stroke-width="' + String(width2) + '" stroke-linejoin="round"' + (slash === "/" ? "/" : "") + ">";
    });
  }
  function fittedMarkup(tag) {
    if (elementName(tag.source) !== "path") return null;
    const attrs = tagAttrs(tag.source);
    const data = readAttr(attrs, "d");
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
    const width2 = measured.maxX - measured.minX;
    const height2 = measured.maxY - measured.minY;
    if (!(width2 >= 2) || !(height2 >= 2)) return null;
    const tolerance = Math.max(0.6, Math.min(width2, height2) * 0.02);
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
    const boxArea = width2 * height2;
    if (!left || !right || !top || !bottom || !(boxArea > 0) || measured.area / boxArea < 0.92) return null;
    return { x: measured.minX, y: measured.minY, width: width2, height: height2 };
  }
  function fitRoundRect(measured) {
    const width2 = measured.maxX - measured.minX;
    const height2 = measured.maxY - measured.minY;
    const small = Math.min(width2, height2);
    if (!(width2 >= 6) || !(height2 >= 6)) return null;
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
    const expected = width2 * height2 - (4 - Math.PI) * best.r * best.r;
    if (!(expected > 0) || Math.abs(measured.area - expected) / expected > 0.08) return null;
    const flatShort = small - 2 * best.r;
    if (flatShort < Math.max(4, small * 0.12)) return null;
    const ratio = width2 / height2;
    if (ratio > 0.92 && ratio < 1.08 && best.r > small * 0.3) return null;
    return { x: measured.minX, y: measured.minY, width: width2, height: height2, r: best.r };
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
  function groupPathsByFill(svg2) {
    const matches = pathTags(svg2);
    if (matches.length < 2) return svg2;
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
        if (boxesOverlap(a, b)) return svg2;
      }
    }
    const first = matches[0];
    const last = matches[matches.length - 1];
    if (first === void 0 || last === void 0) return svg2;
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
    return svg2.slice(0, first.index) + grouped + svg2.slice(last.index + last.length);
  }
  function pathTags(svg2) {
    const found = [];
    const pattern = /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;
    let match = pattern.exec(svg2);
    while (match !== null) {
      found.push({ index: match.index, length: match[0].length, source: match[0] });
      match = pattern.exec(svg2);
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
  function canvasSize(svg2) {
    const tag = /<svg\b([^>]*)>/i.exec(svg2);
    if (tag === null) return null;
    const attrs = tag[1] ?? "";
    const width2 = lengthOf2(readAttr(attrs, "width"));
    const height2 = lengthOf2(readAttr(attrs, "height"));
    if (width2 !== null && height2 !== null) return { width: width2, height: height2 };
    const viewBox = readAttr(attrs, "viewBox");
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
    const data = readAttr(attrs, "d");
    if (data === null || data.trim() === "") return null;
    return measurePath(data);
  }
  function measurePrimitive(name, attrs) {
    const numberAttr = (key) => {
      const raw = readAttr(attrs, key);
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
      const width2 = numberAttr("width");
      const height2 = numberAttr("height");
      if (width2 === null || height2 === null || !(width2 > 0) || !(height2 > 0)) return null;
      const x = numberAttr("x") ?? 0;
      const y = numberAttr("y") ?? 0;
      return bounds(x, y, x + width2, y + height2, width2 * height2);
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
    const width2 = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const height2 = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
    if (width2 <= 0.5 || height2 <= 0.5) return false;
    const areaA = Math.max(0, a.maxX - a.minX) * Math.max(0, a.maxY - a.minY);
    const areaB = Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
    const smaller = Math.min(areaA, areaB);
    return smaller > 0 && width2 * height2 / smaller > 0.15;
  }
  function readAttr(attrs, name) {
    const pattern = new RegExp("\\b" + name + `\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
    const match = pattern.exec(attrs);
    if (match === null) return null;
    return match[1] ?? match[2] ?? "";
  }
  function fillOf(attrs) {
    const direct = readAttr(attrs, "fill");
    if (direct !== null) return direct;
    const style = readAttr(attrs, "style");
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
        const start = { x: cx, y: cy };
        const cubic = curveControls(op, relative, args, start, prevControl);
        for (const t of [0.25, 0.5, 0.75, 1]) {
          const point = bezier2(start, cubic.p1, cubic.p2, cubic.p3, t);
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
  function curveControls(op, relative, args, start, prevControl) {
    const abs = (index, axis) => {
      const value = args[index] ?? 0;
      return relative ? start[axis] + value : value;
    };
    if (op === "c") {
      const p1 = { x: abs(0, "x"), y: abs(1, "y") };
      const p2 = { x: abs(2, "x"), y: abs(3, "y") };
      const p32 = { x: abs(4, "x"), y: abs(5, "y") };
      return { p1, p2, p3: p32, control: p2 };
    }
    if (op === "s") {
      const p1 = reflect(prevControl, start);
      const p2 = { x: abs(0, "x"), y: abs(1, "y") };
      const p32 = { x: abs(2, "x"), y: abs(3, "y") };
      return { p1, p2, p3: p32, control: p2 };
    }
    if (op === "q") {
      const control2 = { x: abs(0, "x"), y: abs(1, "y") };
      const p32 = { x: abs(2, "x"), y: abs(3, "y") };
      return { p1: control2, p2: control2, p3: p32, control: control2 };
    }
    const control = reflect(prevControl, start);
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

  // src/lab-model.ts
  var SPECK = { logo: 18, icon: 12, photo: 6, poster: 28 };
  var PRECISION = { logo: 6, icon: 5, photo: 8, poster: 4 };
  function controlsFor(mode2) {
    const defaults = presetDefaults(mode2);
    const segmentColors = mode2 === "logo" ? 0 : Math.min(32, Math.max(2, defaults.maxColors || (mode2 === "photo" ? 32 : mode2 === "poster" ? 10 : 8)));
    return {
      mode: mode2,
      maxColors: segmentColors,
      snapBlends: mode2 === "logo" || mode2 === "icon",
      speckArea: SPECK[mode2],
      removeBackground: defaults.removeBackground,
      backdropSpread: 22,
      opaqueAt: mode2 === "photo" || mode2 === "poster" ? 128 : 200,
      traceColors: defaults.maxColors > 0 ? defaults.maxColors : segmentColors,
      lockPalette: true,
      colorPrecision: PRECISION[mode2],
      filterSpeckle: mode2 === "photo" ? 1 : 0,
      clustering: mode2 === "photo" ? "watershed" : "off",
      watershedDetail: 128,
      simplify: simplifyTolerance(defaults.smoothness),
      stacking: defaults.stacking,
      dropPlate: defaults.removeBackground,
      fitGeometry: true,
      smoothness: defaults.smoothness,
      corner: defaults.corner,
      seal: mode2 === "photo" || mode2 === "poster",
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
  function colorCount(rgba) {
    return paletteFromRaster(rgba, null).length;
  }
  function transparentFraction(rgba) {
    if (rgba.length === 0) return 0;
    let clear = 0;
    const pixels2 = rgba.length / 4;
    for (let index = 3; index < rgba.length; index += 4) if ((rgba[index] ?? 255) === 0) clear += 1;
    return clear / pixels2;
  }
  function styleVectors(svg2, controls, droppedColor, borderColor = null) {
    let fitted = svg2;
    if (droppedColor !== null) fitted = dropFill(fitted, droppedColor);
    if (controls.dropPlate) fitted = dropCanvasBackground(fitted, borderColor);
    if (controls.fitGeometry) fitted = fitShapes(fitted);
    const flat = controls.mode === "logo" || controls.mode === "icon";
    const faired = flat ? fitted : fairPaths(fitted, { smoothness: controls.smoothness, cornerDegrees: controls.corner });
    const sealed = groupPathsByFill(!flat && controls.seal ? sealGaps(faired, controls.sealWidth) : faired);
    return { fitted, faired, sealed };
  }
  function byte(value) {
    return value.toString(16).padStart(2, "0");
  }

  // src/flat-trace.ts
  function cornerColor(rgba, width2, height2) {
    const points = [
      [0, 0],
      [width2 - 1, 0],
      [0, height2 - 1],
      [width2 - 1, height2 - 1]
    ];
    const opaque2 = [];
    for (const point of points) {
      const x = point[0] ?? 0;
      const y = point[1] ?? 0;
      const offset = (y * width2 + x) * 4;
      if ((rgba[offset + 3] ?? 0) < 250) continue;
      opaque2.push({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
    }
    if (opaque2.length === 0) return null;
    const mean = {
      r: opaque2.reduce((sum, color) => sum + color.r, 0) / opaque2.length,
      g: opaque2.reduce((sum, color) => sum + color.g, 0) / opaque2.length,
      b: opaque2.reduce((sum, color) => sum + color.b, 0) / opaque2.length
    };
    for (const color of opaque2) {
      if (Math.abs(color.r - mean.r) > 18 || Math.abs(color.g - mean.g) > 18 || Math.abs(color.b - mean.b) > 18) return null;
    }
    return hex(Math.round(mean.r), Math.round(mean.g), Math.round(mean.b));
  }
  function hex(red, green, blue) {
    return "#" + [red, green, blue].map((value) => Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0")).join("");
  }

  // src/punch-rgba.ts
  function punchRgba(rgba, width2, height2, opaqueAt = 128) {
    const count = width2 * height2;
    if (rgba.length < count * 4) return { rgba, droppedColor: null };
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
    }
    if (transparent === 0) return { rgba, droppedColor: null };
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
    }
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
  function segmentViews(rgba, width2, height2, options) {
    const count = width2 * height2;
    if (width2 < 2 || height2 < 2 || rgba.length < count * 4) {
      const copy = rgba.slice();
      return { colors: copy, backdrop: copy.slice(), spread: 0, paletteSize: 0 };
    }
    const source2 = rgba;
    const cutoff = Math.min(255, Math.max(0, Math.round(options.opaqueAt ?? 128)));
    const samples = collectSamples(source2, width2, height2, cutoff);
    const centroids = cluster(samples, colorCap(options));
    const snapBlends = options.snapBlends ?? (options.mode === "logo" || options.mode === "icon");
    const areas = new Uint32Array(centroids.length);
    for (let index = 0; index < count; index += 1) {
      if ((source2[index * 4 + 3] ?? 0) < cutoff) continue;
      const label = nearest(pixelAt(source2, index), centroids);
      areas[label] = (areas[label] ?? 0) + 1;
    }
    const palette = snapBlends ? foldBlends(centroids, areas) : centroids;
    const labels = new Int16Array(count);
    labels.fill(-1);
    for (let index = 0; index < count; index += 1) {
      if ((source2[index * 4 + 3] ?? 0) < cutoff) continue;
      labels[index] = nearest(pixelAt(source2, index), palette);
    }
    cleanupEdges(labels, width2, height2);
    mergeSpecks(labels, width2, height2, Math.max(0, Math.round(options.speckArea ?? SPECK_AREA[options.mode])));
    const opaque2 = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) opaque2[index] = (source2[index * 4 + 3] ?? 0) >= cutoff ? 255 : 0;
    const colors = paintLabels(labels, palette, opaque2);
    const alpha = opaque2.slice();
    if (options.removeBackground) clearFlatBackdrop(source2, labels, width2, height2, palette, alpha, options.backdropSpread ?? 22);
    return {
      colors,
      backdrop: paintLabels(labels, palette, alpha),
      spread: borderMeasure(source2, width2, height2)?.spread ?? 0,
      paletteSize: palette.length
    };
  }
  function paintLabels(labels, palette, alpha) {
    const next = new Uint8Array(alpha.length * 4);
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4;
      if ((alpha[index] ?? 0) === 0) continue;
      const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
      next[offset] = color.r;
      next[offset + 1] = color.g;
      next[offset + 2] = color.b;
      next[offset + 3] = 255;
    }
    return next;
  }
  function colorCap(options) {
    const requested = options.maxColors > 0 ? options.maxColors : MODE_CAP[options.mode];
    return Math.min(32, Math.max(2, requested));
  }
  function collectSamples(rgba, width2, height2, cutoff) {
    const target = 8e3;
    const stride = Math.max(1, Math.floor(Math.sqrt(width2 * height2 / target)));
    const samples = [];
    for (let y = 0; y < height2; y += stride) {
      for (let x = 0; x < width2; x += stride) {
        const offset = (y * width2 + x) * 4;
        if ((rgba[offset + 3] ?? 0) < cutoff) continue;
        samples.push({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
      }
    }
    return samples.length > 0 ? samples : [{ r: 0, g: 0, b: 0 }];
  }
  function cluster(samples, cap) {
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
  function cleanupEdges(labels, width2, height2) {
    const original = new Int16Array(labels);
    for (let pass = 0; pass < 2; pass += 1) {
      for (let y = 1; y < height2 - 1; y += 1) {
        for (let x = 1; x < width2 - 1; x += 1) {
          const index = y * width2 + x;
          if ((original[index] ?? -1) < 0 || isThin(original, width2, index)) continue;
          const counts = /* @__PURE__ */ new Map();
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const label = original[index + dy * width2 + dx] ?? -1;
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
      }
      original.set(labels);
    }
  }
  function isThin(labels, width2, index) {
    const label = labels[index] ?? 0;
    const left = (labels[index - 1] ?? -1) === label;
    const right = (labels[index + 1] ?? -1) === label;
    const up = (labels[index - width2] ?? -1) === label;
    const down = (labels[index + width2] ?? -1) === label;
    return left && right && !up && !down || up && down && !left && !right;
  }
  function mergeSpecks(labels, width2, height2, minArea) {
    const count = width2 * height2;
    const seen = new Uint8Array(count);
    const queue = new Int32Array(count);
    for (let start = 0; start < count; start += 1) {
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
      let minX = start % width2;
      let maxX = minX;
      let minY = Math.floor(start / width2);
      let maxY = minY;
      while (head < tail) {
        const index = queue[head] ?? 0;
        head += 1;
        const x = index % width2;
        const y = Math.floor(index / width2);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const neighbors = [index - 1, index + 1, index - width2, index + width2];
        for (const next of neighbors) {
          if (next < 0 || next >= count || seen[next] === 1) continue;
          const nx = next % width2;
          if (Math.abs(nx - x) > 1) continue;
          if ((labels[next] ?? -1) !== label) continue;
          seen[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      }
      const area = tail;
      const spanX = maxX - minX + 1;
      const spanY = maxY - minY + 1;
      const thin = Math.max(spanX, spanY) >= 8 && Math.min(spanX, spanY) <= 2 && area >= 6;
      if (area >= minArea || thin) continue;
      const around = /* @__PURE__ */ new Map();
      for (let cursor = 0; cursor < tail; cursor += 1) {
        const index = queue[cursor] ?? 0;
        const x = index % width2;
        const y = Math.floor(index / width2);
        const neighbors = [index - 1, index + 1, index - width2, index + width2];
        for (const next of neighbors) {
          if (next < 0 || next >= count) continue;
          const nx = next % width2;
          const ny = Math.floor(next / width2);
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
  }
  function borderMeasure(rgba, width2, height2) {
    let red = 0;
    let green = 0;
    let blue = 0;
    let border = 0;
    const visit = (x, y) => {
      const offset = (y * width2 + x) * 4;
      red += rgba[offset] ?? 0;
      green += rgba[offset + 1] ?? 0;
      blue += rgba[offset + 2] ?? 0;
      border += 1;
    };
    for (let x = 0; x < width2; x += 1) {
      visit(x, 0);
      if (height2 > 1) visit(x, height2 - 1);
    }
    for (let y = 1; y < height2 - 1; y += 1) {
      visit(0, y);
      if (width2 > 1) visit(width2 - 1, y);
    }
    if (border === 0) return null;
    const mean = { r: red / border, g: green / border, b: blue / border };
    let spread2 = 0;
    const revisit = (x, y) => {
      spread2 += Math.sqrt(distance2(pixelAt(rgba, y * width2 + x), mean));
    };
    for (let x = 0; x < width2; x += 1) {
      revisit(x, 0);
      if (height2 > 1) revisit(x, height2 - 1);
    }
    for (let y = 1; y < height2 - 1; y += 1) {
      revisit(0, y);
      if (width2 > 1) revisit(width2 - 1, y);
    }
    return { mean, spread: spread2 / border };
  }
  function clearFlatBackdrop(rgba, labels, width2, height2, palette, alpha, spreadLimit) {
    const measured = borderMeasure(rgba, width2, height2);
    if (measured === null || measured.spread > spreadLimit) return;
    const mean = measured.mean;
    const backdrop2 = nearest(mean, palette);
    const count = width2 * height2;
    const queue = new Int32Array(count);
    const seen = new Uint8Array(count);
    let tail = 0;
    const push = (index) => {
      if (index < 0 || index >= count || seen[index] === 1) return;
      if ((labels[index] ?? -1) !== backdrop2 && distance2(pixelAt(rgba, index), mean) > 26 * 26) return;
      seen[index] = 1;
      queue[tail] = index;
      tail += 1;
    };
    for (let x = 0; x < width2; x += 1) {
      push(x);
      push((height2 - 1) * width2 + x);
    }
    for (let y = 0; y < height2; y += 1) {
      push(y * width2);
      push(y * width2 + width2 - 1);
    }
    let head = 0;
    while (head < tail) {
      const index = queue[head] ?? 0;
      head += 1;
      const x = index % width2;
      const neighbors = [index - 1, index + 1, index - width2, index + width2];
      for (const next of neighbors) {
        if (next < 0 || next >= count || seen[next] === 1) continue;
        const nx = next % width2;
        if (Math.abs(nx - x) > 1) continue;
        push(next);
      }
    }
    const fraction = tail / count;
    if (fraction < 0.08 || fraction > 0.92) return;
    for (let index = 0; index < tail; index += 1) alpha[queue[index] ?? 0] = 0;
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

  // src/lab-client.ts
  var TITLES = {
    capture: "1 \xB7 \u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A",
    colors: "2 \xB7 \u0E08\u0E31\u0E14\u0E01\u0E25\u0E38\u0E48\u0E21\u0E2A\u0E35",
    backdrop: "3 \xB7 \u0E25\u0E1A\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07",
    punch: "4 \xB7 \u0E15\u0E31\u0E14\u0E02\u0E2D\u0E1A\u0E42\u0E1B\u0E23\u0E48\u0E07",
    trace: "5 \xB7 \u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19",
    fit: "6 \xB7 \u0E17\u0E34\u0E49\u0E07\u0E41\u0E1C\u0E48\u0E19\u0E41\u0E25\u0E30\u0E08\u0E31\u0E1A\u0E23\u0E39\u0E1B",
    fair: "7 \xB7 \u0E40\u0E01\u0E25\u0E32\u0E40\u0E2A\u0E49\u0E19",
    seal: "8 \xB7 \u0E1B\u0E34\u0E14\u0E0A\u0E48\u0E2D\u0E07"
  };
  var mode = byId("mode");
  var form = byId("controls");
  var frame = byId("frame");
  var stageTitle = byId("stage-title");
  var explain = byId("explain");
  var status = byId("status");
  var chips = byId("chips");
  var sourcePhoto = byId("source-photo");
  var stageRaster = byId("stage-raster");
  var stageVector = byId("stage-vector");
  var maxColors = byId("max-colors");
  var snap = byId("snap");
  var speck = byId("speck");
  var backdrop = byId("backdrop");
  var spread = byId("spread");
  var spreadNow = byId("spread-now");
  var opaque = byId("opaque");
  var lock = byId("lock");
  var traceColors = byId("trace-colors");
  var precision = byId("precision");
  var speckle = byId("speckle");
  var simplify = byId("simplify");
  var clustering = byId("clustering");
  var watershed = byId("watershed");
  var stacking = byId("stacking");
  var dropPlate = byId("drop-plate");
  var fit = byId("fit");
  var smooth = byId("smooth");
  var smoothHint = byId("smooth-hint");
  var corner = byId("corner");
  var cornerHint = byId("corner-hint");
  var seal = byId("seal");
  var sealWidth = byId("seal-width");
  var pixels = byId("pixels");
  var metricColors = byId("metric-colors");
  var metricAnchors = byId("metric-anchors");
  var metricTime = byId("metric-time");
  var selected = "capture";
  var source = new Uint8Array();
  var width = 0;
  var height = 0;
  var svg = "";
  var svgKey = "";
  var heldVectors = null;
  var heldRaw = "";
  var traceMs = 0;
  var frameId = 0;
  var traceTimer = 0;
  var traceSerial = 0;
  var flatSvg = "";
  var flatKey = "";
  var flatMs = 0;
  var flatPlates = [];
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", onEdit);
  form.addEventListener("change", onEdit);
  mode.addEventListener("change", () => {
    apply(controlsFor(currentMode()));
    schedule();
  });
  byId("reset").addEventListener("click", () => {
    apply(controlsFor(currentMode()));
    schedule();
  });
  pixels.addEventListener("change", () => frame.classList.toggle("pixelated", pixels.checked));
  for (const button of Array.from(document.querySelectorAll(".film button"))) {
    button.addEventListener("click", () => {
      const step = button.dataset.step;
      if (isStep(step)) selected = step;
      showChrome();
      schedule();
    });
  }
  apply(controlsFor("icon"));
  void load().catch((error) => {
    status.textContent = error instanceof Error ? error.message : "\u0E40\u0E1B\u0E34\u0E14\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49";
  });
  function onEdit(event) {
    if (event.target === stacking) sealWidth.value = stacking.value === "cutout" ? "2" : "0.8";
    syncOutputs();
    schedule();
  }
  function schedule() {
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(() => render());
  }
  async function load() {
    if (!sourcePhoto.complete || sourcePhoto.naturalWidth === 0) {
      await new Promise((resolve, reject) => {
        sourcePhoto.addEventListener("load", () => resolve(), { once: true });
        sourcePhoto.addEventListener("error", () => reject(new Error("\u0E40\u0E1B\u0E34\u0E14\u0E20\u0E32\u0E1E\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49")), { once: true });
      });
    }
    width = sourcePhoto.naturalWidth;
    height = sourcePhoto.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("\u0E2D\u0E48\u0E32\u0E19\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
    context.drawImage(sourcePhoto, 0, 0);
    source = new Uint8Array(context.getImageData(0, 0, width, height).data);
    render();
  }
  function render() {
    if (source.length === 0) return;
    const controls = readControls();
    if (controls.mode === "logo" || controls.mode === "icon") {
      renderFlat(controls);
      return;
    }
    const started = performance.now();
    const views = segmentViews(source, width, height, {
      mode: controls.mode,
      maxColors: controls.maxColors,
      removeBackground: controls.removeBackground,
      snapBlends: controls.snapBlends,
      speckArea: controls.speckArea,
      backdropSpread: controls.backdropSpread,
      opaqueAt: controls.opaqueAt
    });
    const punched = punchRgba(views.backdrop, width, height, controls.opaqueAt);
    const punchShown = revealSentinel(punched.rgba, punched.droppedColor);
    const rasterMs = performance.now() - started;
    paintCanvas("thumb-capture", source);
    paintCanvas("thumb-colors", views.colors);
    paintCanvas("thumb-backdrop", views.backdrop);
    paintCanvas("thumb-punch", punchShown);
    const border = cornerColor(source, width, height);
    const request = traceRequest(controls, paletteFromRaster(punched.rgba, punched.droppedColor));
    const key = rasterKey(punched.rgba, request);
    const styled = svg !== "" ? styleVectors(svg, controls, punched.droppedColor, border) : null;
    const current = svgKey === key && styled !== null;
    if (current && styled !== null) {
      heldVectors = styled;
      heldRaw = svg;
      setSvgThumb("thumb-trace", svg);
      setSvgThumb("thumb-fit", styled.fitted);
      setSvgThumb("thumb-fair", styled.faired);
      setSvgThumb("thumb-seal", styled.sealed);
    } else if (styled !== null) {
      setSvgThumb("thumb-fit", styled.fitted);
      setSvgThumb("thumb-fair", styled.faired);
      setSvgThumb("thumb-seal", styled.sealed);
    }
    const vectors = styled ?? heldVectors;
    const rawSvg = current ? svg : heldRaw;
    const vectorStep = selected === "trace" || selected === "fit" || selected === "fair" || selected === "seal";
    const vectorSvg = !vectorStep || vectors === null ? "" : selected === "trace" ? rawSvg : vectors[vectorField(selected)];
    const shownRaster = rasterOf(selected, views.colors, views.backdrop, punchShown);
    showChrome();
    if (shownRaster !== null) {
      sourcePhoto.hidden = true;
      stageVector.hidden = true;
      stageRaster.hidden = false;
      paintCanvasElement(stageRaster, shownRaster);
    } else {
      sourcePhoto.hidden = true;
      stageRaster.hidden = true;
      stageVector.hidden = false;
      if (vectorSvg !== "") stageVector.innerHTML = sizedSvg(vectorSvg);
    }
    frame.classList.toggle("waiting", shownRaster === null && svgKey !== key);
    const facts = vectorSvg === "" ? null : scoreSvg(vectorSvg);
    metricColors.textContent = shownRaster !== null ? String(colorCount(shownRaster)) : facts === null ? "\u2013" : String(facts.colors);
    metricAnchors.textContent = facts === null ? "\u2013" : String(listAnchors(vectorSvg).length);
    metricTime.textContent = Math.round(rasterMs) + " ms";
    explain.textContent = description(selected, controls, views.spread, views.paletteSize, views.backdrop, punchShown, punched.droppedColor, vectors);
    spreadNow.textContent = "\u0E02\u0E2D\u0E1A\u0E20\u0E32\u0E1E\u0E19\u0E35\u0E49\u0E01\u0E23\u0E30\u0E08\u0E32\u0E22 " + views.spread.toFixed(1) + " \u0E40\u0E01\u0E13\u0E11\u0E4C\u0E17\u0E35\u0E48\u0E25\u0E1A\u0E44\u0E14\u0E49\u0E04\u0E37\u0E2D\u0E04\u0E48\u0E32\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E48\u0E2D\u0E19\u0E2D\u0E22\u0E39\u0E48";
    paintChips(shownRaster !== null ? paletteFromRaster(shownRaster, null) : facts?.palette ?? []);
    status.textContent = svgKey === key ? "\u0E08\u0E31\u0E14\u0E2A\u0E35 " + Math.round(rasterMs) + " ms \xB7 \u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19 " + String(traceMs) + " ms" : "\u0E08\u0E31\u0E14\u0E2A\u0E35 " + Math.round(rasterMs) + " ms \xB7 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19";
    if (svgKey !== key) queueTrace(key, punched.rgba, request, punched.droppedColor);
  }
  function description(step, controls, border, paletteSize, backdrop2, punchShown, droppedColor, styled) {
    if (step === "capture") return "\u0E20\u0E32\u0E1E\u0E16\u0E48\u0E32\u0E22 " + width + "\xD7" + height + " \u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25 \u0E23\u0E27\u0E21\u0E27\u0E2D\u0E25\u0E40\u0E1B\u0E40\u0E1B\u0E2D\u0E23\u0E4C\u0E40\u0E1A\u0E25\u0E2D \u0E40\u0E07\u0E32 \u0E41\u0E25\u0E30\u0E02\u0E2D\u0E1A\u0E08\u0E32\u0E07\u0E02\u0E2D\u0E07\u0E44\u0E2D\u0E04\u0E2D\u0E19";
    if (step === "colors") {
      const blend = controls.snapBlends ? " \u0E02\u0E2D\u0E1A\u0E1A\u0E32\u0E07\u0E23\u0E30\u0E2B\u0E27\u0E48\u0E32\u0E07\u0E2A\u0E2D\u0E07\u0E2A\u0E35\u0E16\u0E39\u0E01\u0E22\u0E38\u0E1A\u0E40\u0E02\u0E49\u0E32\u0E2B\u0E32\u0E2A\u0E35\u0E2B\u0E25\u0E31\u0E01" : " \u0E04\u0E07\u0E2A\u0E35\u0E01\u0E25\u0E32\u0E07\u0E44\u0E27\u0E49";
      return "\u0E40\u0E2B\u0E25\u0E37\u0E2D " + paletteSize + " \u0E2A\u0E35\u0E08\u0E32\u0E01\u0E20\u0E32\u0E1E\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A" + blend;
    }
    if (step === "backdrop") {
      if (!controls.removeBackground) return "\u0E2A\u0E27\u0E34\u0E15\u0E0A\u0E4C\u0E25\u0E1A\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07\u0E1B\u0E34\u0E14\u0E2D\u0E22\u0E39\u0E48 \u0E1E\u0E37\u0E49\u0E19\u0E17\u0E31\u0E49\u0E07\u0E40\u0E1F\u0E23\u0E21\u0E08\u0E36\u0E07\u0E22\u0E31\u0E07\u0E2D\u0E22\u0E39\u0E48\u0E43\u0E19\u0E20\u0E32\u0E1E";
      if (border > controls.backdropSpread) return "\u0E02\u0E2D\u0E1A\u0E01\u0E23\u0E30\u0E08\u0E32\u0E22 " + border.toFixed(1) + " \u0E2A\u0E39\u0E07\u0E01\u0E27\u0E48\u0E32\u0E40\u0E01\u0E13\u0E11\u0E4C " + String(controls.backdropSpread) + " \u0E1E\u0E37\u0E49\u0E19\u0E08\u0E36\u0E07\u0E2D\u0E22\u0E39\u0E48\u0E04\u0E23\u0E1A";
      return "\u0E02\u0E2D\u0E1A\u0E01\u0E23\u0E30\u0E08\u0E32\u0E22 " + border.toFixed(1) + " \u0E2D\u0E22\u0E39\u0E48\u0E43\u0E19\u0E40\u0E01\u0E13\u0E11\u0E4C " + String(controls.backdropSpread) + " \u0E23\u0E30\u0E1A\u0E1A\u0E25\u0E1A\u0E1E\u0E37\u0E49\u0E19\u0E44\u0E1B " + Math.round(transparentFraction(backdrop2) * 100) + "%";
    }
    if (step === "punch") {
      const cleared = Math.round(transparentFraction(punchShown) * 100);
      return "\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25\u0E17\u0E35\u0E48\u0E04\u0E27\u0E32\u0E21\u0E17\u0E36\u0E1A\u0E15\u0E48\u0E33\u0E01\u0E27\u0E48\u0E32 " + String(controls.opaqueAt) + " \u0E16\u0E39\u0E01\u0E15\u0E31\u0E14\u0E2D\u0E2D\u0E01 " + cleared + "%" + (droppedColor === null ? "" : " \u0E2A\u0E35\u0E17\u0E35\u0E48\u0E17\u0E34\u0E49\u0E07\u0E04\u0E37\u0E2D " + droppedColor);
    }
    if (styled === null) return "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E08\u0E32\u0E01\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E15\u0E31\u0E14\u0E42\u0E1B\u0E23\u0E48\u0E07\u0E41\u0E25\u0E49\u0E27";
    if (step === "trace") return "VTracer \u0E25\u0E32\u0E01\u0E15\u0E32\u0E21\u0E42\u0E0B\u0E19\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E37\u0E2D \u0E04\u0E27\u0E32\u0E21\u0E04\u0E25\u0E32\u0E14\u0E40\u0E04\u0E25\u0E37\u0E48\u0E2D\u0E19 " + controls.simplify.toFixed(2) + " px";
    if (step === "fit") {
      const facts = scoreSvg(styled.fitted);
      return "\u0E17\u0E34\u0E49\u0E07\u0E2A\u0E35\u0E42\u0E1B\u0E23\u0E48\u0E07" + (controls.dropPlate ? " \u0E41\u0E25\u0E30\u0E41\u0E1C\u0E48\u0E19\u0E17\u0E35\u0E48\u0E04\u0E25\u0E38\u0E21\u0E17\u0E31\u0E49\u0E07\u0E40\u0E1F\u0E23\u0E21" : "") + " \u0E08\u0E31\u0E1A\u0E44\u0E14\u0E49\u0E27\u0E07\u0E01\u0E25\u0E21 " + facts.circles + " \u0E27\u0E07\u0E23\u0E35 " + facts.ellipses + " \u0E2A\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E35\u0E48\u0E22\u0E21 " + facts.rects + " \u0E2A\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E35\u0E48\u0E22\u0E21\u0E21\u0E19 " + facts.roundRects;
    }
    if (step === "fair") {
      return "\u0E08\u0E38\u0E14\u0E08\u0E32\u0E01 " + listAnchors(styled.fitted).length + " \u0E40\u0E2B\u0E25\u0E37\u0E2D " + listAnchors(styled.faired).length + " \u0E23\u0E30\u0E22\u0E30\u0E22\u0E2D\u0E21 " + (0.4 + controls.smoothness * 2.2).toFixed(1) + " px";
    }
    return controls.seal ? "\u0E16\u0E21\u0E23\u0E2D\u0E22\u0E14\u0E49\u0E27\u0E22\u0E40\u0E2A\u0E49\u0E19\u0E2B\u0E19\u0E32 " + controls.sealWidth.toFixed(1) + " px \u0E41\u0E25\u0E49\u0E27\u0E08\u0E31\u0E14\u0E40\u0E2A\u0E49\u0E19\u0E2A\u0E35\u0E40\u0E14\u0E35\u0E22\u0E27\u0E01\u0E31\u0E19\u0E40\u0E02\u0E49\u0E32\u0E01\u0E25\u0E38\u0E48\u0E21" : "\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E16\u0E21\u0E23\u0E2D\u0E22 \u0E08\u0E31\u0E14\u0E40\u0E2A\u0E49\u0E19\u0E2A\u0E35\u0E40\u0E14\u0E35\u0E22\u0E27\u0E01\u0E31\u0E19\u0E40\u0E02\u0E49\u0E32\u0E01\u0E25\u0E38\u0E48\u0E21\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27";
  }
  function queueTrace(key, rgba, request, droppedColor) {
    window.clearTimeout(traceTimer);
    const serial = ++traceSerial;
    traceTimer = window.setTimeout(() => {
      void sendTrace(serial, key, rgba, request, droppedColor);
    }, 120);
  }
  async function sendTrace(serial, key, rgba, request, droppedColor) {
    const started = performance.now();
    try {
      const response = await fetch("/api/trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ png: await pngBase64(rgba), request })
      });
      if (serial !== traceSerial) return;
      const payload = await response.json();
      if (serial !== traceSerial || payload.cancelled === true) return;
      if (!response.ok || payload.svg === void 0) {
        status.textContent = payload.error ?? "\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
        return;
      }
      svg = payload.svg;
      svgKey = key;
      traceMs = Math.round(performance.now() - started);
      const styled = styleVectors(svg, readControls(), droppedColor, cornerColor(source, width, height));
      setSvgThumb("thumb-trace", svg);
      setSvgThumb("thumb-fit", styled.fitted);
      setSvgThumb("thumb-fair", styled.faired);
      setSvgThumb("thumb-seal", styled.sealed);
      render();
    } catch (error) {
      if (serial !== traceSerial) return;
      status.textContent = error instanceof Error ? error.message : "\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
    }
  }
  function showChrome() {
    stageTitle.textContent = TITLES[selected];
    for (const button of Array.from(document.querySelectorAll(".film button"))) {
      button.setAttribute("aria-pressed", button.dataset.step === selected ? "true" : "false");
    }
    for (const field of Array.from(document.querySelectorAll("fieldset"))) field.hidden = field.id !== "fields-" + selected;
    traceColors.disabled = lock.checked;
    watershed.disabled = clustering.value !== "watershed";
    sealWidth.disabled = !seal.checked;
  }
  function rasterOf(step, colors, backed, punchShown) {
    if (step === "capture") return source;
    if (step === "colors") return colors;
    if (step === "backdrop") return backed;
    if (step === "punch") return punchShown;
    return null;
  }
  function vectorField(step) {
    if (step === "fit") return "fitted";
    if (step === "fair") return "faired";
    return "sealed";
  }
  function paintCanvas(id, rgba) {
    paintCanvasElement(byId(id), rgba);
  }
  function paintCanvasElement(canvas, rgba) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    const copy = new Uint8ClampedArray(rgba.length);
    copy.set(rgba);
    context?.putImageData(new ImageData(copy, width, height), 0, 0);
  }
  function setSvgThumb(id, markup) {
    const img = byId(id);
    const next = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    if (img.src !== next) img.src = next;
  }
  function sizedSvg(markup) {
    return markup.replace(/<svg\b([^>]*)>/i, (_full, attrs) => {
      const kept = attrs.replace(/\s(?:width|height)="[^"]*"/gi, "");
      return "<svg" + kept + ' width="100%">';
    });
  }
  function paintChips(colors) {
    chips.replaceChildren();
    for (const color of colors.slice(0, 24)) {
      const item = document.createElement("li");
      item.style.background = color;
      item.title = color;
      chips.append(item);
    }
  }
  function readControls() {
    const preset = currentMode();
    const base = controlsFor(preset);
    return {
      ...base,
      maxColors: numberValue(maxColors),
      snapBlends: snap.checked,
      speckArea: numberValue(speck),
      removeBackground: backdrop.checked,
      backdropSpread: numberValue(spread),
      opaqueAt: numberValue(opaque),
      traceColors: numberValue(traceColors),
      lockPalette: lock.checked,
      colorPrecision: numberValue(precision),
      filterSpeckle: numberValue(speckle),
      clustering: clustering.value === "watershed" ? "watershed" : "off",
      watershedDetail: numberValue(watershed),
      simplify: numberValue(simplify),
      stacking: stacking.value === "stacked" ? "stacked" : "cutout",
      dropPlate: dropPlate.checked,
      fitGeometry: fit.checked,
      smoothness: numberValue(smooth),
      corner: numberValue(corner),
      seal: seal.checked,
      sealWidth: numberValue(sealWidth)
    };
  }
  function apply(controls) {
    mode.value = controls.mode;
    maxColors.value = String(controls.maxColors);
    snap.checked = controls.snapBlends;
    speck.value = String(controls.speckArea);
    backdrop.checked = controls.removeBackground;
    spread.value = String(controls.backdropSpread);
    opaque.value = String(controls.opaqueAt);
    traceColors.value = String(controls.traceColors);
    lock.checked = controls.lockPalette;
    precision.value = String(controls.colorPrecision);
    speckle.value = String(controls.filterSpeckle);
    simplify.value = String(controls.simplify);
    clustering.value = controls.clustering;
    watershed.value = String(controls.watershedDetail);
    stacking.value = controls.stacking;
    dropPlate.checked = controls.dropPlate;
    fit.checked = controls.fitGeometry;
    smooth.value = String(controls.smoothness);
    corner.value = String(controls.corner);
    seal.checked = controls.seal;
    sealWidth.value = String(controls.sealWidth);
    syncOutputs();
  }
  function syncOutputs() {
    setOutput(maxColors, maxColors.value === "0" ? "\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34" : maxColors.value);
    setOutput(speck, speck.value);
    setOutput(spread, spread.value);
    setOutput(opaque, opaque.value);
    setOutput(traceColors, traceColors.value);
    setOutput(precision, precision.value);
    setOutput(speckle, speckle.value);
    setOutput(simplify, Number(simplify.value).toFixed(2));
    setOutput(watershed, watershed.value);
    setOutput(smooth, Number(smooth.value).toFixed(1));
    setOutput(corner, corner.value + "\xB0");
    setOutput(sealWidth, Number(sealWidth.value).toFixed(1));
    const tolerance = 0.4 + Number(smooth.value) * 2.2;
    smoothHint.textContent = "\u0E23\u0E30\u0E22\u0E30\u0E22\u0E2D\u0E21 " + tolerance.toFixed(1) + " px \u0E0A\u0E48\u0E27\u0E07\u0E17\u0E35\u0E48\u0E22\u0E32\u0E27\u0E16\u0E39\u0E01\u0E22\u0E37\u0E14\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E2A\u0E49\u0E19\u0E15\u0E23\u0E07";
    cornerHint.textContent = "\u0E40\u0E01\u0E47\u0E1A\u0E21\u0E38\u0E21\u0E17\u0E35\u0E48\u0E40\u0E25\u0E35\u0E49\u0E22\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22 " + String(Math.max(0, 90 - Number(corner.value))) + "\xB0 \u0E41\u0E25\u0E30\u0E14\u0E49\u0E32\u0E19\u0E22\u0E32\u0E27\u0E01\u0E27\u0E48\u0E32 3 px";
  }
  function renderFlat(controls) {
    paintCanvas("thumb-capture", source);
    const key = rasterKey(source, {
      preset: controls.mode,
      maxColors: controls.maxColors,
      smoothness: controls.smoothness,
      removeBackground: controls.removeBackground,
      stacking: controls.stacking,
      simplify: controls.corner
    });
    const ready = flatKey === key && flatSvg !== "";
    paintCanvas("thumb-colors", source);
    paintCanvas("thumb-backdrop", source);
    paintCanvas("thumb-punch", source);
    if (ready) {
      setSvgThumb("thumb-trace", flatSvg);
      setSvgThumb("thumb-fit", flatSvg);
      setSvgThumb("thumb-fair", flatSvg);
      setSvgThumb("thumb-seal", flatSvg);
      paintFlatPlates();
    }
    showChrome();
    const vectorStep = selected === "trace" || selected === "fit" || selected === "fair" || selected === "seal";
    if (!vectorStep) {
      sourcePhoto.hidden = true;
      stageVector.hidden = true;
      stageRaster.hidden = false;
      if (selected === "capture" || !ready) paintCanvasElement(stageRaster, source);
      else paintFlatPlates(stageRaster);
    } else {
      sourcePhoto.hidden = true;
      stageRaster.hidden = true;
      stageVector.hidden = false;
      if (ready) stageVector.innerHTML = sizedSvg(flatSvg);
    }
    frame.classList.toggle("waiting", !ready && selected !== "capture");
    const facts = ready ? scoreSvg(flatSvg) : null;
    metricColors.textContent = facts === null ? "\u2013" : String(facts.colors);
    metricAnchors.textContent = facts === null ? "\u2013" : String(listAnchors(flatSvg).length);
    metricTime.textContent = ready ? flatMs + " ms" : "\u2026";
    explain.textContent = flatDescription(selected, controls, facts);
    spreadNow.textContent = "\u0E42\u0E2B\u0E21\u0E14\u0E42\u0E25\u0E42\u0E01\u0E49\u0E41\u0E25\u0E30\u0E44\u0E2D\u0E04\u0E2D\u0E19\u0E41\u0E22\u0E01\u0E08\u0E32\u0E19\u0E2A\u0E35\u0E15\u0E48\u0E2D\u0E0A\u0E34\u0E49\u0E19 \u0E08\u0E36\u0E07\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E49\u0E40\u0E01\u0E13\u0E11\u0E4C\u0E01\u0E23\u0E30\u0E08\u0E32\u0E22\u0E02\u0E2D\u0E07\u0E1E\u0E37\u0E49\u0E19";
    paintChips(facts?.palette ?? []);
    status.textContent = ready ? "\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E41\u0E1A\u0E19 " + String(flatMs) + " ms" : "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E08\u0E31\u0E14\u0E2A\u0E35\u0E15\u0E48\u0E2D\u0E0A\u0E34\u0E49\u0E19\u0E41\u0E25\u0E49\u0E27\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19";
    if (!ready) queueFlat(key, controls);
  }
  function flatDescription(step, controls, facts) {
    const colors = controls.maxColors <= 0 ? "\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34" : "\u0E40\u0E1E\u0E14\u0E32\u0E19 " + String(controls.maxColors) + " \u0E2A\u0E35";
    if (step === "capture") return "\u0E20\u0E32\u0E1E\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A " + String(width) + "\xD7" + String(height) + " \u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25";
    if (step === "colors" || step === "backdrop" || step === "punch") return "\u0E08\u0E32\u0E19\u0E2A\u0E35 OKLab \u0E15\u0E48\u0E2D\u0E0A\u0E34\u0E49\u0E19 \u0E02\u0E22\u0E32\u0E22 8 \u0E40\u0E17\u0E48\u0E32 \u0E41\u0E25\u0E49\u0E27\u0E23\u0E30\u0E1A\u0E32\u0E22\u0E2A\u0E35\u0E41\u0E1A\u0E19 \xB7 " + colors;
    if (facts === null) return "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E08\u0E32\u0E01\u0E20\u0E32\u0E1E\u0E2A\u0E35\u0E41\u0E1A\u0E19";
    if (step === "trace" || step === "fit") return "VTracer \u0E15\u0E32\u0E21\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E25\u0E47\u0E2D\u0E01 \u0E22\u0E48\u0E2D\u0E01\u0E25\u0E31\u0E1A 1/8 \u0E41\u0E25\u0E49\u0E27\u0E08\u0E31\u0E1A\u0E23\u0E39\u0E1B \xB7 " + String(facts.colors) + " \u0E2A\u0E35";
    return "\u0E40\u0E01\u0E25\u0E32\u0E40\u0E2A\u0E49\u0E19\u0E40\u0E1A\u0E32 \u0E46 \u0E40\u0E2B\u0E25\u0E37\u0E2D " + String(facts.anchors) + " \u0E08\u0E38\u0E14 \u0E42\u0E14\u0E22\u0E44\u0E21\u0E48\u0E16\u0E21\u0E23\u0E2D\u0E22\u0E17\u0E31\u0E1A";
  }
  function queueFlat(key, controls) {
    window.clearTimeout(traceTimer);
    const serial = ++traceSerial;
    traceTimer = window.setTimeout(() => {
      void sendFlat(serial, key, controls);
    }, 120);
  }
  async function sendFlat(serial, key, controls) {
    const started = performance.now();
    try {
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          png: await pngBase64(source),
          settings: {
            preset: controls.mode,
            maxColors: controls.maxColors,
            smoothness: controls.smoothness,
            corner: controls.corner,
            removeBackground: controls.removeBackground,
            stacking: controls.stacking
          }
        })
      });
      if (serial !== traceSerial) return;
      const payload = await response.json();
      if (serial !== traceSerial || payload.cancelled === true) return;
      if (!response.ok || payload.svg === void 0) {
        status.textContent = payload.error ?? "\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
        return;
      }
      flatSvg = payload.svg;
      flatPlates = payload.plates ?? [];
      flatKey = key;
      flatMs = Math.round(performance.now() - started);
      render();
    } catch (error) {
      if (serial !== traceSerial) return;
      status.textContent = error instanceof Error ? error.message : "\u0E25\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
    }
  }
  function paintFlatPlates(target) {
    const canvases = target === void 0 ? [byId("thumb-colors"), byId("thumb-backdrop"), byId("thumb-punch")] : [target];
    const plates = flatPlates;
    for (const canvas of canvases) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d");
      if (context === null) continue;
      context.clearRect(0, 0, width, height);
      for (const plate of plates) {
        const image = new Image();
        image.onload = () => {
          context.drawImage(image, plate.originX, plate.originY, plate.width / 8, plate.height / 8);
        };
        image.src = "data:image/png;base64," + plate.png;
      }
    }
  }
  function setOutput(input, text) {
    const output = document.querySelector("output[for='" + input.id + "']");
    if (output !== null) output.textContent = text;
    input.setAttribute("aria-valuetext", text);
  }
  async function pngBase64(rgba) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("\u0E40\u0E02\u0E49\u0E32\u0E23\u0E2B\u0E31\u0E2A PNG \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
    const copy = new Uint8ClampedArray(rgba.length);
    copy.set(rgba);
    context.putImageData(new ImageData(copy, width, height), 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result === null) reject(new Error("\u0E40\u0E02\u0E49\u0E32\u0E23\u0E2B\u0E31\u0E2A PNG \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49"));
        else resolve(result);
      }, "image/png");
    });
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }
  function bytesToBase64(bytes) {
    let binary = "";
    const step = 32768;
    for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, index + step));
    return btoa(binary);
  }
  function rasterKey(rgba, request) {
    let hash = 2166136261;
    for (let index = 0; index < rgba.length; index += 97) hash = Math.imul(hash ^ (rgba[index] ?? 0), 16777619);
    return (hash >>> 0).toString(16) + ":" + JSON.stringify(request);
  }
  function currentMode() {
    if (mode.value === "logo" || mode.value === "icon" || mode.value === "photo" || mode.value === "poster") return mode.value;
    return "icon";
  }
  function numberValue(input) {
    return Number(input.value);
  }
  function isStep(value) {
    return value === "capture" || value === "colors" || value === "backdrop" || value === "punch" || value === "trace" || value === "fit" || value === "fair" || value === "seal";
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (node === null) throw new Error(id);
    return node;
  }
})();

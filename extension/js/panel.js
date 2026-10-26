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

  // src/png-alpha.ts
  var zlib = __toESM(__require("zlib"));
  var PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  var CRC_TABLE = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
    CRC_TABLE[index] = value;
  }
  function punchTransparency(png) {
    const image = readRgbaPng(png);
    if (image === null) return { png, droppedColor: null };
    const used = /* @__PURE__ */ new Set();
    let transparent = 0;
    for (let index = 0; index < image.rgba.length; index += 4) {
      const alpha = image.rgba[index + 3] ?? 255;
      if (alpha < 128) {
        transparent += 1;
        continue;
      }
      const red = image.rgba[index] ?? 0;
      const green = image.rgba[index + 1] ?? 0;
      const blue = image.rgba[index + 2] ?? 0;
      used.add(red << 16 | green << 8 | blue);
    }
    if (transparent === 0) return { png, droppedColor: null };
    const sentinel = unusedColor(used);
    const next = new Uint8Array(image.rgba);
    for (let index = 0; index < next.length; index += 4) {
      const alpha = next[index + 3] ?? 255;
      if (alpha < 128) {
        next[index] = sentinel >> 16 & 255;
        next[index + 1] = sentinel >> 8 & 255;
        next[index + 2] = sentinel & 255;
      }
      next[index + 3] = 255;
    }
    return { png: encodeRgbaPng(image.width, image.height, next), droppedColor: hex(sentinel) };
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
      PNG_SIGNATURE,
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0))
    ]);
  }
  function readRgbaPng(png) {
    if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
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
  function unusedColor(used) {
    const candidates = [16711935, 65280, 16711850, 65535, 16776960];
    for (const color of candidates) if (!used.has(color)) return color;
    for (let color = 0; color < 16777216; color += 97) if (!used.has(color)) return color;
    return 16711935;
  }
  function hex(color) {
    return "#" + color.toString(16).padStart(6, "0");
  }
  function crc32(data) {
    let crc = 4294967295;
    for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 255] ?? 0) ^ crc >>> 8;
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
  var ARG_COUNT = {
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
    if (facts.rects > 0) parts.push("\u0E2A\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E35\u0E48\u0E22\u0E21 " + String(facts.rects));
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
    for (const tag of pathTags(svg)) {
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
      else if (name === "rect") rects += 1;
    }
    return { paths, anchors, holes, colors: palette.length, palette, circles, ellipses, rects };
  }
  function rememberFill(fill, seen, palette) {
    if (fill === null || seen.has(fill)) return;
    seen.add(fill);
    palette.push(fill);
  }
  function dropCanvasBackground(svg) {
    const size = canvasSize(svg);
    if (size === null) return svg;
    const matches = pathTags(svg);
    if (matches.length < 2) return svg;
    let chosen = null;
    for (const tag of matches) {
      const measured = measureTag(tag);
      if (measured === null) continue;
      const spanX = measured.maxX - measured.minX;
      const spanY = measured.maxY - measured.minY;
      const covers = spanX >= size.width * 0.9 && spanY >= size.height * 0.9;
      if (!covers) continue;
      if (chosen === null || measured.area > (measureTag(chosen)?.area ?? 0)) chosen = tag;
    }
    if (chosen === null) return svg;
    return svg.slice(0, chosen.index) + svg.slice(chosen.index + chosen.length);
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
  function sealGaps(svg) {
    return svg.replace(/<(path|circle|ellipse|rect)\b([^>]*?)\s*(\/?)\s*>/gi, (full, name, attrs, slash) => {
      if (/\bstroke\s*=/i.test(attrs)) return full;
      const fill = fillOf(attrs);
      const paint = normalizeFill(fill);
      if (fill === null || paint === null) return full;
      return "<" + name + attrs + ' stroke="' + fill.replace(/"/g, "") + '" stroke-width="0.8" stroke-linejoin="round"' + (slash === "/" ? "/" : "") + ">";
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
    if (rect !== null) return '<rect x="' + fmt(rect.x) + '" y="' + fmt(rect.y) + '" width="' + fmt(rect.width) + '" height="' + fmt(rect.height) + '"' + fillAttr + "/>";
    const circle = fitCircle(measured);
    if (circle !== null) return '<circle cx="' + fmt(circle.cx) + '" cy="' + fmt(circle.cy) + '" r="' + fmt(circle.r) + '"' + fillAttr + "/>";
    const ellipse = fitEllipse(measured);
    if (ellipse !== null) return '<ellipse cx="' + fmt(ellipse.cx) + '" cy="' + fmt(ellipse.cy) + '" rx="' + fmt(ellipse.rx) + '" ry="' + fmt(ellipse.ry) + '"' + fillAttr + "/>";
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
    if (maxError > Math.max(0.75, radius * 0.02)) return null;
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
  function fmt(value) {
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
    const width = lengthOf(readAttr(attrs, "width"));
    const height = lengthOf(readAttr(attrs, "height"));
    if (width !== null && height !== null) return { width, height };
    const viewBox = readAttr(attrs, "viewBox");
    if (viewBox === null) return null;
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    const boxWidth = parts[2];
    const boxHeight = parts[3];
    if (boxWidth === void 0 || boxHeight === void 0 || !(boxWidth > 0) || !(boxHeight > 0)) return null;
    return { width: boxWidth, height: boxHeight };
  }
  function lengthOf(value) {
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
      const hex2 = short[1] ?? "";
      return "#" + hex2[0] + hex2[0] + hex2[1] + hex2[1] + hex2[2] + hex2[2];
    }
    return value;
  }
  function measurePath(data) {
    const commands = tokenize(data);
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
          const point = bezier(start2, cubic.p1, cubic.p2, cubic.p3, t);
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
  function bezier(p0, p1, p2, p3, t) {
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
  function tokenize(data) {
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
      const count = ARG_COUNT[cmd.toLowerCase()] ?? 0;
      if (count === 0) break;
      const args = [];
      let cursor = index;
      for (let slot = 0; slot < count; slot += 1) {
        const number = readNumber(data, cursor);
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
  function readNumber(data, index) {
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
  function simplifyTolerance(smoothness) {
    const clamped = Math.min(3, Math.max(0, smoothness));
    const tolerance = 2.2 - clamped * 0.75;
    return Math.round(Math.max(0.15, tolerance) * 100) / 100;
  }
  function vtracerArguments(input, output, request) {
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
      simplifyTolerance(request.smoothness).toFixed(2)
    ];
    if (request.maxColors > 0) args.push("--max-colors", String(request.maxColors));
    if (request.preset === "photo") {
      args.push("--preset", "photo", "--color-precision", "6");
    } else if (request.preset === "icon") {
      args.push("--preset", "poster", "--color-precision", "5", "--filter-speckle", "2");
    } else {
      args.push("--preset", "poster", "--color-precision", "6", "--filter-speckle", "2");
    }
    return args;
  }

  // src/panel.ts
  var HostTimeoutError = class extends Error {
    constructor() {
      super("Illustrator \u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E20\u0E32\u0E22\u0E43\u0E19\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E01\u0E33\u0E2B\u0E19\u0E14");
    }
  };
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
    const stacking = getElement("stacking");
    if (!(preview instanceof HTMLImageElement)) throw new Error("Expected preview image");
    if (!(preset instanceof HTMLSelectElement)) throw new Error("Expected preset selector");
    if (!(stacking instanceof HTMLSelectElement)) throw new Error("Expected stacking selector");
    return {
      selection: getElement("selection"),
      status: getElement("status"),
      phase: getElement("phase"),
      preview,
      previewEmpty: getElement("preview-empty"),
      refresh: getButton("refresh"),
      trace: getButton("trace"),
      cancel: getButton("cancel"),
      apply: getButton("apply"),
      preset,
      colors: getInput("colors"),
      colorsValue: getOutput("colors-value"),
      smooth: getInput("smooth"),
      smoothValue: getOutput("smooth-value"),
      facts: getElement("facts"),
      factPaths: getElement("fact-paths"),
      factAnchors: getElement("fact-anchors"),
      factHoles: getElement("fact-holes"),
      factColors: getElement("fact-colors"),
      factNote: getElement("fact-note"),
      palette: getElement("palette"),
      backdrop: getInput("backdrop"),
      stacking,
      viewPixels: getButton("view-pixels"),
      viewVectors: getButton("view-vectors"),
      zoomIn: getButton("zoom-in"),
      zoomOut: getButton("zoom-out")
    };
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
    const itemType = parts[3];
    if (itemType !== "PlacedItem" && itemType !== "RasterItem") throw new Error("\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A\u0E20\u0E32\u0E1E raster \u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2B\u0E19\u0E36\u0E48\u0E07\u0E20\u0E32\u0E1E");
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
  function newJob(settings) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vector-panel-"));
    return {
      id: crypto.randomBytes(8).toString("hex"),
      directory,
      pngPath: path.join(directory, "source.png"),
      svgPath: path.join(directory, "result.svg"),
      settings,
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
  function runVtracer(binary, job, inputPath, onStart) {
    return new Promise((resolve, reject) => {
      const child = childProcess.spawn(binary, vtracerArguments(inputPath, job.svgPath, job.settings), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      onStart(child);
      let stderr = "";
      child.stderr?.on("data", (chunk2) => {
        if (stderr.length < 4e3) stderr += chunk2.toString("utf8").slice(0, 4e3 - stderr.length);
      });
      child.once("error", (error) => reject(error));
      child.once("close", (code) => {
        if (job.cancelled) {
          reject(new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27"));
        } else if (code === 0 && fs.existsSync(job.svgPath) && fs.statSync(job.svgPath).size > 0) {
          resolve();
        } else {
          reject(new Error("VTracer \u0E41\u0E1B\u0E25\u0E07\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" + (stderr ? ": " + stderr.trim() : "")));
        }
      });
    });
  }
  function readSettings(ui) {
    const preset = ui.preset.value;
    if (preset !== "logo" && preset !== "icon" && preset !== "photo") throw new Error("Preset \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    const maxColors = Number(ui.colors.value);
    const smoothness = Number(ui.smooth.value) / 10;
    const stacking = ui.stacking.value === "stacked" ? "stacked" : "cutout";
    if (!Number.isInteger(maxColors) || maxColors < 0 || maxColors > 64) throw new Error("\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    if (!Number.isFinite(smoothness) || smoothness < 0 || smoothness > 3) throw new Error("\u0E04\u0E48\u0E32\u0E04\u0E27\u0E32\u0E21\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    return { preset, maxColors, smoothness, removeBackground: ui.backdrop.checked, stacking };
  }
  function colorLabel(value) {
    return value === "0" ? "\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34" : value;
  }
  function showFacts(ui, facts) {
    if (facts === null) {
      ui.facts.hidden = true;
      ui.factNote.hidden = true;
      ui.factNote.textContent = "";
      showPalette(ui, []);
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
    showPalette(ui, facts.palette);
  }
  function showPalette(ui, palette) {
    ui.palette.replaceChildren();
    if (palette.length === 0) {
      ui.palette.hidden = true;
      return;
    }
    for (const color of palette) {
      const item = document.createElement("li");
      if (/^#[0-9a-f]{6}$/.test(color)) item.style.backgroundColor = color;
      item.title = color;
      ui.palette.append(item);
    }
    ui.palette.hidden = false;
  }
  function showSelection(ui, selection) {
    ui.selection.replaceChildren();
    if (selection === null) {
      ui.selection.textContent = "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E20\u0E32\u0E1E raster \u0E2B\u0E19\u0E36\u0E48\u0E07\u0E20\u0E32\u0E1E\u0E1A\u0E19 artboard";
      return;
    }
    const title = document.createElement("strong");
    title.textContent = selection.itemName || selection.itemType;
    const detail = document.createElement("small");
    detail.textContent = selection.documentName + " \xB7 " + (selection.embedded ? "embedded" : "linked") + " \xB7 " + Math.round(selection.widthPt) + " \xD7 " + Math.round(selection.heightPt) + " pt";
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
  function start() {
    const ui = getUi();
    let state = { kind: "empty" };
    let view = "vector";
    let zoom = 1;
    const extensionPath = typeof CSInterface === "undefined" ? "" : new CSInterface().getSystemPath(SystemPath.EXTENSION);
    const host = typeof CSInterface === "undefined" ? null : new CSInterface();
    function message(value, isError = false) {
      ui.status.textContent = value;
      ui.status.classList.toggle("error", isError);
    }
    function render() {
      showSelection(ui, currentSelection(state));
      const busy = state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying";
      ui.refresh.disabled = busy;
      ui.trace.disabled = busy || state.kind === "empty";
      ui.trace.textContent = currentSelection(state)?.fromResult ? "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48" : "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07";
      ui.apply.disabled = state.kind !== "preview";
      ui.cancel.hidden = state.kind !== "tracing";
      ui.phase.textContent = state.kind === "loading" ? "\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E" : state.kind === "capturing" ? "\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E" : state.kind === "tracing" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E1B\u0E25\u0E07" : state.kind === "applying" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E43\u0E2A\u0E48\u0E1C\u0E25" : state.kind === "preview" ? "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2A\u0E48\u0E1C\u0E25" : "\u0E1E\u0E23\u0E49\u0E2D\u0E21";
      const showing = state.kind === "preview" || state.kind === "applying";
      ui.viewPixels.hidden = !showing;
      ui.viewVectors.hidden = !showing;
      ui.zoomIn.hidden = !showing;
      ui.zoomOut.hidden = !showing;
      ui.viewPixels.setAttribute("aria-pressed", view === "pixels" ? "true" : "false");
      ui.viewVectors.setAttribute("aria-pressed", view === "vector" ? "true" : "false");
      ui.preview.classList.toggle("zoom-2", showing && zoom === 2);
      ui.preview.classList.toggle("zoom-4", showing && zoom === 4);
      if (state.kind === "preview" || state.kind === "applying") {
        ui.preview.src = view === "pixels" ? state.pngUrl : state.dataUrl;
        ui.preview.hidden = false;
        ui.previewEmpty.hidden = true;
        showFacts(ui, state.facts);
      } else {
        ui.preview.removeAttribute("src");
        ui.preview.hidden = true;
        ui.previewEmpty.hidden = false;
        showFacts(ui, null);
      }
    }
    async function refresh() {
      if (host === null) {
        message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
        return;
      }
      if (state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying") return;
      if (state.kind === "preview") cleanJob(state.job);
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
      if (host === null) return;
      if (state.kind !== "selected" && state.kind !== "preview") return;
      const selection = state.selection;
      if (state.kind === "preview") cleanJob(state.job);
      let job = null;
      try {
        job = newJob(readSettings(ui));
        state = { kind: "capturing", selection, job };
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Illustrator\u2026");
        render();
        await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
        if (!fs.existsSync(job.pngPath) || fs.statSync(job.pngPath).size === 0) throw new Error("Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E20\u0E32\u0E1E PNG \u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32");
        const binary = path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
        if (!fs.existsSync(binary)) throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A VTracer binary \u0E43\u0E19 extension/bin");
        const sourcePng = fs.readFileSync(job.pngPath);
        const punched = punchTransparency(sourcePng);
        const traceInput = path.join(job.directory, "trace.png");
        fs.writeFileSync(traceInput, punched.png);
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C\u2026");
        await runVtracer(binary, job, traceInput, (child) => {
          if (job === null) return;
          state = { kind: "tracing", selection, job, child };
          render();
        });
        let svgText = fs.readFileSync(job.svgPath, "utf8");
        if (punched.droppedColor !== null) svgText = dropFill(svgText, punched.droppedColor);
        if (job.settings.removeBackground) svgText = dropCanvasBackground(svgText);
        svgText = groupPathsByFill(sealGaps(fitShapes(svgText)));
        fs.writeFileSync(job.svgPath, svgText);
        const facts = scoreSvg(svgText);
        view = "vector";
        zoom = 1;
        const pngUrl = "data:image/png;base64," + sourcePng.toString("base64");
        state = { kind: "preview", selection, job, dataUrl: "data:image/svg+xml;base64," + Buffer.from(svgText, "utf8").toString("base64"), pngUrl, facts };
        message("\u0E40\u0E17\u0E35\u0E22\u0E1A\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25\u0E01\u0E31\u0E1A\u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C \u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E43\u0E2A\u0E48\u0E43\u0E19 Illustrator");
        render();
      } catch (error) {
        if (job !== null) cleanJob(job);
        state = { kind: "selected", selection };
        message(errorMessage(error), true);
        render();
      }
    }
    async function apply() {
      if (host === null || state.kind !== "preview") return;
      const { selection, job, dataUrl, pngUrl, facts } = state;
      state = { kind: "applying", selection, job, dataUrl, pngUrl, facts };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E19\u0E33 path \u0E40\u0E02\u0E49\u0E32 Illustrator\u2026");
      render();
      try {
        const settings = "preset=" + job.settings.preset + ";colors=" + job.settings.maxColors + ";smooth=" + job.settings.smoothness + ";stacking=" + job.settings.stacking + ";background=" + (job.settings.removeBackground ? "removed" : "kept");
        const result = await callHost(host, "VP_commit", [selection.uuid, job.svgPath, job.id, settings, selection.bounds.join(","), selection.documentIdentity]);
        message("\u0E43\u0E2A\u0E48\u0E1C\u0E25\u0E41\u0E25\u0E49\u0E27: " + (result[1] ?? "0") + " paths \xB7 \u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E22\u0E31\u0E07\u0E2D\u0E22\u0E39\u0E48");
        cleanJob(job);
        state = { kind: "selected", selection };
      } catch (error) {
        if (error instanceof HostTimeoutError) {
          message("Illustrator \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A \u0E15\u0E23\u0E27\u0E08 Layers \u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E25\u0E0B\u0E49\u0E33", true);
          state = { kind: "selected", selection };
        } else {
          message(errorMessage(error), true);
          state = { kind: "preview", selection, job, dataUrl, pngUrl, facts };
        }
      }
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
    ui.cancel.addEventListener("click", () => {
      if (state.kind !== "tracing") return;
      state.job.cancelled = true;
      state.child.kill();
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
    });
    ui.colors.addEventListener("input", () => {
      ui.colorsValue.value = colorLabel(ui.colors.value);
    });
    ui.smooth.addEventListener("input", () => {
      ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1);
    });
    ui.preset.addEventListener("change", () => {
      if (ui.preset.value === "photo") {
        ui.colors.value = "36";
        ui.smooth.value = "16";
        ui.backdrop.checked = false;
        ui.stacking.value = "stacked";
      } else if (ui.preset.value === "icon") {
        ui.colors.value = "8";
        ui.smooth.value = "20";
        ui.backdrop.checked = true;
        ui.stacking.value = "cutout";
      } else {
        ui.colors.value = "0";
        ui.smooth.value = "24";
        ui.backdrop.checked = true;
        ui.stacking.value = "cutout";
      }
      ui.colorsValue.value = colorLabel(ui.colors.value);
      ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1);
    });
    ui.viewPixels.addEventListener("click", () => {
      view = "pixels";
      render();
    });
    ui.viewVectors.addEventListener("click", () => {
      view = "vector";
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
    window.addEventListener("beforeunload", () => {
      if (state.kind === "preview") cleanJob(state.job);
      if (state.kind === "tracing") {
        state.job.cancelled = true;
        state.child.kill();
        cleanJob(state.job);
      }
    });
    cleanStaleJobs();
    render();
    void refresh();
  }
  start();
})();

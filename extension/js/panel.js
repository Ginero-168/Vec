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

  // src/png.ts
  var zlib = __toESM(__require("zlib"));
  var import_util = __require("util");
  var inflate2 = (0, import_util.promisify)(zlib.inflate);
  var deflate2 = (0, import_util.promisify)(zlib.deflate);
  var SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }
  async function decodePng(file) {
    if (file.length < 8 || !file.subarray(0, 8).equals(SIGNATURE)) throw new Error("\u0E44\u0E1F\u0E25\u0E4C\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 PNG");
    let offset = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
    const idat = [];
    while (offset + 8 <= file.length) {
      const length = file.readUInt32BE(offset);
      const type = file.toString("latin1", offset + 4, offset + 8);
      const body = file.subarray(offset + 8, offset + 8 + length);
      if (type === "IHDR") {
        width = body.readUInt32BE(0);
        height = body.readUInt32BE(4);
        depth = body.readUInt8(8);
        colorType = body.readUInt8(9);
        interlace = body.readUInt8(12);
      } else if (type === "IDAT") idat.push(body);
      else if (type === "IEND") break;
      offset += 12 + length;
    }
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
    if (depth !== 8 || channels === 0 || interlace !== 0) throw new Error("\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A PNG \u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A (" + depth + "/" + colorType + ")");
    const raw = await inflate2(Buffer.concat(idat));
    const stride = width * channels;
    const out = Buffer.alloc(width * height * 4);
    let previous = new Uint8Array(stride);
    let line = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
      const base = y * (stride + 1);
      const filter = raw[base];
      for (let x = 0; x < stride; x++) {
        const value = raw[base + 1 + x];
        const left = x >= channels ? line[x - channels] : 0;
        const up = previous[x];
        const upLeft = x >= channels ? previous[x - channels] : 0;
        line[x] = (filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + (left + up >> 1) : value + paeth(left, up, upLeft)) & 255;
      }
      const row = y * width * 4;
      if (channels === 4) out.set(line, row);
      else for (let x = 0; x < width; x++) {
        out[row + x * 4] = line[x * 3];
        out[row + x * 4 + 1] = line[x * 3 + 1];
        out[row + x * 4 + 2] = line[x * 3 + 2];
        out[row + x * 4 + 3] = 255;
      }
      const swap = previous;
      previous = line;
      line = swap;
    }
    return { width, height, data: out };
  }
  var CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      table[n] = c;
    }
    return table;
  })();
  function chunk(type, body) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    let crc = -1;
    for (let i = 4; i < 8; i++) crc = CRC_TABLE[(crc ^ head[i]) & 255] ^ crc >>> 8;
    for (let i = 0; i < body.length; i++) crc = CRC_TABLE[(crc ^ body[i]) & 255] ^ crc >>> 8;
    const tail = Buffer.alloc(4);
    tail.writeInt32BE(crc ^ -1, 0);
    return Buffer.concat([head, body, tail]);
  }
  async function stitchPng(strips) {
    if (strips.length === 0) throw new Error("\u0E44\u0E21\u0E48\u0E21\u0E35\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Illustrator");
    const width = strips[0].width;
    const height = strips.reduce((sum, strip) => sum + strip.height, 0);
    const rowBytes = width * 4 + 1;
    const raw = Buffer.alloc(rowBytes * height);
    let y = 0;
    for (const strip of strips) {
      const copyWidth = Math.min(width, strip.width) * 4;
      for (let row = 0; row < strip.height; row++, y++) {
        strip.data.copy(raw, y * rowBytes + 1, row * strip.width * 4, row * strip.width * 4 + copyWidth);
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const compressed = await deflate2(raw, { level: 1 });
    return { png: Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]), width, height };
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
    if (!(preview instanceof HTMLImageElement)) throw new Error("Expected preview image");
    if (!(preset instanceof HTMLSelectElement)) throw new Error("Expected preset selector");
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
      smoothValue: getOutput("smooth-value")
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
    if (parts.length !== 12) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A (host.jsx \u0E01\u0E31\u0E1A panel.js \u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E23\u0E38\u0E48\u0E19 \u2014 \u0E1B\u0E34\u0E14\u0E41\u0E25\u0E49\u0E27\u0E40\u0E1B\u0E34\u0E14 Panel \u0E43\u0E2B\u0E21\u0E48)");
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
      fromResult: parts[10] === "1",
      linkedPath: parts[11] ?? ""
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
      startedAt: Date.now(),
      cancelled: false,
      child: null
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
  var MAX_TRACE_PIXELS = 4e6;
  var DIRECT_FORMATS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg"]);
  function vtracerArguments(job, input) {
    const args = [input, job.svgPath];
    const preset = job.settings.preset;
    if (preset === "photo") {
      args.push("--preset", "photo", "--max-colors", String(job.settings.maxColors));
    } else {
      args.push("--preset", "poster", "--hierarchical", "stacked", "--max-colors", String(job.settings.maxColors));
      if (preset === "icon") args.push("--mode", "polygon");
    }
    args.push("--filter-speckle", String(job.settings.speckle));
    args.push("--color-precision", String(colorPrecision(job.settings.maxColors)));
    if (job.settings.simplify > 0) args.push("--simplify", String(job.settings.simplify));
    args.push("--optimize", "1");
    return args;
  }
  function colorPrecision(maxColors) {
    if (maxColors <= 4) return 3;
    if (maxColors <= 10) return 4;
    if (maxColors <= 20) return 5;
    return 6;
  }
  function runProcess(job, binary, args, failure) {
    return new Promise((resolve, reject) => {
      if (job.cancelled) {
        reject(new CancelledError());
        return;
      }
      const child = childProcess.spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      job.child = child;
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk2) => {
        if (stdout.length < 8e3) stdout += chunk2.toString("utf8");
      });
      child.stderr?.on("data", (chunk2) => {
        if (stderr.length < 4e3) stderr += chunk2.toString("utf8").slice(0, 4e3 - stderr.length);
      });
      child.once("error", (error) => {
        job.child = null;
        reject(new Error(failure + ": " + error.message));
      });
      child.once("close", (code) => {
        job.child = null;
        if (job.cancelled) reject(new CancelledError());
        else if (code === 0) resolve(stdout);
        else reject(new Error(failure + (stderr ? ": " + stderr.trim() : " (exit " + String(code) + ")")));
      });
    });
  }
  var CancelledError = class extends Error {
    constructor() {
      super("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    }
  };
  async function prepareInput(job, sourcePath) {
    const ext = path.extname(sourcePath).toLowerCase();
    if (process.platform !== "darwin") {
      if (!DIRECT_FORMATS.has(ext)) throw new Error("\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A\u0E44\u0E1F\u0E25\u0E4C\u0E25\u0E34\u0E07\u0E01\u0E4C PNG/JPEG \u0E1A\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E19\u0E35\u0E49\u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19");
      return { input: sourcePath, width: 0, height: 0, note: "\u0E2A\u0E48\u0E07\u0E44\u0E1F\u0E25\u0E4C\u0E15\u0E23\u0E07" };
    }
    const info = await runProcess(job, "/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", sourcePath], "\u0E2D\u0E48\u0E32\u0E19\u0E02\u0E19\u0E32\u0E14\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
    const width = Number(/pixelWidth:\s*(\d+)/.exec(info)?.[1] ?? NaN);
    const height = Number(/pixelHeight:\s*(\d+)/.exec(info)?.[1] ?? NaN);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("\u0E2D\u0E48\u0E32\u0E19\u0E02\u0E19\u0E32\u0E14\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49: " + path.basename(sourcePath));
    const pixels = width * height;
    if (pixels <= MAX_TRACE_PIXELS && DIRECT_FORMATS.has(ext)) return { input: sourcePath, width, height, note: width + "\xD7" + height };
    const scale = Math.min(1, Math.sqrt(MAX_TRACE_PIXELS / pixels));
    const side = Math.max(1, Math.floor(Math.max(width, height) * scale));
    await runProcess(job, "/usr/bin/sips", ["-s", "format", "png", "-Z", String(side), sourcePath, "--out", job.pngPath], "\u0E22\u0E48\u0E2D\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    return { input: job.pngPath, width: w, height: h, note: width + "\xD7" + height + " \u2192 " + w + "\xD7" + h };
  }
  async function addCanvasFrame(svgPath) {
    const text = await fs.promises.readFile(svgPath, "utf8");
    const svgTag = /<svg\b[^>]*>/.exec(text);
    if (!svgTag) throw new Error("\u0E1C\u0E25\u0E08\u0E32\u0E01 VTracer \u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 SVG");
    const width = /\swidth="([\d.]+)"/.exec(svgTag[0])?.[1];
    const height = /\sheight="([\d.]+)"/.exec(svgTag[0])?.[1];
    if (!width || !height) throw new Error("SVG \u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E19\u0E32\u0E14 canvas");
    const frame = '<rect id="vp-canvas" x="0" y="0" width="' + width + '" height="' + height + '" fill="none" stroke="none"/>';
    const at = svgTag.index + svgTag[0].length;
    await fs.promises.writeFile(svgPath, text.slice(0, at) + "\n" + frame + text.slice(at), "utf8");
  }
  async function svgStats(svgPath) {
    const text = await fs.promises.readFile(svgPath, "utf8");
    const paths = (text.match(/<path\b/g) ?? []).length;
    let nodes = 0;
    for (const match of text.matchAll(/\bd="([^"]*)"/g)) nodes += (match[1]?.match(/[MLCQSTHVAmlcqsthva]/g) ?? []).length;
    return { paths, nodes, kb: Math.round(text.length / 1024) };
  }
  function readSettings(ui) {
    const preset = ui.preset.value;
    if (preset !== "logo" && preset !== "icon" && preset !== "photo") throw new Error("Preset \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    const maxColors = Number(ui.colors.value);
    const simplify = Number(ui.smooth.value) / 10;
    if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 32) throw new Error("\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    if (!Number.isFinite(simplify) || simplify < 0 || simplify > 3) throw new Error("\u0E04\u0E48\u0E32\u0E04\u0E27\u0E32\u0E21\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    return { preset, maxColors, simplify, speckle: preset === "photo" ? 8 : 16 };
  }
  function showSelection(ui, selection, hint) {
    ui.selection.replaceChildren();
    if (selection === null) {
      ui.selection.textContent = hint;
      return;
    }
    const title = document.createElement("strong");
    title.textContent = selection.itemName || selection.itemType;
    const detail = document.createElement("small");
    const kind = selection.linkedPath ? "linked (\u0E2D\u0E48\u0E32\u0E19\u0E44\u0E1F\u0E25\u0E4C\u0E15\u0E23\u0E07)" : selection.embedded ? "embedded" : "linked";
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
      case "preparing":
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
  var PHASES = {
    empty: "\u0E1E\u0E23\u0E49\u0E2D\u0E21",
    loading: "\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E",
    selected: "\u0E1E\u0E23\u0E49\u0E2D\u0E21",
    capturing: "1/3 \u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E",
    preparing: "2/3 \u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E20\u0E32\u0E1E",
    tracing: "3/3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E1B\u0E25\u0E07",
    preview: "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2A\u0E48\u0E1C\u0E25",
    applying: "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E43\u0E2A\u0E48\u0E1C\u0E25"
  };
  function isBusy(state) {
    return state.kind === "loading" || state.kind === "capturing" || state.kind === "preparing" || state.kind === "tracing" || state.kind === "applying";
  }
  function start() {
    const ui = getUi();
    let state = { kind: "empty" };
    let selectionHint = "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E20\u0E32\u0E1E raster \u0E2B\u0E19\u0E36\u0E48\u0E07\u0E20\u0E32\u0E1E\u0E1A\u0E19 artboard \u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E";
    const extensionPath = typeof CSInterface === "undefined" ? "" : new CSInterface().getSystemPath(SystemPath.EXTENSION);
    const host = typeof CSInterface === "undefined" ? null : new CSInterface();
    let phaseStartedAt = Date.now();
    let progressText = "";
    let ticker = null;
    function message(value, isError = false) {
      progressText = "";
      ui.status.textContent = value;
      ui.status.classList.toggle("error", isError);
      if (isError) console.error("[VectorPanel] " + value);
      else console.log("[VectorPanel] " + value);
    }
    function progress(value) {
      progressText = value;
      phaseStartedAt = Date.now();
      ui.status.classList.remove("error");
      tick();
    }
    function tick() {
      if (!progressText) return;
      const job = "job" in state ? state.job : null;
      const total = job ? " \xB7 \u0E23\u0E27\u0E21 " + ((Date.now() - job.startedAt) / 1e3).toFixed(1) + " s" : "";
      ui.status.textContent = progressText + " " + ((Date.now() - phaseStartedAt) / 1e3).toFixed(1) + " s" + total;
    }
    function render() {
      showSelection(ui, currentSelection(state), selectionHint);
      const busy = isBusy(state);
      ui.refresh.disabled = busy;
      ui.trace.disabled = busy || state.kind === "empty";
      ui.trace.textContent = currentSelection(state)?.fromResult ? "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48" : "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07";
      ui.apply.disabled = state.kind !== "preview";
      ui.cancel.hidden = !(state.kind === "capturing" || state.kind === "preparing" || state.kind === "tracing");
      ui.phase.textContent = PHASES[state.kind];
      ui.phase.classList.toggle("busy", busy);
      if (busy && ticker === null) ticker = window.setInterval(tick, 200);
      if (!busy && ticker !== null) {
        window.clearInterval(ticker);
        ticker = null;
      }
      if (state.kind === "preview" || state.kind === "applying") {
        if (ui.preview.dataset.src !== state.dataUrl) {
          ui.preview.src = state.dataUrl;
          ui.preview.dataset.src = state.dataUrl;
        }
        ui.preview.hidden = false;
        ui.previewEmpty.hidden = true;
      } else {
        ui.preview.removeAttribute("src");
        delete ui.preview.dataset.src;
        ui.preview.hidden = true;
        ui.previewEmpty.hidden = false;
      }
    }
    async function refresh() {
      if (host === null) {
        message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
        return;
      }
      if (isBusy(state)) return;
      if (state.kind === "preview") cleanJob(state.job);
      state = { kind: "loading" };
      progress("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u2026");
      render();
      try {
        const selection = parseSelection(await callHost(host, "VP_snapshot"));
        state = { kind: "selected", selection };
        message("\u0E20\u0E32\u0E1E\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E41\u0E1B\u0E25\u0E07");
      } catch (error) {
        state = { kind: "empty" };
        selectionHint = errorMessage(error);
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
        const current = job;
        state = { kind: "capturing", selection, job: current };
        progress(selection.linkedPath ? "1/3 \u0E2D\u0E48\u0E32\u0E19\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E44\u0E1F\u0E25\u0E4C\u0E25\u0E34\u0E07\u0E01\u0E4C\u2026" : "1/3 Illustrator \u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E23\u0E19\u0E40\u0E14\u0E2D\u0E23\u0E4C\u0E20\u0E32\u0E1E (embedded)\u2026");
        render();
        const sourcePath = await captureSource(host, selection, current);
        if (current.cancelled) throw new CancelledError();
        if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error("Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E20\u0E32\u0E1E\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32");
        state = { kind: "preparing", selection, job: current };
        progress("2/3 \u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E20\u0E32\u0E1E (\u0E19\u0E2D\u0E01 Illustrator)\u2026");
        render();
        const prepared = await prepareInput(current, sourcePath);
        const binary = path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
        if (!fs.existsSync(binary)) throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A VTracer binary \u0E43\u0E19 extension/bin");
        state = { kind: "tracing", selection, job: current };
        progress("3/3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C " + prepared.note + "\u2026");
        render();
        await runProcess(current, binary, vtracerArguments(current, prepared.input), "VTracer \u0E41\u0E1B\u0E25\u0E07\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
        await addCanvasFrame(current.svgPath);
        const stats = await svgStats(current.svgPath);
        const seconds = ((Date.now() - current.startedAt) / 1e3).toFixed(1);
        state = { kind: "preview", selection, job: current, dataUrl: "file://" + encodeURI(current.svgPath) + "?v=" + current.id };
        message(stats.paths + " paths \xB7 " + stats.nodes + " nodes \xB7 " + seconds + " s \u2014 \u0E14\u0E39\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E43\u0E2A\u0E48\u0E43\u0E19 Illustrator");
        render();
      } catch (error) {
        if (job !== null) cleanJob(job);
        state = { kind: "selected", selection };
        message(errorMessage(error), !(error instanceof CancelledError));
        render();
      }
    }
    async function captureSource(bridge, selection, job) {
      const begun = await callHost(bridge, "VP_captureBegin", [selection.uuid, selection.documentIdentity, String(MAX_TRACE_PIXELS)]);
      if (begun[0] === "link") return begun[1] ?? "";
      try {
        const count = Number(begun[1]);
        if (!(count > 0)) throw new Error("Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E02\u0E19\u0E32\u0E14\u0E20\u0E32\u0E1E\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32");
        const strips = [];
        for (let index = 0; index < count; index++) {
          if (job.cancelled) throw new CancelledError();
          progressText = "1/3 Illustrator \u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E23\u0E19\u0E40\u0E14\u0E2D\u0E23\u0E4C\u0E20\u0E32\u0E1E (embedded) " + (index + 1) + "/" + count;
          const stripPath = path.join(job.directory, "strip-" + index + ".png");
          await callHost(bridge, "VP_captureStrip", [String(index), stripPath]);
          strips.push(await decodePng(await fs.promises.readFile(stripPath)));
          void fs.promises.unlink(stripPath).catch(() => void 0);
        }
        const stitched = await stitchPng(strips);
        await fs.promises.writeFile(job.pngPath, stitched.png);
        return job.pngPath;
      } finally {
        await callHost(bridge, "VP_captureEnd").catch(() => void 0);
      }
    }
    async function apply() {
      if (host === null || state.kind !== "preview") return;
      const { selection, job, dataUrl } = state;
      state = { kind: "applying", selection, job, dataUrl };
      progress("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E19\u0E33 path \u0E40\u0E02\u0E49\u0E32 Illustrator\u2026");
      render();
      try {
        const settings = "preset=" + job.settings.preset + ";colors=" + job.settings.maxColors + ";simplify=" + job.settings.simplify;
        const result = await callHost(host, "VP_commit", [selection.uuid, job.svgPath, job.id, settings, selection.bounds.join(","), selection.documentIdentity]);
        message("\u0E43\u0E2A\u0E48\u0E1C\u0E25\u0E41\u0E25\u0E49\u0E27: " + (result[1] ?? "0") + " paths \xB7 \u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E22\u0E31\u0E07\u0E2D\u0E22\u0E39\u0E48 \xB7 Undo \u0E2B\u0E19\u0E36\u0E48\u0E07\u0E04\u0E23\u0E31\u0E49\u0E07\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E22\u0E49\u0E2D\u0E19");
        cleanJob(job);
        state = { kind: "selected", selection };
      } catch (error) {
        if (error instanceof HostTimeoutError) {
          message("Illustrator \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A \u0E15\u0E23\u0E27\u0E08 Layers \u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E25\u0E0B\u0E49\u0E33", true);
          state = { kind: "selected", selection };
        } else {
          message(errorMessage(error), true);
          state = { kind: "preview", selection, job, dataUrl };
        }
      }
      render();
    }
    function cancel() {
      if (state.kind !== "preparing" && state.kind !== "tracing" && state.kind !== "capturing") return;
      state.job.cancelled = true;
      state.job.child?.kill();
      progress("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
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
    ui.cancel.addEventListener("click", cancel);
    ui.colors.addEventListener("input", () => {
      ui.colorsValue.value = ui.colors.value;
    });
    ui.smooth.addEventListener("input", () => {
      ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1);
    });
    ui.preset.addEventListener("change", () => {
      ui.colors.value = ui.preset.value === "photo" ? "24" : ui.preset.value === "icon" ? "4" : "8";
      ui.colorsValue.value = ui.colors.value;
    });
    window.addEventListener("beforeunload", () => {
      if ("job" in state) {
        state.job.cancelled = true;
        state.job.child?.kill();
        cleanJob(state.job);
      }
    });
    cleanStaleJobs();
    render();
    void refresh();
  }
  start();
})();

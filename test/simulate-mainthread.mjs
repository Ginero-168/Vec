import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as vm from "node:vm";
import esbuild from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { PNG } from "pngjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, "test", "fixtures", "runtime");
const extensionDir = path.join(root, "extension");
const beforeExtension = runtime;
const fakeVtracer = path.join(runtime, "bin", "vtracer");
const svgFixture = path.join(runtime, "result.svg");
const pngFixture = path.join(runtime, "logo.png");
const spawnLog = path.join(runtime, "spawn.log");
const threadLog = path.join(runtime, "thread.log");
const pathList = path.join(runtime, "paths.txt");
const FIXTURE_PATHS = 500;
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function recordCall(log, state, name, fn, detail) {
  const start = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    log.push({
      name,
      ns: Number(process.hrtime.bigint() - start),
      script: state.script,
      detail: detail ?? null
    });
  }
}

class HostFile {
  constructor(filePath) {
    this.fsName = String(filePath);
    this._lines = [];
    this._index = 0;
    this.eof = false;
  }
  get exists() {
    return fs.existsSync(this.fsName);
  }
  get length() {
    return this.exists ? fs.statSync(this.fsName).size : 0;
  }
  get name() {
    return path.basename(this.fsName);
  }
  open() {
    this._lines = fs.readFileSync(this.fsName, "utf8").split(/\n/);
    this._index = 0;
    this.eof = this._lines.length === 0;
    return true;
  }
  readln() {
    if (this._index >= this._lines.length) {
      this.eof = true;
      return "";
    }
    const line = this._lines[this._index];
    this._index += 1;
    this.eof = this._index >= this._lines.length;
    return line;
  }
  close() {}
}

function ImageCaptureOptions() {
  this.antiAliasing = false;
  this.transparency = false;
  this.matte = false;
  this.resolution = 72;
}

function shift(bounds, dx, dy) {
  return [Number(bounds[0]) + dx, Number(bounds[1]) + dy, Number(bounds[2]) + dx, Number(bounds[3]) + dy];
}

function copyBounds(bounds) {
  return [Number(bounds[0]), Number(bounds[1]), Number(bounds[2]), Number(bounds[3])];
}

function makeItem(doc, spec) {
  const item = {
    typename: spec.kind,
    uuid: spec.id,
    name: spec.name || spec.id,
    note: spec.note || "",
    parent: null,
    doc,
    children: [],
    _paths: [],
    _selected: false,
    geometricBounds: copyBounds(spec.bounds || [0, 0, 0, 0]),
    visibleBounds: copyBounds(spec.bounds || [0, 0, 0, 0]),
    matrix: spec.matrix || { mValueA: 1, mValueB: 0, mValueC: 0, mValueD: 1, mValueTX: 0, mValueTY: 0 },
    opacity: spec.opacity === undefined ? 100 : spec.opacity,
    clipped: Boolean(spec.clipped),
    embedded: spec.kind === "RasterItem",
    _file: spec.file ? new HostFile(spec.file) : null
  };
  Object.defineProperty(item, "selected", {
    get() {
      return item._selected;
    },
    set(value) {
      item._selected = Boolean(value);
      if (value) doc.selection = [item];
      else doc.selection = doc.selection.filter((entry) => entry !== item);
    }
  });
  Object.defineProperty(item, "file", {
    get() {
      if (!item._file) throw new Error("no linked file");
      return item._file;
    },
    set(value) {
      recordCall(doc._log, doc._state, "PlacedItem.file", () => {
        item._file = value;
      });
    }
  });
  for (const prop of ["width", "height", "position"]) {
    let stored = 0;
    Object.defineProperty(item, prop, {
      get() {
        return stored;
      },
      set(value) {
        recordCall(doc._log, doc._state, "PlacedItem." + prop, () => {
          stored = value;
        });
      }
    });
  }
  item.duplicate = function duplicate(target) {
    return recordCall(doc._log, doc._state, "PageItem.duplicate", () => {
      const copy = cloneItem(item, doc);
      copy.parent = target;
      target.children.push(copy);
      return copy;
    });
  };
  item.translate = function translate(dx, dy) {
    return recordCall(doc._log, doc._state, "PageItem.translate", () => {
      shiftTree(item, dx, dy);
    });
  };
  item.embed = function embed() {
    return recordCall(doc._log, doc._state, "PlacedItem.embed", () => {
      const svg = fs.readFileSync(item._file.fsName, "utf8");
      const count = (svg.match(/<path\b/g) || []).length;
      for (let index = 0; index < count; index += 1) item.parent._paths.push({ typename: "PathItem" });
      item.parent.children = item.parent.children.filter((child) => child !== item);
    });
  };
  Object.defineProperty(item, "placedItems", {
    get() {
      const found = collect(item, "PlacedItem");
      found.add = () => recordCall(doc._log, doc._state, "PlacedItem.add", () => {
        const placed = makeItem(doc, { kind: "PlacedItem", id: "placed-" + Math.random().toString(16).slice(2), bounds: [0, 0, 0, 0] });
        placed.parent = item;
        item.children.push(placed);
        return placed;
      });
      return found;
    }
  });
  Object.defineProperty(item, "rasterItems", {
    get() {
      return collect(item, "RasterItem");
    }
  });
  Object.defineProperty(item, "pathItems", {
    get() {
      return recordCall(doc._log, doc._state, "GroupItem.pathItems", () => ({
        get length() {
          return item._paths.length;
        },
        add() {
          return recordCall(doc._log, doc._state, "PathItem.add", () => {
            const created = { typename: "PathItem", filled: false, stroked: false, note: "" };
            item._paths.push(created);
            return created;
          });
        }
      }));
    }
  });
  Object.defineProperty(item, "groupItems", {
    get() {
      return {
        add() {
          return recordCall(doc._log, doc._state, "GroupItem.add", () => {
            const group = makeItem(doc, { kind: "GroupItem", id: "group-" + Math.random().toString(16).slice(2), bounds: [0, 0, 0, 0] });
            group.parent = item;
            item.children.push(group);
            return group;
          });
        }
      };
    }
  });
  return item;
}

function cloneItem(source, doc) {
  const copy = makeItem(doc, {
    kind: source.typename,
    id: source.uuid + "-copy-" + Math.random().toString(16).slice(2),
    name: source.name,
    note: source.note,
    bounds: copyBounds(source.geometricBounds),
    matrix: { ...source.matrix },
    opacity: source.opacity,
    clipped: source.clipped,
    file: source._file ? source._file.fsName : ""
  });
  if (!source._file) copy._file = null;
  copy.children = source.children.map((child) => {
    const cloned = cloneItem(child, doc);
    cloned.parent = copy;
    return cloned;
  });
  copy._paths = source._paths.map((pathItem) => ({ ...pathItem }));
  return copy;
}

function shiftTree(item, dx, dy) {
  item.geometricBounds = shift(item.geometricBounds, dx, dy);
  item.visibleBounds = shift(item.visibleBounds, dx, dy);
  for (const child of item.children) shiftTree(child, dx, dy);
}

function collect(node, typename) {
  const found = [];
  for (const child of node.children || []) {
    if (child.typename === typename) found.push(child);
    found.push(...collect(child, typename));
  }
  return found;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function createDocument(log, state, tinyPng, filePath) {
  const doc = {
    typename: "Document",
    name: "Trace.ai",
    documentColorSpace: "RGB",
    fullName: new HostFile(filePath),
    selection: [],
    artboards: [{ artboardRect: [0, 200, 200, 0] }],
    activeLayer: null,
    _log: log,
    _state: state
  };
  const layers = [];
  layers.add = function add() {
    return recordCall(log, state, "Layers.add", () => {
      const layer = makeItem(doc, { kind: "Layer", id: "layer-" + Math.random().toString(16).slice(2), name: "Layer", bounds: [0, 0, 0, 0] });
      layer.remove = function remove() {
        return recordCall(log, state, "Layer.remove", () => {
          const index = layers.indexOf(layer);
          if (index >= 0) layers.splice(index, 1);
          if (doc.activeLayer === layer) doc.activeLayer = layers[0] || null;
        });
      };
      layers.unshift(layer);
      doc.activeLayer = layer;
      return layer;
    });
  };
  doc.layers = layers;
  const base = layers.add();
  base.name = "Layer 1";
  // The default layer is not part of a user script. Drop the bookkeeping call.
  log.pop();
  doc.imageCapture = function imageCapture(file, bounds, options) {
    return recordCall(log, state, "Document.imageCapture", () => {
      fs.writeFileSync(file.fsName, tinyPng);
    }, {
      left: Number(bounds[0]),
      top: Number(bounds[1]),
      right: Number(bounds[2]),
      bottom: Number(bounds[3]),
      resolution: options ? options.resolution : null
    });
  };
  doc.getPageItemFromUuid = function getPageItemFromUuid(uuid) {
    let found = null;
    for (const layer of doc.layers) {
      walk(layer, (node) => {
        if (node.uuid === uuid) found = node;
      });
    }
    if (!found) throw new Error("missing uuid");
    return found;
  };
  doc.activate = function activate() {
    state.app.activeDocument = doc;
  };
  doc.close = function close() {
    recordCall(log, state, "Document.close", () => {
      const docs = state.app.documents._docs;
      const index = docs.indexOf(doc);
      if (index >= 0) docs.splice(index, 1);
      if (state.app.activeDocument === doc) state.app.activeDocument = docs[docs.length - 1] || null;
    });
  };
  Object.defineProperty(doc, "pathItems", {
    get() {
      return recordCall(log, state, "Document.pathItems", () => {
        const paths = [];
        for (const layer of doc.layers) {
          walk(layer, (node) => {
            for (const pathItem of node._paths || []) paths.push(pathItem);
          });
        }
        return paths;
      });
    }
  });
  return doc;
}

function populate(doc, kind) {
  const layer = doc.layers[0];
  const bounds = [10, 90, 90, 50];
  const cropped = [10, 90, 90, 80];
  const matrix = { mValueA: 0, mValueB: 1, mValueC: -1, mValueD: 0, mValueTX: 0, mValueTY: 0 };
  function add(parent, spec) {
    const item = makeItem(doc, spec);
    item.parent = parent;
    parent.children.push(item);
    return item;
  }
  let selected = null;
  if (kind === "linked" || kind === "cropped" || kind === "rotated") {
    selected = add(layer, {
      kind: "PlacedItem",
      id: "logo",
      name: "logo.png",
      file: pngFixture,
      bounds: kind === "cropped" ? cropped : bounds,
      matrix: kind === "rotated" ? matrix : undefined
    });
  } else if (kind === "raster") {
    selected = add(layer, { kind: "RasterItem", id: "raster", name: "embedded", bounds });
  } else if (kind === "plain-group" || kind === "clip-group" || kind === "two-rasters") {
    const group = add(layer, {
      kind: "GroupItem",
      id: "group",
      name: "group",
      bounds,
      clipped: kind === "clip-group"
    });
    add(group, { kind: "PlacedItem", id: "logo", name: "logo.png", file: pngFixture, bounds });
    if (kind === "two-rasters") add(group, { kind: "PlacedItem", id: "second", name: "other.png", file: pngFixture, bounds: [20, 80, 70, 40] });
    selected = group;
  } else if (kind === "retrace") {
    add(layer, { kind: "PlacedItem", id: "logo", name: "logo.png", file: pngFixture, bounds });
    selected = add(layer, {
      kind: "GroupItem",
      id: "result",
      name: "Trace old",
      note: "VectorPanel/1|source=logo|job=abcdef0123456789|settings=preset%3Dlogo",
      bounds
    });
  }
  doc.selection = [selected];
  selected._selected = true;
  return selected;
}

const commitPathsSource = `
function VP_commitPaths(encodedUuid, encodedList, encodedJobId, encodedSettings, encodedBounds, encodedDocumentIdentity) {
  var createdLayer = null;
  try {
    var uuid = decodeURIComponent(encodedUuid);
    var listPath = decodeURIComponent(encodedList);
    var jobId = decodeURIComponent(encodedJobId);
    var boundsText = decodeURIComponent(encodedBounds);
    var documentIdentity = decodeURIComponent(encodedDocumentIdentity);
    if (!/^[0-9a-f]{16}$/.test(jobId)) throw new Error("bad job");
    var doc = app.activeDocument;
    if (VP_documentIdentity(doc) !== documentIdentity) throw new Error("เอกสารปัจจุบันเปลี่ยนไป กรุณาแปลงใหม่");
    var source = VP_image(doc, uuid);
    var bounds = source.geometricBounds;
    if (!VP_boundsMatch(bounds, boundsText)) throw new Error("bounds");
    createdLayer = doc.layers.add();
    var holder = createdLayer.groupItems.add();
    var listFile = new File(listPath);
    if (!listFile.open("r")) throw new Error("open");
    while (!listFile.eof) {
      var line = listFile.readln();
      if (!line) continue;
      var created = holder.pathItems.add();
      created.filled = true;
      created.stroked = false;
    }
    listFile.close();
    var added = holder.pathItems.length;
    if (!(added > 0)) throw new Error("ไม่มี path");
    holder.note = "batched";
    return VP_ok([holder.uuid, added]);
  } catch (error) {
    if (createdLayer) { try { createdLayer.remove(); } catch (ignored) {} }
    return VP_error(error);
  }
}
`;

function createSession(jsxSource, tinyPng, kind) {
  const log = [];
  const state = { script: "", app: null };
  const app = {
    userInteractionLevel: 0,
    activeDocument: null,
    documents: {
      _docs: [],
      get length() {
        return this._docs.length;
      },
      add(colorSpace, width, height) {
        return recordCall(log, state, "documents.add", () => {
          const created = createDocument(log, state, tinyPng, path.join(os.tmpdir(), "vector-panel-temporary.ai"));
          this._docs.push(created);
          app.activeDocument = created;
          return created;
        });
      }
    },
    copy() {
      recordCall(log, state, "app.copy", () => {
        app._clipboard = app.activeDocument.selection.map((item) => item);
      });
    },
    paste() {
      recordCall(log, state, "app.paste", () => {
        const doc = app.activeDocument;
        const layer = doc.layers[0];
        const pasted = (app._clipboard || []).map((item) => {
          const copy = cloneItem(item, doc);
          copy.parent = layer;
          layer.children.push(copy);
          return copy;
        });
        doc.selection = pasted;
      });
    }
  };
  app._clipboard = [];
  state.app = app;
  const doc = createDocument(log, state, tinyPng, path.join(runtime, kind + ".ai"));
  app.documents._docs.push(doc);
  app.activeDocument = doc;
  populate(doc, kind);
  const sandbox = {
    app,
    File: HostFile,
    ImageCaptureOptions,
    ElementPlacement: { PLACEATBEGINNING: 1 },
    UserInteractionLevel: { DONTDISPLAYALERTS: 1 },
    SaveOptions: { DONOTSAVECHANGES: 1 },
    encodeURIComponent,
    decodeURIComponent,
    isFinite,
    Number,
    String,
    Math,
    Error,
    RegExp,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(jsxSource.replace(/^\s*#.*$/gm, ""), sandbox);
  vm.runInContext(commitPathsSource, sandbox);
  return {
    log,
    doc,
    lastResult: "",
    evalScript(script, callback) {
      const matched = /^([A-Za-z0-9_]+)/.exec(script);
      const name = matched ? matched[1] : "evalScript";
      const start = process.hrtime.bigint();
      const startEpoch = Date.now();
      state.script = name;
      let result = "EvalScript error.";
      try {
        const value = vm.runInContext(script, sandbox);
        if (typeof value === "string") result = value;
      } catch (error) {
        result = "EvalScript error.";
      } finally {
        log.push({
          name: "evalScript:" + name,
          ns: Number(process.hrtime.bigint() - start),
          script: name,
          detail: { startEpoch, endEpoch: Date.now(), result: result.slice(0, 180) }
        });
        state.script = "";
      }
      this.lastResult = result;
      if (typeof callback === "function") callback(result);
      return result;
    }
  };
}

function aggregate(log) {
  const map = new Map();
  for (const event of log) {
    const current = map.get(event.name) || { name: event.name, count: 0, totalNs: 0 };
    current.count += 1;
    current.totalNs += event.ns;
    map.set(event.name, current);
  }
  return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function count(log, name) {
  return log.filter((event) => event.name === name).length;
}

function captures(log) {
  return log.filter((event) => event.name === "Document.imageCapture").map((event) => event.detail);
}

function readSpawn(file) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").trim().split(/\n/).filter(Boolean);
  let start = null;
  let end = null;
  for (const line of lines) {
    const parts = line.split(" ");
    const stamp = Number(parts[0]);
    if (parts[1] === "start") start = stamp;
    if (parts[1] === "end") end = stamp;
  }
  if (start === null) return null;
  return { start, end: end === null ? start : end };
}

function overlaps(log, spawn) {
  if (!spawn) return false;
  return log.some((event) => event.name.startsWith("evalScript:") && event.detail && event.detail.startEpoch < spawn.end && spawn.start < event.detail.endEpoch);
}

async function waitFor(fn, label) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timeout: " + label);
}

function boot(bundle, extensionPath, session) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: "file:///workspace/extension/index.html",
    pretendToBeVisual: true,
    virtualConsole
  });
  const window = dom.window;
  const errors = [];
  window.addEventListener("error", (event) => errors.push(String(event.message)));
  window.require = require;
  window.process = process;
  window.Buffer = Buffer;
  window.global = global;
  window.SystemPath = { EXTENSION: "extension" };
  function CSInterface() {}
  CSInterface.prototype.getSystemPath = () => extensionPath;
  CSInterface.prototype.evalScript = (script, callback) => session.evalScript(script, callback);
  window.CSInterface = CSInterface;
  const selection = window.document.getElementById("selection");
  const phase = window.document.getElementById("phase");
  let selectionMutations = 0;
  const phases = [];
  const selectionObserver = new window.MutationObserver((records) => {
    selectionMutations += records.length;
  });
  selectionObserver.observe(selection, { childList: true, characterData: true, subtree: true });
  const phaseObserver = new window.MutationObserver(() => {
    phases.push(phase.textContent);
  });
  phaseObserver.observe(phase, { childList: true, characterData: true, subtree: true });
  const sandbox = {
    require,
    process,
    Buffer,
    console,
    document: window.document,
    window,
    CSInterface,
    SystemPath: window.SystemPath,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window)
  };
  for (const name of ["HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLOutputElement", "HTMLImageElement", "HTMLSelectElement", "Element", "Node", "Event", "Document"]) {
    sandbox[name] = window[name];
  }
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox);
  return {
    dom,
    window,
    errors,
    phases,
    selectionMutations: () => selectionMutations,
    text: (id) => window.document.getElementById(id).textContent,
    close() {
      window.dispatchEvent(new window.Event("beforeunload"));
      selectionObserver.disconnect();
      phaseObserver.disconnect();
      window.close();
    }
  };
}

async function runPanel(bundle, extensionPath, jsxSource, tinyPng, scenario) {
  fs.writeFileSync(spawnLog, "");
  fs.writeFileSync(threadLog, "");
  const session = createSession(jsxSource, tinyPng, scenario.kind);
  const page = boot(bundle, extensionPath, session);
  try {
    await waitFor(() => {
      const status = page.text("status");
      return status !== "กำลังตรวจภาพ…" && status !== "พร้อมแปลงภาพที่เลือก";
    }, scenario.id + " refresh");
    const refreshMutations = page.selectionMutations();
    const refreshStatus = page.text("status");
    const refreshSelection = page.text("selection");
    if (scenario.switchBeforeTrace) session.doc.fullName = new HostFile(path.join(runtime, "other.ai"));
    if (scenario.trace && !page.window.document.getElementById("trace").disabled) {
      if (scenario.cancel) process.env.VECTOR_PANEL_VTRACER_DELAY_MS = "1200";
      page.window.document.getElementById("trace").click();
      if (scenario.cancel) {
        await waitFor(() => page.text("phase") === "กำลังแปลง", scenario.id + " tracing");
        page.window.document.getElementById("cancel").click();
        await waitFor(() => page.text("status").indexOf("ยกเลิกแล้ว") !== -1, scenario.id + " cancel " + page.text("status"));
      } else {
        await waitFor(() => {
          const status = page.text("status");
          return page.text("phase") === "พร้อมใส่ผล" || page.window.document.getElementById("status").classList.contains("error");
        }, scenario.id + " trace " + page.text("status") + " host=" + session.lastResult);
      }
      process.env.VECTOR_PANEL_VTRACER_DELAY_MS = "0";
    }
    if (scenario.inputAfterError) {
      const before = page.text("status");
      page.window.document.getElementById("colors").dispatchEvent(new page.window.Event("input", { bubbles: true }));
      check(page.text("status") === before, scenario.id + " status changed after a slider input");
    }
    if (scenario.apply && page.text("phase") === "พร้อมใส่ผล") {
      const layersBefore = session.doc.layers.length;
      if (scenario.switchBeforeApply) session.doc.fullName = new HostFile(path.join(runtime, "other-apply.ai"));
      page.window.document.getElementById("apply").click();
      await waitFor(() => page.text("status").indexOf("กำลังนำ path") === -1, scenario.id + " apply");
      scenario.layersAfterApply = session.doc.layers.length;
      scenario.layersBeforeApply = layersBefore;
    }
    const spawn = readSpawn(spawnLog);
    let thread = null;
    if (fs.existsSync(threadLog) && fs.statSync(threadLog).size > 0) {
      const lines = fs.readFileSync(threadLog, "utf8").trim().split(/\n/);
      thread = JSON.parse(lines[lines.length - 1]);
    }
    return {
      calls: aggregate(session.log),
      log: session.log,
      refreshMutations,
      selectionMutations: page.selectionMutations(),
      phases: page.phases,
      refreshStatus,
      refreshSelection,
      finalStatus: page.text("status"),
      finalSelection: page.text("selection"),
      finalPhase: page.text("phase"),
      previewHidden: page.window.document.getElementById("preview").hidden,
      traceDisabled: page.window.document.getElementById("trace").disabled,
      errors: page.errors,
      spawn,
      thread,
      overlapped: overlaps(session.log, spawn),
      captures: captures(session.log),
      layersBeforeApply: scenario.layersBeforeApply ?? null,
      layersAfterApply: scenario.layersAfterApply ?? null,
      lastResult: session.lastResult
    };
  } finally {
    process.env.VECTOR_PANEL_VTRACER_DELAY_MS = "0";
    page.close();
  }
}

function assertScenario(id, side, result, expect) {
  const prefix = id + " " + side;
  check(result.errors.length === 0, prefix + " page errors " + result.errors.join("; "));
  if (expect.refreshIncludes) check(result.refreshStatus.indexOf(expect.refreshIncludes) !== -1, prefix + " refresh status " + result.refreshStatus);
  if (expect.finalIncludes) check(result.finalStatus.indexOf(expect.finalIncludes) !== -1, prefix + " final status " + result.finalStatus);
  if (expect.selectionIncludes) check(result.finalSelection.indexOf(expect.selectionIncludes) !== -1, prefix + " selection " + result.finalSelection);
  if (expect.traceDisabled !== undefined) check(result.traceDisabled === expect.traceDisabled, prefix + " trace disabled " + result.traceDisabled);
  if (expect.copy !== undefined) check(count(result.log, "app.copy") === expect.copy, prefix + " app.copy " + count(result.log, "app.copy"));
  if (expect.paste !== undefined) check(count(result.log, "app.paste") === expect.paste, prefix + " app.paste " + count(result.log, "app.paste"));
  if (expect.addDoc !== undefined) check(count(result.log, "documents.add") === expect.addDoc, prefix + " documents.add " + count(result.log, "documents.add"));
  if (expect.capture !== undefined) check(count(result.log, "Document.imageCapture") === expect.capture, prefix + " imageCapture " + count(result.log, "Document.imageCapture"));
  if (expect.parked) {
    check(result.captures.length > 0 && result.captures.every((item) => item.left > 200), prefix + " capture was not parked " + JSON.stringify(result.captures));
  }
  if (expect.resolution !== undefined) {
    check(result.captures.some((item) => item.resolution === expect.resolution), prefix + " resolution " + JSON.stringify(result.captures));
  }
  if (expect.spawn) check(result.spawn !== null, prefix + " did not spawn vtracer");
  if (expect.noOverlap) check(result.overlapped === false, prefix + " evalScript overlapped vtracer");
  if (expect.worker) check(result.thread && result.thread.isMainThread === false && result.thread.threadId !== 0, prefix + " thread " + JSON.stringify(result.thread));
  if (expect.inline) check(result.thread && result.thread.isMainThread === true, prefix + " inline thread " + JSON.stringify(result.thread));
  if (expect.previewStays) check(result.previewHidden === false, prefix + " preview was cleared");
  if (expect.layersStable) check(result.layersAfterApply === result.layersBeforeApply, prefix + " layer count changed on failed apply");
}

function markdownTable(before, after, leftLabel = "Before", rightLabel = "After") {
  const names = new Set([...(before || []).map((row) => row.name), ...(after || []).map((row) => row.name)]);
  const lines = ["| Call | " + leftLabel + " count | " + leftLabel + " total ms | " + rightLabel + " count | " + rightLabel + " total ms |", "|---|---:|---:|---:|---:|"];
  for (const name of [...names].sort()) {
    const left = (before || []).find((row) => row.name === name);
    const right = (after || []).find((row) => row.name === name);
    lines.push("| `" + name + "` | " + (left ? left.count : 0) + " | " + ms(left) + " | " + (right ? right.count : 0) + " | " + ms(right) + " |");
  }
  return lines.join("\n");
}

function ms(row) {
  if (!row) return "0.000";
  return (row.totalNs / 1e6).toFixed(3);
}

function readAssigned(source, pattern) {
  const matched = pattern.exec(source);
  if (!matched) throw new Error("missing assignment " + pattern);
  return Number(matched[1]);
}

const html = fs.readFileSync(path.join(extensionDir, "index.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

fs.mkdirSync(path.join(runtime, "bin"), { recursive: true });
fs.copyFileSync(path.join(root, "test", "fixtures", "fake-vtracer.sh"), fakeVtracer);
fs.chmodSync(fakeVtracer, 0o755);
const logo = new PNG({ width: 40, height: 20 });
for (let index = 0; index < logo.data.length; index += 4) {
  logo.data[index] = 220;
  logo.data[index + 1] = 30;
  logo.data[index + 2] = 40;
  logo.data[index + 3] = 255;
}
const tinyPng = PNG.sync.write(logo);
fs.writeFileSync(pngFixture, tinyPng);
let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 10\">";
const listLines = [];
for (let index = 0; index < FIXTURE_PATHS; index += 1) {
  const d = "M " + index + " 0 L " + (index + 1) + " 0 L " + (index + 1) + " 1 Z";
  svg += "<path fill=\"#cc0000\" d=\"" + d + "\"/>";
  listLines.push(d);
}
svg += "</svg>";
fs.writeFileSync(svgFixture, svg);
fs.writeFileSync(pathList, listLines.join("\n"));
process.env.VECTOR_PANEL_VTRACER = fakeVtracer;
process.env.VECTOR_PANEL_SVG_FIXTURE = svgFixture;
process.env.VECTOR_PANEL_SPAWN_LOG = spawnLog;
process.env.VECTOR_PANEL_TRACE_DEBUG = threadLog;
process.env.VECTOR_PANEL_VTRACER_DELAY_MS = "0";
delete process.env.VECTOR_PANEL_NO_WORKER;

const dateProbe = spawnSync("date", ["+%s%3N"], { encoding: "utf8" });
check(dateProbe.status === 0 && /^\d+$/.test(dateProbe.stdout.trim()), "date +%s%3N did not return epoch milliseconds");

await esbuild.build({ entryPoints: [path.join(root, "src", "panel.ts")], bundle: true, platform: "node", format: "iife", target: "chrome99", outfile: path.join(extensionDir, "js", "panel.js") });
await esbuild.build({ entryPoints: [path.join(root, "src", "trace-worker.ts")], bundle: true, platform: "node", format: "cjs", target: "node14", outfile: path.join(extensionDir, "js", "trace-worker.js") });
await esbuild.build({ entryPoints: [path.join(root, "test", "fixtures", "before", "panel.ts")], bundle: true, platform: "node", format: "iife", target: "chrome99", outfile: path.join(runtime, "before-panel.js") });
await esbuild.build({ entryPoints: [path.join(root, "src", "image-prep.ts")], bundle: true, platform: "node", format: "cjs", outfile: path.join(runtime, "image-prep.cjs") });

const limitsSource = fs.readFileSync(path.join(root, "src", "limits.ts"), "utf8");
const hostSource = fs.readFileSync(path.join(extensionDir, "jsx", "host.jsx"), "utf8");
const beforeHost = fs.readFileSync(path.join(root, "test", "fixtures", "before", "host.jsx"), "utf8");
const afterBundle = fs.readFileSync(path.join(extensionDir, "js", "panel.js"), "utf8");
const beforeBundle = fs.readFileSync(path.join(runtime, "before-panel.js"), "utf8");
check(readAssigned(limitsSource, /export const MAX_TRACE_PIXELS = (\d+);/) === readAssigned(hostSource, /var VP_MAX_PIXELS = (\d+);/), "pixel cap drifted");
check(readAssigned(limitsSource, /export const MAX_DECODE_PIXELS = (\d+);/) === readAssigned(hostSource, /var VP_MAX_DECODE_PIXELS = (\d+);/), "decode cap drifted");
check(readAssigned(limitsSource, /export const TARGET_CAPTURE_PPI = (\d+);/) === readAssigned(hostSource, /var VP_TARGET_PPI = (\d+);/), "capture ppi drifted");
for (const file of ["src/panel.ts", "src/trace-job.ts", "src/trace-client.ts", "src/trace-worker.ts", "src/image-prep.ts", "extension/jsx/host.jsx"]) {
  check(!fs.readFileSync(path.join(root, file), "utf8").includes("execSync"), file + " contains execSync");
}

const prep = require(path.join(runtime, "image-prep.cjs"));
const resizeSource = path.join(runtime, "resize-source.png");
const resizeDest = path.join(runtime, "resize-dest.png");
const wide = new PNG({ width: 100, height: 100 });
for (let index = 0; index < wide.data.length; index += 4) {
  wide.data[index] = 10;
  wide.data[index + 1] = 180;
  wide.data[index + 2] = 90;
  wide.data[index + 3] = 255;
}
fs.writeFileSync(resizeSource, PNG.sync.write(wide));
const resizeStarted = process.hrtime.bigint();
const resizeMax = 2500;
const prepared = await prep.prepareTracePng(resizeSource, resizeDest, resizeMax, 20000000);
const resizeNs = Number(process.hrtime.bigint() - resizeStarted);
const resizeActual = await prep.readRasterSize(resizeDest);
const resizeScale = Math.sqrt(resizeMax / (100 * 100));
const resizeExpected = {
  width: Math.max(1, Math.floor(100 * resizeScale)),
  height: Math.max(1, Math.floor(100 * resizeScale))
};
check(prepared.width === resizeActual.width && prepared.height === resizeActual.height, "prepare result disagreed with the written PNG header");
check(resizeActual.width === resizeExpected.width && resizeActual.height === resizeExpected.height, "resize output " + JSON.stringify(resizeActual) + " expected " + JSON.stringify(resizeExpected));
const resizedPng = PNG.sync.read(fs.readFileSync(resizeDest));
check(resizedPng.data[1] > 0, "resized PNG green channel was empty");

const scenarios = [
  { id: "linked-placed", kind: "linked", trace: true, apply: true, expectSpawn: true },
  { id: "linked-cropped", kind: "cropped", trace: true, apply: true, expectSpawn: true },
  { id: "linked-rotated", kind: "rotated", trace: true, apply: true, expectSpawn: true },
  { id: "embedded-raster", kind: "raster", trace: true, apply: true, expectSpawn: true },
  { id: "plain-group", kind: "plain-group", trace: true, apply: true, expectSpawn: true },
  { id: "clip-group", kind: "clip-group", trace: true, apply: true, expectSpawn: true },
  { id: "two-rasters", kind: "two-rasters", trace: false, inputAfterError: true },
  { id: "retrace-group", kind: "retrace", trace: true, apply: true, expectSpawn: true },
  { id: "document-switch-trace", kind: "linked", trace: true, switchBeforeTrace: true },
  { id: "document-switch-apply", kind: "linked", trace: true, apply: true, switchBeforeApply: true, expectSpawn: true },
  { id: "cancel-trace", kind: "linked", trace: true, cancel: true, expectSpawn: true }
];

const results = [];
for (const scenario of scenarios) {
  const row = { id: scenario.id, before: null, after: null, error: null };
  try {
    delete process.env.VECTOR_PANEL_NO_WORKER;
    row.before = await runPanel(beforeBundle, beforeExtension, beforeHost, tinyPng, scenario);
    row.after = await runPanel(afterBundle, extensionDir, hostSource, tinyPng, scenario);
  } catch (error) {
    row.error = error instanceof Error ? error.stack || error.message : String(error);
    failures.push(scenario.id + " threw: " + row.error);
  }
  results.push(row);
}

let inline = null;
try {
  process.env.VECTOR_PANEL_NO_WORKER = "1";
  inline = await runPanel(afterBundle, extensionDir, hostSource, tinyPng, { id: "linked-placed-inline", kind: "linked", trace: true, apply: true, expectSpawn: true });
} catch (error) {
  failures.push("inline threw: " + (error instanceof Error ? error.stack || error.message : String(error)));
} finally {
  delete process.env.VECTOR_PANEL_NO_WORKER;
}

function expectFor(id, side) {
  const heavy = { copy: 1, paste: 1, addDoc: 1, capture: 1 };
  const calmLinked = { copy: 0, paste: 0, addDoc: 0, capture: 0, spawn: true, noOverlap: true, worker: true };
  const calmCapture = { copy: 0, paste: 0, addDoc: 0, capture: 1, parked: true, resolution: 144, spawn: true, noOverlap: true, worker: true };
  if (side === "before") {
    if (id === "two-rasters") return { refreshIncludes: "เลือกภาพ raster", traceDisabled: true, copy: 0, capture: 0 };
    if (id === "plain-group" || id === "clip-group") return { refreshIncludes: "เลือกภาพ raster", traceDisabled: true, copy: 0, capture: 0 };
    if (id === "document-switch-trace") return { finalIncludes: "เอกสารปัจจุบันเปลี่ยนไป", copy: 0, paste: 0, addDoc: 0, capture: 0 };
    if (id === "cancel-trace") return { ...heavy, finalIncludes: "ยกเลิก", selectionIncludes: "logo.png" };
    if (id === "document-switch-apply") return { ...heavy, finalIncludes: "เอกสารปัจจุบันเปลี่ยนไป", previewStays: true, layersStable: true };
    return { ...heavy, finalIncludes: id === "retrace-group" ? "ใส่ผลแล้ว" : "ใส่ผลแล้ว", selectionIncludes: id === "embedded-raster" ? "embedded" : "logo.png" };
  }
  if (id === "two-rasters") return { refreshIncludes: "มากกว่าหนึ่ง", traceDisabled: true, copy: 0, capture: 0 };
  if (id === "plain-group") return { ...calmLinked, refreshIncludes: "ภาพพร้อมแปลง", selectionIncludes: "logo.png", finalIncludes: "ใส่ผลแล้ว" };
  if (id === "clip-group" || id === "linked-cropped" || id === "linked-rotated" || id === "embedded-raster") {
    return { ...calmCapture, finalIncludes: "ใส่ผลแล้ว", selectionIncludes: id === "embedded-raster" ? "embedded" : "logo.png" };
  }
  if (id === "document-switch-trace") return { finalIncludes: "เอกสารปัจจุบันเปลี่ยนไป", selectionIncludes: "logo.png", copy: 0, paste: 0, addDoc: 0, capture: 0 };
  if (id === "cancel-trace") return { ...calmLinked, worker: true, finalIncludes: "ยกเลิก", selectionIncludes: "logo.png" };
  if (id === "document-switch-apply") return { ...calmLinked, finalIncludes: "เอกสารปัจจุบันเปลี่ยนไป", previewStays: true, layersStable: true };
  return { ...calmLinked, finalIncludes: "ใส่ผลแล้ว", selectionIncludes: "logo.png" };
}

for (const row of results) {
  if (!row.before || !row.after) continue;
  assertScenario(row.id, "before", row.before, expectFor(row.id, "before"));
  assertScenario(row.id, "after", row.after, expectFor(row.id, "after"));
  if (row.id === "linked-placed") {
    check(row.after.refreshMutations < row.before.refreshMutations, "linked refresh still mutates selection as much as before (" + row.before.refreshMutations + " vs " + row.after.refreshMutations + ")");
  }
}
if (inline) {
  assertScenario("linked-placed-inline", "after", inline, {
    copy: 0,
    paste: 0,
    addDoc: 0,
    capture: 0,
    spawn: true,
    noOverlap: true,
    inline: true,
    finalIncludes: "ใส่ผลแล้ว"
  });
}

const importSessionA = createSession(hostSource, tinyPng, "linked");
const importLogA = importSessionA.log;
importLogA.splice(0, importLogA.length);
const embedResult = importSessionA.evalScript('VP_commit("logo","' + encodeURIComponent(svgFixture) + '","0123456789abcdef","preset%3Dlogo","10,90,90,50","' + encodeURIComponent("file:" + importSessionA.doc.fullName.fsName) + '")');
const importSessionB = createSession(hostSource, tinyPng, "linked");
const importLogB = importSessionB.log;
importLogB.splice(0, importLogB.length);
const parseStarted = process.hrtime.bigint();
const parsedPaths = (fs.readFileSync(svgFixture, "utf8").match(/<path\b/g) || []).length;
const parseNs = Number(process.hrtime.bigint() - parseStarted);
const pathsResult = importSessionB.evalScript('VP_commitPaths("logo","' + encodeURIComponent(pathList) + '","0123456789abcdef","batched","10,90,90,50","' + encodeURIComponent("file:" + importSessionB.doc.fullName.fsName) + '")');
check(embedResult.startsWith("OK"), "place+embed returned " + embedResult);
check(pathsResult.startsWith("OK"), "batched paths returned " + pathsResult);
check(count(importLogA, "PlacedItem.embed") === 1, "embed count " + count(importLogA, "PlacedItem.embed"));
check(count(importLogA, "PathItem.add") === 0, "embed created paths through PathItem.add");
check(count(importLogA, "evalScript:VP_commit") === 1, "embed was not one evalScript");
check(count(importLogB, "PathItem.add") === FIXTURE_PATHS, "batched PathItem.add " + count(importLogB, "PathItem.add"));
check(count(importLogB, "PlacedItem.embed") === 0, "batched path import called embed");
check(count(importLogB, "evalScript:VP_commitPaths") === 1, "batched import was not one evalScript");
check(parsedPaths === FIXTURE_PATHS, "svg parse count " + parsedPaths);

const importComparison = {
  fixturePaths: FIXTURE_PATHS,
  nodeSvgParseNs: parseNs,
  placeEmbed: aggregate(importLogA),
  batchedPaths: aggregate(importLogB),
  placeEmbedResult: embedResult,
  batchedResult: pathsResult
};

const payload = {
  measuredAt: new Date().toISOString(),
  host: os.hostname(),
  platform: process.platform,
  node: process.version,
  note: "Counts and nanoseconds are wall-clock measurements of this Linux mock. Nested API times happen inside evalScript and are not added to it. They are not Illustrator timings.",
  resizeCheck: {
    inputPixels: 100 * 100,
    maxPixels: resizeMax,
    outputWidth: resizeActual.width,
    outputHeight: resizeActual.height,
    prepareNs: resizeNs
  },
  scenarios: results.map((row) => ({
    id: row.id,
    error: row.error,
    before: row.before ? summarize(row.before) : null,
    after: row.after ? summarize(row.after) : null
  })),
  inline: inline ? summarize(inline) : null,
  importComparison,
  failures
};

function summarize(result) {
  return {
    calls: result.calls,
    refreshMutations: result.refreshMutations,
    selectionMutations: result.selectionMutations,
    phases: result.phases,
    refreshStatus: result.refreshStatus,
    refreshSelection: result.refreshSelection,
    finalStatus: result.finalStatus,
    finalSelection: result.finalSelection,
    finalPhase: result.finalPhase,
    spawn: result.spawn,
    overlapped: result.overlapped,
    captures: result.captures,
    thread: result.thread,
    layersBeforeApply: result.layersBeforeApply,
    layersAfterApply: result.layersAfterApply
  };
}

const sections = [];
sections.push("# Main-thread simulation");
sections.push("");
sections.push("Measured at " + payload.measuredAt + " on " + payload.host + " / " + payload.platform + " / " + payload.node + ".");
sections.push(payload.note);
sections.push("");
for (const row of results) {
  sections.push("## " + row.id);
  sections.push("");
  if (row.error) sections.push("Error: " + row.error);
  if (row.before && row.after) {
    sections.push("Refresh selection mutations: before " + row.before.refreshMutations + ", after " + row.after.refreshMutations + ".");
    sections.push("");
    sections.push(markdownTable(row.before.calls, row.after.calls));
    sections.push("");
  }
}
sections.push("## import comparison (" + FIXTURE_PATHS + " SVG paths)");
sections.push("");
sections.push("Node SVG parse (not a main-thread call): " + (parseNs / 1e6).toFixed(3) + " ms.");
sections.push("");
    sections.push(markdownTable(importComparison.placeEmbed, importComparison.batchedPaths, "Place+embed", "Batched paths"));
sections.push("");
sections.push("## resize check");
sections.push("");
sections.push("Input 100×100, maxPixels " + resizeMax + ", output " + resizeActual.width + "×" + resizeActual.height + ", prepare " + (resizeNs / 1e6).toFixed(3) + " ms.");
sections.push("");
if (inline) {
  sections.push("## linked-placed inline fallback");
  sections.push("");
  sections.push(markdownTable([], inline.calls));
  sections.push("");
}
if (failures.length) {
  sections.push("## failures");
  sections.push("");
  for (const failure of failures) sections.push("- " + failure);
}

const markdown = sections.join("\n");
const artifactDir = "/opt/cursor/artifacts";
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, "mainthread-results.json"), JSON.stringify(payload, null, 2));
fs.writeFileSync(path.join(artifactDir, "mainthread-table.md"), markdown);
fs.writeFileSync("/tmp/mainthread-results.json", JSON.stringify(payload, null, 2));
fs.writeFileSync("/tmp/mainthread-table.md", markdown);
process.stdout.write(markdown + "\n");
if (failures.length) {
  process.stderr.write("\n" + failures.length + " checks failed\n");
  process.exit(1);
}

#target illustrator

var VP_TARGET_PPI = 144;
var VP_MAX_PIXELS = 4000000;
var VP_MAX_DECODE_PIXELS = 20000000;

function VP_limitsActive() {
  return VP_TARGET_PPI > 0 && VP_MAX_PIXELS > 0 && VP_MAX_DECODE_PIXELS > VP_MAX_PIXELS;
}

function VP_field(value) {
  return encodeURIComponent(String(value));
}

function VP_ok(values) {
  var parts = ["OK"];
  for (var i = 0; i < values.length; i++) parts.push(VP_field(values[i]));
  return parts.join("|");
}

function VP_message(error) {
  try {
    if (error && error.message) return String(error.message);
  } catch (ignored) {}
  return String(error);
}

function VP_error(error) {
  return "ERR|" + VP_field(VP_message(error));
}

function VP_isRaster(item) {
  return item && (item.typename === "PlacedItem" || item.typename === "RasterItem");
}

// Illustrator 30 getPageItemFromUuid() returns the wrapper group of a placed or embedded
// image, not the PlacedItem/RasterItem whose uuid was stored. Scan the document collections,
// then the wrapper's children.
function VP_image(documentRef, uuid) {
  var wanted = String(uuid);
  var item = null;
  try { item = documentRef.getPageItemFromUuid(wanted); } catch (ignored) {}
  if (VP_isRaster(item) && String(item.uuid) === wanted) return item;
  var lists = [];
  try { lists.push(documentRef.placedItems); } catch (ignoredPlaced) {}
  try { lists.push(documentRef.rasterItems); } catch (ignoredRaster) {}
  var l;
  for (l = 0; l < lists.length; l++) {
    var list = lists[l];
    if (!list) continue;
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].uuid) === wanted) return list[i];
    }
  }
  if (item && item.typename === "GroupItem") {
    var inner = VP_rastersIn(item);
    if (inner.length === 1 && String(inner[0].uuid) === wanted) return inner[0];
  }
  throw new Error("ไม่พบภาพต้นฉบับในเอกสารปัจจุบัน");
}

function VP_collect(collection, into) {
  if (!collection) return;
  for (var i = 0; i < collection.length; i++) into.push(collection[i]);
}

function VP_rastersIn(group) {
  var found = [];
  try { VP_collect(group.placedItems, found); } catch (ignored) {}
  try { VP_collect(group.rasterItems, found); } catch (ignoredAgain) {}
  if (found.length > 0) return found;
  var pageItems = null;
  try { pageItems = group.pageItems; } catch (ignoredPage) {}
  if (!pageItems) return found;
  for (var j = 0; j < pageItems.length; j++) {
    var child = pageItems[j];
    if (!child) continue;
    var parentMatches = false;
    try { parentMatches = child.parent === group; } catch (ignoredParent) {}
    if (!parentMatches) continue;
    if (child.typename === "PlacedItem" || child.typename === "RasterItem") found.push(child);
    else if (child.typename === "GroupItem") {
      var nested = VP_rastersIn(child);
      for (var k = 0; k < nested.length; k++) found.push(nested[k]);
    }
  }
  return found;
}

function VP_outerClip(item) {
  var parent = null;
  try { parent = item.parent; } catch (ignored) { return null; }
  var found = null;
  var guard = 0;
  while (parent && guard < 40) {
    guard++;
    var typename = "";
    try { typename = String(parent.typename); } catch (ignoredType) { break; }
    if (typename === "Layer" || typename === "Document") break;
    if (typename === "GroupItem") {
      try { if (parent.clipped) found = parent; } catch (ignoredClip) {}
    }
    try { parent = parent.parent; } catch (ignoredParent) { break; }
  }
  return found;
}

function VP_isSimpleScale(item) {
  var matrix = null;
  try { matrix = item.matrix; } catch (ignored) { return false; }
  if (!matrix) return false;
  // An unrotated, unflipped placement is [A>0, 0, 0, D<0]. Illustrator's y axis points up.
  if (Math.abs(Number(matrix.mValueB)) > 0.000001) return false;
  if (Math.abs(Number(matrix.mValueC)) > 0.000001) return false;
  if (!(Number(matrix.mValueA) > 0)) return false;
  if (!(Number(matrix.mValueD) < 0)) return false;
  return true;
}

function VP_isRasterName(name) {
  var lower = String(name || "").toLowerCase();
  var dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  var ext = lower.substring(dot);
  return ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".bmp" || ext === ".tif" || ext === ".tiff" || ext === ".tga" || ext === ".webp";
}

function VP_linkedRasterPath(item) {
  if (!item || item.typename !== "PlacedItem") return "";
  if (VP_outerClip(item)) return "";
  if (!VP_isSimpleScale(item)) return "";
  try {
    if (Number(item.opacity) < 100) return "";
  } catch (ignoredOpacity) {}
  try {
    var file = item.file;
    if (!file || !file.exists || !(file.length > 0)) return "";
    if (!VP_isRasterName(file.name)) return "";
    return String(file.fsName);
  } catch (ignoredFile) {
    return "";
  }
}

function VP_describe(item, fromResult, viaGroup) {
  var linkedPath = VP_linkedRasterPath(item);
  var clipped = false;
  try { clipped = VP_outerClip(item) ? true : false; } catch (ignored) {}
  return {
    source: item,
    fromResult: fromResult ? true : false,
    viaGroup: viaGroup ? true : false,
    acquire: linkedPath ? "file" : "capture",
    linkedPath: linkedPath,
    clipped: clipped
  };
}

function VP_selectionSource(documentRef) {
  var selected = documentRef.selection;
  if (!selected || selected.length !== 1) throw new Error("เลือกภาพหรือกลุ่มผล Vector Panel หนึ่งรายการ");
  var item = selected[0];
  if (item.typename === "PlacedItem" || item.typename === "RasterItem") return VP_describe(item, false, false);
  if (item.typename === "GroupItem") {
    var note = String(item.note || "");
    var matched = /^VectorPanel\/1\|source=([^|]+)\|/.exec(note);
    if (matched) return VP_describe(VP_image(documentRef, matched[1]), true, false);
    var rasters = VP_rastersIn(item);
    if (rasters.length === 1) return VP_describe(rasters[0], false, true);
    if (rasters.length > 1) throw new Error("กลุ่มนี้มีภาพ raster มากกว่าหนึ่งภาพ เลือกภาพเดียว");
    throw new Error("ไม่พบภาพ raster ในกลุ่มที่เลือก");
  }
  throw new Error("เลือกภาพ raster หรือกลุ่มที่มีภาพ raster หนึ่งภาพ");
}

function VP_boundsMatch(actual, expectedText) {
  var values = expectedText.split(",");
  if (values.length !== 4) return false;
  for (var i = 0; i < 4; i++) {
    var expected = Number(values[i]);
    if (!isFinite(expected) || Math.abs(Number(actual[i]) - expected) > 0.05) return false;
  }
  return true;
}

function VP_documentIdentity(documentRef) {
  try { return "file:" + documentRef.fullName.fsName; } catch (ignored) {}
  return "unsaved:" + documentRef.name;
}

var VP_STRIP_ROWS = 48;
var VP_MIN_PPI = 36;
var VP_MAX_PPI = 300;
var VP_CAPTURE_LAYER = "Vector Panel capture (temporary)";

function VP_capturePpi(widthPt, heightPt) {
  var area = widthPt * heightPt;
  if (!(area > 0)) return VP_MIN_PPI;
  var fitted = 72 * Math.sqrt(VP_MAX_PIXELS / area);
  if (fitted < VP_MIN_PPI) fitted = VP_MIN_PPI;
  if (fitted > VP_MAX_PPI) fitted = VP_MAX_PPI;
  return Math.floor(fitted);
}

function VP_captureLayer(doc) {
  var i;
  for (i = 0; i < doc.layers.length; i++) {
    if (doc.layers[i].name === VP_CAPTURE_LAYER) return doc.layers[i];
  }
  return null;
}

function VP_rasterizeTarget(item) {
  var clip = VP_outerClip(item);
  if (clip) return clip;
  return item;
}

function VP_snapshot() {
  try {
    if (app.documents.length === 0) throw new Error("เปิดเอกสาร Illustrator ก่อน");
    var doc = app.activeDocument;
    var resolved = VP_selectionSource(doc);
    var item = resolved.source;
    var bounds = item.geometricBounds;
    if (Number(bounds[2]) <= Number(bounds[0]) || Number(bounds[1]) <= Number(bounds[3])) throw new Error("ขนาดภาพที่เลือกไม่ถูกต้อง");
    var embedded = "0";
    try {
      if (item.typename === "RasterItem" && item.embedded) embedded = "1";
    } catch (ignoredEmbedded) {}
    return VP_ok([
      doc.name,
      VP_documentIdentity(doc),
      item.name || "ภาพที่เลือก",
      item.typename,
      item.uuid,
      bounds[0],
      bounds[1],
      bounds[2],
      bounds[3],
      embedded,
      resolved.fromResult ? "1" : "0",
      resolved.acquire,
      resolved.linkedPath,
      resolved.clipped ? "1" : "0",
      resolved.viaGroup ? "1" : "0"
    ]);
  } catch (error) {
    return VP_error(error);
  }
}

// Linked file: OK|file|path|bytes, with no pixel work. Anything else: park a duplicate and
// return OK|strips|count|ppi. Each following VP_captureStrip is one short imageCapture.
function VP_captureBegin(encodedUuid, encodedDocumentIdentity, encodedMode) {
  var previousLevel = null;
  try {
    var uuid = decodeURIComponent(encodedUuid);
    var documentIdentity = decodeURIComponent(encodedDocumentIdentity);
    var requested = encodedMode ? decodeURIComponent(encodedMode) : "";
    if (app.documents.length === 0) throw new Error("เอกสาร Illustrator ถูกปิดแล้ว");
    var doc = app.activeDocument;
    if (VP_documentIdentity(doc) !== documentIdentity) throw new Error("เอกสารปัจจุบันเปลี่ยนไป กรุณากดตรวจภาพอีกครั้ง");
    var source = VP_image(doc, uuid);
    if (requested !== "capture") {
      var linked = VP_linkedRasterPath(source);
      if (linked) {
        var linkedFile = new File(linked);
        return VP_ok(["file", linkedFile.fsName, linkedFile.length]);
      }
    }
    var bounds = source.geometricBounds;
    var width = Number(bounds[2]) - Number(bounds[0]);
    var height = Number(bounds[1]) - Number(bounds[3]);
    if (!(width > 0) || !(height > 0)) throw new Error("ขนาดภาพไม่ถูกต้อง");
    var ppi = VP_capturePpi(width, height);
    try {
      previousLevel = app.userInteractionLevel;
      app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    } catch (ignoredLevel) {}
    var stale = VP_captureLayer(doc);
    if (stale) {
      try { stale.locked = false; } catch (ignoredUnlock) {}
      stale.remove();
    }
    var previousLayer = null;
    try { previousLayer = doc.activeLayer; } catch (ignoredActive) {}
    var layer = doc.layers.add();
    layer.name = VP_CAPTURE_LAYER;
    var target = VP_rasterizeTarget(source);
    var copy = target.duplicate(layer, ElementPlacement.PLACEATBEGINNING);
    var copyBounds = copy.geometricBounds;
    var right = 0;
    var top = 0;
    var boards = doc.artboards;
    var a;
    for (a = 0; a < boards.length; a++) {
      var rect = boards[a].artboardRect;
      if (Number(rect[2]) > right) right = Number(rect[2]);
      if (Number(rect[1]) > top) top = Number(rect[1]);
    }
    copy.translate(right + 72 - Number(copyBounds[0]), top - Number(copyBounds[1]));
    try { layer.locked = true; } catch (ignoredLock) {}
    try { if (previousLayer) doc.activeLayer = previousLayer; } catch (ignoredRestore) {}
    var area = copy.visibleBounds;
    var stripPoints = VP_STRIP_ROWS * 72 / ppi;
    var count = Math.ceil((Number(area[1]) - Number(area[3])) / stripPoints - 1e-6);
    if (count < 1) count = 1;
    $.global.VP_captureState = {
      identity: documentIdentity,
      area: [Number(area[0]), Number(area[1]), Number(area[2]), Number(area[3])],
      ppi: ppi,
      stripPoints: stripPoints,
      count: count
    };
    return VP_ok(["strips", count, ppi]);
  } catch (error) {
    try { VP_captureEnd(); } catch (ignoredEnd) {}
    return VP_error(error);
  } finally {
    if (previousLevel !== null) {
      try { app.userInteractionLevel = previousLevel; } catch (ignoredLevelRestore) {}
    }
  }
}

function VP_captureStrip(encodedIndex, encodedPath) {
  try {
    var state = $.global.VP_captureState;
    if (!state) throw new Error("การอ่านภาพถูกยกเลิก กรุณาแปลงใหม่");
    if (app.documents.length === 0) throw new Error("เอกสาร Illustrator ถูกปิดแล้ว");
    var doc = app.activeDocument;
    if (VP_documentIdentity(doc) !== state.identity) throw new Error("เอกสารปัจจุบันเปลี่ยนไป กรุณาแปลงใหม่");
    if (!VP_captureLayer(doc)) throw new Error("ภาพชั่วคราวถูกลบระหว่างอ่าน กรุณาแปลงใหม่");
    var index = Number(decodeURIComponent(encodedIndex));
    var outputPath = decodeURIComponent(encodedPath);
    var stripTop = state.area[1] - index * state.stripPoints;
    var stripBottom = stripTop - state.stripPoints;
    if (stripBottom < state.area[3]) stripBottom = state.area[3];
    var options = new ImageCaptureOptions();
    options.antiAliasing = true;
    options.transparency = true;
    options.matte = false;
    options.resolution = state.ppi;
    doc.imageCapture(new File(outputPath), [state.area[0], stripTop, state.area[2], stripBottom], options);
    var file = new File(outputPath);
    if (!file.exists || file.length === 0) throw new Error("Illustrator ไม่ได้สร้างไฟล์ภาพชั่วคราว");
    return VP_ok([file.length]);
  } catch (error) {
    return VP_error(error);
  }
}

function VP_captureEnd() {
  try {
    $.global.VP_captureState = null;
    var d;
    for (d = 0; d < app.documents.length; d++) {
      var layer = VP_captureLayer(app.documents[d]);
      if (layer) {
        try { layer.locked = false; } catch (ignoredUnlock) {}
        layer.remove();
      }
    }
    return VP_ok(["done"]);
  } catch (error) {
    return VP_error(error);
  }
}

function VP_canvasFrame(group) {
  var i;
  for (i = group.pageItems.length - 1; i >= 0; i--) {
    var it = group.pageItems[i];
    if (it && it.name === "vp-canvas") return it;
  }
  return null;
}

// Native paths via GroupItems.createFromFile. Placing an SVG (PlacedItem.file) makes
// Illustrator 30 show a modal "cannot be placed" alert that blocks until OK.
function VP_commit(encodedUuid, encodedSvgPath, encodedJobId, encodedSettings, encodedBounds, encodedDocumentIdentity) {
  var createdLayer = null;
  var previousLevel = null;
  try {
    var uuid = decodeURIComponent(encodedUuid);
    var svgPath = decodeURIComponent(encodedSvgPath);
    var jobId = decodeURIComponent(encodedJobId);
    var settings = decodeURIComponent(encodedSettings);
    var boundsText = decodeURIComponent(encodedBounds);
    var documentIdentity = decodeURIComponent(encodedDocumentIdentity);
    if (!/^[0-9a-f]{16}$/.test(jobId)) throw new Error("รหัสงานไม่ถูกต้อง");
    if (app.documents.length === 0) throw new Error("เอกสาร Illustrator ถูกปิดแล้ว");
    var doc = app.activeDocument;
    if (VP_documentIdentity(doc) !== documentIdentity) throw new Error("เอกสารปัจจุบันเปลี่ยนไป กรุณาแปลงใหม่");
    var source = VP_image(doc, uuid);
    var bounds = source.geometricBounds;
    if (!VP_boundsMatch(bounds, boundsText)) throw new Error("ภาพต้นฉบับถูกย้ายหรือปรับขนาด กรุณาแปลงใหม่");
    var svgFile = new File(svgPath);
    if (!svgFile.exists || svgFile.length === 0) throw new Error("ไม่พบไฟล์เวกเตอร์จาก worker");
    try {
      previousLevel = app.userInteractionLevel;
      app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    } catch (ignoredLevel) {}
    createdLayer = doc.layers.add();
    createdLayer.name = "Vector Panel " + jobId;
    var holder = createdLayer.groupItems.createFromFile(svgFile);
    holder.name = "Trace " + jobId;
    var frame = VP_canvasFrame(holder);
    var compounds = 0;
    try { compounds = holder.compoundPathItems.length; } catch (ignoredCompounds) {}
    var addedPaths = holder.pathItems.length + compounds - (frame ? 1 : 0);
    if (!(addedPaths > 0)) throw new Error("Illustrator ไม่ได้แปลง SVG เป็น path ที่แก้ได้");
    var fitted = frame || holder;
    var fittedBounds = fitted.geometricBounds;
    var fittedWidth = Number(fittedBounds[2]) - Number(fittedBounds[0]);
    var fittedHeight = Number(fittedBounds[1]) - Number(fittedBounds[3]);
    if (!(fittedWidth > 0) || !(fittedHeight > 0)) throw new Error("ขนาดผลเวกเตอร์ไม่ถูกต้อง");
    var sx = (Number(bounds[2]) - Number(bounds[0])) / fittedWidth;
    var sy = (Number(bounds[1]) - Number(bounds[3])) / fittedHeight;
    holder.resize(sx * 100, sy * 100, true, true, true, true, sx * 100, Transformation.TOPLEFT);
    fittedBounds = fitted.geometricBounds;
    holder.translate(Number(bounds[0]) - Number(fittedBounds[0]), Number(bounds[1]) - Number(fittedBounds[1]));
    if (frame) frame.remove();
    holder.note = "VectorPanel/1|source=" + uuid + "|job=" + jobId + "|settings=" + encodeURIComponent(settings);
    source.selected = false;
    holder.selected = true;
    return VP_ok([holder.uuid, addedPaths]);
  } catch (error) {
    if (createdLayer !== null) {
      try { createdLayer.remove(); } catch (ignored) {}
    }
    return VP_error(error);
  } finally {
    if (previousLevel !== null) {
      try { app.userInteractionLevel = previousLevel; } catch (ignoredLevelRestore) {}
    }
  }
}

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

function VP_image(documentRef, uuid) {
  var item = null;
  try { item = documentRef.getPageItemFromUuid(uuid); } catch (ignored) {}
  if (!item) throw new Error("ไม่พบภาพต้นฉบับในเอกสารปัจจุบัน");
  if (item.typename !== "PlacedItem" && item.typename !== "RasterItem") throw new Error("ต้นฉบับไม่ใช่ภาพ raster");
  return item;
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
  if (Math.abs(Number(matrix.mValueB)) > 0.001) return false;
  if (Math.abs(Number(matrix.mValueC)) > 0.001) return false;
  if (!(Number(matrix.mValueA) > 0)) return false;
  if (!(Number(matrix.mValueD) > 0)) return false;
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

function VP_resolution(widthPt, heightPt) {
  var ppi = VP_TARGET_PPI;
  var widthPx = widthPt * ppi / 72;
  var heightPx = heightPt * ppi / 72;
  if (widthPx < 1) widthPx = 1;
  if (heightPx < 1) heightPx = 1;
  var pixels = widthPx * heightPx;
  if (pixels > VP_MAX_PIXELS) ppi = ppi * Math.sqrt(VP_MAX_PIXELS / pixels);
  var rounded = Math.round(ppi);
  if (rounded < 1) rounded = 1;
  if (!VP_limitsActive()) return VP_TARGET_PPI;
  return rounded;
}

function VP_parkPoint(doc, width, height) {
  var right = 0;
  var top = 0;
  var boards = doc.artboards;
  for (var i = 0; i < boards.length; i++) {
    var rect = boards[i].artboardRect;
    if (Number(rect[2]) > right) right = Number(rect[2]);
    if (Number(rect[1]) > top) top = Number(rect[1]);
  }
  return [right + width + 72, top + height + 72];
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

function VP_capture(encodedUuid, encodedPath, encodedDocumentIdentity, encodedMode) {
  var temporaryLayer = null;
  var previousInteraction = null;
  var interactionChanged = false;
  try {
    var uuid = decodeURIComponent(encodedUuid);
    var outputPath = decodeURIComponent(encodedPath);
    var documentIdentity = decodeURIComponent(encodedDocumentIdentity);
    var requested = encodedMode ? decodeURIComponent(encodedMode) : "";
    if (app.documents.length === 0) throw new Error("เอกสาร Illustrator ถูกปิดแล้ว");
    var sourceDocument = app.activeDocument;
    if (VP_documentIdentity(sourceDocument) !== documentIdentity) throw new Error("เอกสารปัจจุบันเปลี่ยนไป กรุณากดตรวจภาพอีกครั้ง");
    var resolved = VP_selectionSource(sourceDocument);
    if (resolved.source.uuid !== uuid) throw new Error("ภาพที่เลือกเปลี่ยนไป กรุณากดตรวจภาพอีกครั้ง");
    var source = resolved.source;
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
    try {
      previousInteraction = app.userInteractionLevel;
      app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
      interactionChanged = true;
    } catch (ignoredLevel) {}
    var previousLayer = null;
    try { previousLayer = sourceDocument.activeLayer; } catch (ignoredActive) {}
    temporaryLayer = sourceDocument.layers.add();
    temporaryLayer.name = "Vector Panel Export";
    var target = VP_rasterizeTarget(source);
    var duplicate = target.duplicate(temporaryLayer, ElementPlacement.PLACEATBEGINNING);
    var duplicateBounds = duplicate.geometricBounds;
    var duplicateWidth = Number(duplicateBounds[2]) - Number(duplicateBounds[0]);
    var duplicateHeight = Number(duplicateBounds[1]) - Number(duplicateBounds[3]);
    var park = VP_parkPoint(sourceDocument, duplicateWidth, duplicateHeight);
    duplicate.translate(park[0] - Number(duplicateBounds[0]), park[1] - Number(duplicateBounds[1]));
    var options = new ImageCaptureOptions();
    options.antiAliasing = true;
    options.transparency = true;
    options.matte = false;
    options.resolution = VP_resolution(duplicateWidth, duplicateHeight);
    sourceDocument.imageCapture(new File(outputPath), duplicate.visibleBounds, options);
    var imageFile = new File(outputPath);
    if (!imageFile.exists || imageFile.length === 0) throw new Error("Illustrator ไม่ได้สร้างไฟล์ภาพชั่วคราว");
    try { if (previousLayer) sourceDocument.activeLayer = previousLayer; } catch (ignoredRestore) {}
    return VP_ok(["capture", imageFile.fsName, imageFile.length]);
  } catch (error) {
    return VP_error(error);
  } finally {
    if (temporaryLayer !== null) {
      try { temporaryLayer.remove(); } catch (ignoredRemove) {}
    }
    if (interactionChanged) {
      try { app.userInteractionLevel = previousInteraction; } catch (ignoredLevelRestore) {}
    }
  }
}

function VP_countPaths(container) {
  try { return container.pathItems.length; } catch (ignored) { return 0; }
}

function VP_commit(encodedUuid, encodedSvgPath, encodedJobId, encodedSettings, encodedBounds, encodedDocumentIdentity) {
  var createdLayer = null;
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
    var width = Number(bounds[2]) - Number(bounds[0]);
    var height = Number(bounds[1]) - Number(bounds[3]);
    createdLayer = doc.layers.add();
    createdLayer.name = "Vector Panel " + jobId;
    var holder = createdLayer.groupItems.add();
    holder.name = "Trace " + jobId;
    var placed = holder.placedItems.add();
    placed.file = svgFile;
    placed.width = width;
    placed.height = height;
    placed.position = [Number(bounds[0]), Number(bounds[1])];
    placed.embed();
    var addedPaths = VP_countPaths(holder);
    if (!(addedPaths > 0)) throw new Error("Illustrator ไม่ได้แปลง SVG เป็น path ที่แก้ได้");
    holder.note = "VectorPanel/1|source=" + uuid + "|job=" + jobId + "|settings=" + encodeURIComponent(settings);
    source.selected = false;
    holder.selected = true;
    return VP_ok([holder.uuid, addedPaths]);
  } catch (error) {
    if (createdLayer !== null) {
      try { createdLayer.remove(); } catch (ignored) {}
    }
    return VP_error(error);
  }
}

#target illustrator

function VP_field(value) {
  return encodeURIComponent(String(value));
}

function VP_ok(values) {
  var parts = ["OK"];
  for (var i = 0; i < values.length; i++) parts.push(VP_field(values[i]));
  return parts.join("|");
}

function VP_error(error) {
  return "ERR|" + VP_field(error);
}

function VP_isRaster(item) {
  return !!item && (item.typename === "PlacedItem" || item.typename === "RasterItem");
}

function VP_area(item) {
  var bounds = item.geometricBounds;
  var width = Number(bounds[2]) - Number(bounds[0]);
  var height = Number(bounds[1]) - Number(bounds[3]);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function VP_collectRasters(item, found, seen) {
  if (!item) return;
  var uuid = "";
  try { uuid = String(item.uuid || ""); } catch (ignored) {}
  if (uuid && seen[uuid]) return;
  if (uuid) seen[uuid] = true;
  if (VP_isRaster(item)) {
    found.push(item);
    return;
  }
  if (item.typename !== "GroupItem") return;
  var kids = null;
  try { kids = item.pageItems; } catch (ignoredKids) { return; }
  for (var i = 0; i < kids.length; i++) VP_collectRasters(kids[i], found, seen);
}

function VP_largestRaster(item) {
  var found = [];
  VP_collectRasters(item, found, {});
  var best = null;
  var bestArea = 0;
  for (var i = 0; i < found.length; i++) {
    var size = VP_area(found[i]);
    if (size > bestArea) {
      best = found[i];
      bestArea = size;
    }
  }
  return best;
}

function VP_pageItem(documentRef, uuid) {
  try { return documentRef.getPageItemFromUuid(uuid); } catch (ignored) {}
  return null;
}

function VP_image(documentRef, uuid) {
  var item = VP_pageItem(documentRef, uuid);
  if (!item) throw new Error("ไม่พบภาพต้นฉบับในเอกสารปัจจุบัน");
  if (VP_isRaster(item)) return item;
  var inner = VP_largestRaster(item);
  if (inner) return inner;
  throw new Error("ไม่พบภาพ raster ในรายการนี้");
}

function VP_selectionSource(documentRef) {
  var selected = documentRef.selection;
  if (!selected || selected.length !== 1) throw new Error("เลือกภาพหรือกลุ่มหนึ่งรายการ");
  var item = selected[0];
  if (VP_isRaster(item)) return { source: item, fromResult: false };
  if (item.typename === "GroupItem") {
    var note = String(item.note || "");
    var matched = /^VectorPanel\/1\|source=([^|]+)\|/.exec(note);
    if (matched) {
      var linked = VP_pageItem(documentRef, matched[1]);
      if (VP_isRaster(linked)) return { source: linked, fromResult: true };
      var linkedRaster = VP_largestRaster(linked);
      if (linkedRaster) return { source: linkedRaster, fromResult: true };
    }
    var inner = VP_largestRaster(item);
    if (inner) return { source: inner, fromResult: false };
  }
  return { source: item, fromResult: false };
}

function VP_recordedBounds(boundsText) {
  var values = String(boundsText).split(",");
  if (values.length !== 4) throw new Error("ตำแหน่งผลลัพธ์ไม่ถูกต้อง");
  var bounds = [];
  for (var i = 0; i < 4; i++) {
    var value = Number(values[i]);
    if (!isFinite(value)) throw new Error("ตำแหน่งผลลัพธ์ไม่ถูกต้อง");
    bounds.push(value);
  }
  return bounds;
}

function VP_commitBounds(item, recorded) {
  var recordedText = recorded.join(",");
  if (!item) return recorded;
  if (VP_boundsMatch(item.geometricBounds, recordedText)) return item.geometricBounds;
  var found = [];
  VP_collectRasters(item, found, {});
  for (var i = 0; i < found.length; i++) {
    if (VP_boundsMatch(found[i].geometricBounds, recordedText)) return found[i].geometricBounds;
  }
  if (VP_isRaster(item) || found.length > 0) throw new Error("ภาพต้นฉบับถูกย้ายหรือปรับขนาด กรุณาแปลงใหม่");
  return recorded;
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

function VP_hiddenOrLocked(item) {
  var node = item;
  var guard = 0;
  while (node && guard < 30) {
    guard++;
    if (node.typename === "Document" || node.typename === "Application") break;
    try {
      if (node.hidden === true || node.locked === true) return true;
    } catch (ignored) {}
    try { node = node.parent; } catch (ignoredParent) { break; }
  }
  return false;
}

function VP_list() {
  try {
    if (app.documents.length === 0) throw new Error("เปิดเอกสาร Illustrator ก่อน");
    var doc = app.activeDocument;
    var values = [doc.name, VP_documentIdentity(doc), "0"];
    var found = 0;
    var seen = {};
    var visit = function (item) {
      if (!item || found >= 12) return;
      var uuid = "";
      try { uuid = String(item.uuid || ""); } catch (ignoredUuid) {}
      if (uuid && seen[uuid]) return;
      if (uuid) seen[uuid] = true;
      if (item.typename === "GroupItem") {
        if (String(item.note || "").indexOf("VectorPanel/1|") === 0) return;
        var kids = null;
        try { kids = item.pageItems; } catch (ignoredKids) { return; }
        for (var k = 0; k < kids.length; k++) visit(kids[k]);
        return;
      }
      if (!VP_isRaster(item) || VP_hiddenOrLocked(item)) return;
      var b = item.geometricBounds;
      if (Number(b[2]) <= Number(b[0]) || Number(b[1]) <= Number(b[3])) return;
      values.push(item.uuid, item.name || "ภาพที่เลือก", item.typename, item.typename === "RasterItem" && item.embedded ? "1" : "0", b[0], b[1], b[2], b[3]);
      found++;
    };
    for (var i = 0; i < doc.pageItems.length && found < 12; i++) visit(doc.pageItems[i]);
    values[2] = String(found);
    return VP_ok(values);
  } catch (error) {
    return VP_error(error);
  }
}

function VP_snapshot() {
  try {
    if (app.documents.length === 0) throw new Error("เปิดเอกสาร Illustrator ก่อน");
    var doc = app.activeDocument;
    var resolved = VP_selectionSource(doc);
    var item = resolved.source;
    var b = item.geometricBounds;
    if (Number(b[2]) <= Number(b[0]) || Number(b[1]) <= Number(b[3])) throw new Error("ขนาดภาพที่เลือกไม่ถูกต้อง");
    return VP_ok([doc.name, VP_documentIdentity(doc), item.name || "ภาพที่เลือก", item.typename, item.uuid, b[0], b[1], b[2], b[3], item.typename === "RasterItem" && item.embedded ? "1" : "0", resolved.fromResult ? "1" : "0"]);
  } catch (error) {
    return VP_error(error);
  }
}

function VP_capture(encodedUuid, encodedPath, encodedDocumentIdentity, encodedBatch) {
  var temporary = null;
  var sourceDocument = null;
  var source = null;
  var selectedBeforeCopy = null;
  try {
    var uuid = decodeURIComponent(encodedUuid);
    var outputPath = decodeURIComponent(encodedPath);
    var documentIdentity = decodeURIComponent(encodedDocumentIdentity);
    var batch = typeof encodedBatch === "string" && decodeURIComponent(encodedBatch) === "1";
    if (app.documents.length === 0) throw new Error("เอกสาร Illustrator ถูกปิดแล้ว");
    sourceDocument = app.activeDocument;
    if (VP_documentIdentity(sourceDocument) !== documentIdentity) throw new Error("เอกสารปัจจุบันเปลี่ยนไป กรุณากดตรวจภาพอีกครั้ง");
    if (batch) {
      source = VP_image(sourceDocument, uuid);
    } else {
      var resolved = VP_selectionSource(sourceDocument);
      if (resolved.source.uuid !== uuid) throw new Error("ภาพที่เลือกเปลี่ยนไป กรุณากดตรวจภาพอีกครั้ง");
      source = resolved.source;
    }
    var bounds = source.geometricBounds;
    var width = Number(bounds[2]) - Number(bounds[0]);
    var height = Number(bounds[1]) - Number(bounds[3]);
    if (width <= 0 || height <= 0) throw new Error("ขนาดภาพไม่ถูกต้อง");

    try { selectedBeforeCopy = sourceDocument.selection[0]; } catch (ignoredSelection) {}
    if (selectedBeforeCopy) selectedBeforeCopy.selected = false;
    source.selected = true;
    app.copy();
    temporary = app.documents.add(sourceDocument.documentColorSpace, Math.max(10, width), Math.max(10, height));
    app.paste();
    var pasted = temporary.selection;
    if (!pasted || pasted.length === 0) throw new Error("คัดลอกภาพไปเอกสารชั่วคราวไม่สำเร็จ");
    var firstBounds = pasted[0].visibleBounds;
    var captureBounds = [Number(firstBounds[0]), Number(firstBounds[1]), Number(firstBounds[2]), Number(firstBounds[3])];
    for (var p = 1; p < pasted.length; p++) {
      var piece = pasted[p].visibleBounds;
      if (Number(piece[0]) < captureBounds[0]) captureBounds[0] = Number(piece[0]);
      if (Number(piece[1]) > captureBounds[1]) captureBounds[1] = Number(piece[1]);
      if (Number(piece[2]) > captureBounds[2]) captureBounds[2] = Number(piece[2]);
      if (Number(piece[3]) < captureBounds[3]) captureBounds[3] = Number(piece[3]);
    }
    var options = new ImageCaptureOptions();
    options.antiAliasing = true;
    options.transparency = true;
    options.matte = false;
    options.resolution = 144;
    temporary.imageCapture(new File(outputPath), captureBounds, options);
    var imageFile = new File(outputPath);
    if (!imageFile.exists || imageFile.length === 0) throw new Error("Illustrator ไม่ได้สร้างไฟล์ภาพชั่วคราว");
    return VP_ok([imageFile.fsName, imageFile.length]);
  } catch (error) {
    return VP_error(error);
  } finally {
    if (temporary !== null) {
      try { temporary.close(SaveOptions.DONOTSAVECHANGES); } catch (ignored) {}
    }
    if (sourceDocument !== null) {
      try {
        sourceDocument.activate();
        if (typeof selectedBeforeCopy !== "undefined" && selectedBeforeCopy !== null) {
          source.selected = false;
          selectedBeforeCopy.selected = true;
        }
      } catch (ignoredAgain) {}
    }
  }
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
    var source = VP_pageItem(doc, uuid);
    var bounds = VP_commitBounds(source, VP_recordedBounds(boundsText));
    var svgFile = new File(svgPath);
    if (!svgFile.exists || svgFile.length === 0) throw new Error("ไม่พบไฟล์เวกเตอร์จาก worker");

    var beforePaths = doc.pathItems.length;
    createdLayer = doc.layers.add();
    createdLayer.name = "Vector Panel " + jobId;
    var holder = createdLayer.groupItems.add();
    holder.name = "Trace " + jobId;
    var placed = holder.placedItems.add();
    placed.file = svgFile;
    placed.width = Number(bounds[2]) - Number(bounds[0]);
    placed.height = Number(bounds[1]) - Number(bounds[3]);
    placed.position = [Number(bounds[0]), Number(bounds[1])];
    placed.embed();

    var addedPaths = doc.pathItems.length - beforePaths;
    if (addedPaths <= 0) throw new Error("Illustrator ไม่ได้แปลง SVG เป็น path ที่แก้ได้");
    holder.note = "VectorPanel/1|source=" + uuid + "|job=" + jobId + "|settings=" + encodeURIComponent(settings);
    if (source) {
      try { source.selected = false; } catch (ignoredSelect) {}
    }
    holder.selected = true;
    return VP_ok([holder.uuid, addedPaths]);
  } catch (error) {
    if (createdLayer !== null) {
      try { createdLayer.remove(); } catch (ignored) {}
    }
    return VP_error(error);
  }
}

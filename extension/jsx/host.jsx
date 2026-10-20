#target illustrator

// Every function here runs on Illustrator's main thread (CEP evalScript / ExtendScript).
// Keep each call short: read metadata, hand file paths to the panel, and do only the DOM
// work that has no off-thread alternative (pixel capture of embedded art, SVG import).

function VP_field(value) {
  return encodeURIComponent(String(value));
}

function VP_ok(values) {
  var parts = ["OK"];
  for (var i = 0; i < values.length; i++) parts.push(VP_field(values[i]));
  return parts.join("|");
}

function VP_error(error) {
  var text = error && error.message ? error.message : String(error);
  // Unexpected (non-Thai, script-level) errors get a line number so they can be reported.
  if (error && error.line && !/[\u0E00-\u0E7F]/.test(text)) text += " (host.jsx:" + error.line + ")";
  return "ERR|" + VP_field(text);
}

function VP_isRaster(item) {
  return item && (item.typename === "PlacedItem" || item.typename === "RasterItem");
}

// Document.getPageItemFromUuid() can return the wrapper group of a PlacedItem in Illustrator 30
// instead of the item itself, so fall back to a direct scan of placed/raster items.
function VP_image(documentRef, uuid) {
  var item = null;
  try { item = documentRef.getPageItemFromUuid(uuid); } catch (ignored) {}
  if (VP_isRaster(item) && String(item.uuid) === String(uuid)) return item;
  var lists = [documentRef.placedItems, documentRef.rasterItems];
  for (var l = 0; l < lists.length; l++) {
    for (var i = 0; i < lists[l].length; i++) {
      if (String(lists[l][i].uuid) === String(uuid)) return lists[l][i];
    }
  }
  if (item && item.typename === "GroupItem") {
    var inner = VP_findRaster(item, 0);
    if (inner && String(inner.uuid) === String(uuid)) return inner;
  }
  throw new Error("ไม่พบภาพต้นฉบับในเอกสารปัจจุบัน");
}

// Find the single raster inside a plain group or a clipping group (depth-limited).
function VP_findRaster(group, depth) {
  if (depth > 4) return null;
  var found = null;
  for (var i = 0; i < group.pageItems.length; i++) {
    var child = group.pageItems[i];
    var hit = null;
    if (VP_isRaster(child)) hit = child;
    else if (child.typename === "GroupItem") hit = VP_findRaster(child, depth + 1);
    if (hit) {
      if (found) throw new Error("กลุ่มนี้มีภาพ raster มากกว่าหนึ่งภาพ เลือกภาพเดียวด้วย Direct Selection");
      found = hit;
    }
  }
  return found;
}

function VP_selectionSource(documentRef) {
  var selected = documentRef.selection;
  if (!selected || selected.length === undefined || selected.length === 0) throw new Error("ยังไม่ได้เลือกภาพ — เลือกภาพ raster หนึ่งภาพบน artboard แล้วกดตรวจภาพ");
  if (selected.length !== 1) {
    // Direct-selecting inside a clipping group yields [clipPath, image]; accept exactly one raster.
    var rasters = [];
    for (var s = 0; s < selected.length; s++) if (VP_isRaster(selected[s])) rasters.push(selected[s]);
    if (rasters.length === 1) return { source: rasters[0], fromResult: false };
    throw new Error("เลือกไว้ " + selected.length + " ชิ้น — เลือกภาพ raster หรือกลุ่มที่มีภาพเดียว");
  }
  var item = selected[0];
  if (VP_isRaster(item)) return { source: item, fromResult: false };
  if (item.typename === "GroupItem") {
    var note = String(item.note || "");
    var matched = /^VectorPanel\/1\|source=([^|]+)\|/.exec(note);
    if (matched) return { source: VP_image(documentRef, matched[1]), fromResult: true };
    var inner = VP_findRaster(item, 0);
    if (inner) return { source: inner, fromResult: false };
    throw new Error("กลุ่มที่เลือกไม่มีภาพ raster");
  }
  throw new Error("สิ่งที่เลือกเป็น " + item.typename + " ไม่ใช่ภาพ raster");
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

// Linked file that the panel may read directly instead of asking Illustrator to render pixels.
// Only when the placement is an axis-aligned, unflipped scale (no rotation/shear), so the file's
// pixels map onto geometricBounds by a plain scale.
function VP_linkedPath(item) {
  if (item.typename !== "PlacedItem") return "";
  try {
    var f = item.file;
    if (!f || !f.exists) return "";
    var m = item.matrix;
    // Illustrator's art matrix for an unrotated, unflipped image is [A>0, 0, 0, D<0] (y axis up).
    if (Math.abs(m.mValueB) > 1e-6 || Math.abs(m.mValueC) > 1e-6 || m.mValueA <= 0 || m.mValueD >= 0) return "";
    return f.fsName;
  } catch (ignored) {
    return "";
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
    var embedded = item.typename === "RasterItem" ? (item.embedded ? "1" : "0") : "0";
    return VP_ok([doc.name, VP_documentIdentity(doc), item.name || "ภาพที่เลือก", item.typename, item.uuid, b[0], b[1], b[2], b[3], embedded, resolved.fromResult ? "1" : "0", VP_linkedPath(item)]);
  } catch (error) {
    return VP_error(error);
  }
}

// Returns OK|link|<path> (no pixel work on the main thread) or OK|png|<path>|<bytes>.
// maxPixels caps the capture size so imageCapture never renders more than the tracer needs.
function VP_capture(encodedUuid, encodedPath, encodedDocumentIdentity, encodedMaxPixels) {
  var temporary = null;
  var previousLevel = null;
  try {
    var uuid = decodeURIComponent(encodedUuid);
    var outputPath = decodeURIComponent(encodedPath);
    var documentIdentity = decodeURIComponent(encodedDocumentIdentity);
    var maxPixels = Number(decodeURIComponent(encodedMaxPixels || "")) || 4000000;
    if (app.documents.length === 0) throw new Error("เอกสาร Illustrator ถูกปิดแล้ว");
    var sourceDocument = app.activeDocument;
    if (VP_documentIdentity(sourceDocument) !== documentIdentity) throw new Error("เอกสารปัจจุบันเปลี่ยนไป กรุณากดตรวจภาพอีกครั้ง");
    var source = VP_image(sourceDocument, uuid);

    var linked = VP_linkedPath(source);
    if (linked !== "") return VP_ok(["link", linked]);

    var bounds = source.geometricBounds;
    var width = Number(bounds[2]) - Number(bounds[0]);
    var height = Number(bounds[1]) - Number(bounds[3]);
    if (width <= 0 || height <= 0) throw new Error("ขนาดภาพไม่ถูกต้อง");
    // pixels = (w/72*ppi)*(h/72*ppi) <= maxPixels  →  ppi <= 72*sqrt(maxPixels/(w*h))
    var resolution = Math.min(300, Math.max(36, Math.floor(72 * Math.sqrt(maxPixels / (width * height)))));

    previousLevel = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    // duplicate() into a scratch document: no clipboard round trip, selection untouched.
    temporary = app.documents.add(sourceDocument.documentColorSpace, Math.max(10, width), Math.max(10, height));
    var copy = source.duplicate(temporary.layers[0], ElementPlacement.PLACEATBEGINNING);
    var captureBounds = copy.visibleBounds;
    var options = new ImageCaptureOptions();
    options.antiAliasing = true;
    options.transparency = true;
    options.matte = false;
    options.resolution = resolution;
    temporary.imageCapture(new File(outputPath), captureBounds, options);
    var imageFile = new File(outputPath);
    if (!imageFile.exists || imageFile.length === 0) throw new Error("Illustrator ไม่ได้สร้างไฟล์ภาพชั่วคราว");
    return VP_ok(["png", imageFile.fsName, imageFile.length, resolution]);
  } catch (error) {
    return VP_error(error);
  } finally {
    if (temporary !== null) {
      try { temporary.close(SaveOptions.DONOTSAVECHANGES); } catch (ignored) {}
      try { sourceDocument.activate(); } catch (ignoredAgain) {}
    }
    if (previousLevel !== null) {
      try { app.userInteractionLevel = previousLevel; } catch (ignoredLevel) {}
    }
  }
}

// Import the tracer's SVG as native, editable art. GroupItems.createFromFile() converts SVG to
// paths/compound paths directly. (PlacedItem.file = *.svg is refused by Illustrator 30 with a
// modal "cannot be placed" alert that blocks the main thread until someone clicks OK.)
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

    previousLevel = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    createdLayer = doc.layers.add();
    createdLayer.name = "Vector Panel " + jobId;
    var holder = createdLayer.groupItems.createFromFile(svgFile);
    holder.name = "Trace " + jobId;
    var addedPaths = holder.pathItems.length + holder.compoundPathItems.length - (VP_canvasFrame(holder) ? 1 : 0);
    if (addedPaths <= 0) throw new Error("Illustrator ไม่ได้แปลง SVG เป็น path ที่แก้ได้");

    // The panel adds an invisible <rect id="vp-canvas"> covering the whole SVG canvas so the
    // group registers with the source raster (transparent margins included). Fit it, then drop it.
    var frame = VP_canvasFrame(holder);
    var fb = (frame || holder).geometricBounds;
    var sx = (Number(bounds[2]) - Number(bounds[0])) / (Number(fb[2]) - Number(fb[0]));
    var sy = (Number(bounds[1]) - Number(bounds[3])) / (Number(fb[1]) - Number(fb[3]));
    holder.resize(sx * 100, sy * 100, true, true, true, true, sx * 100, Transformation.TOPLEFT);
    fb = (frame || holder).geometricBounds;
    holder.translate(Number(bounds[0]) - Number(fb[0]), Number(bounds[1]) - Number(fb[1]));
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
      try { app.userInteractionLevel = previousLevel; } catch (ignoredLevel) {}
    }
  }
}

function VP_canvasFrame(group) {
  for (var i = group.pageItems.length - 1; i >= 0; i--) {
    var it = group.pageItems[i];
    if (it.name === "vp-canvas") return it;
  }
  return null;
}

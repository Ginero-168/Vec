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

function VP_image(documentRef, uuid) {
  var item = null;
  try { item = documentRef.getPageItemFromUuid(uuid); } catch (ignored) {}
  if (!item) throw new Error("ไม่พบภาพต้นฉบับในเอกสารปัจจุบัน");
  if (item.typename !== "PlacedItem" && item.typename !== "RasterItem") throw new Error("ต้นฉบับไม่ใช่ภาพ raster");
  return item;
}

function VP_selectionSource(documentRef) {
  var selected = documentRef.selection;
  if (!selected || selected.length !== 1) throw new Error("เลือกภาพหรือกลุ่มผล Vector Panel หนึ่งรายการ");
  var item = selected[0];
  if (item.typename === "PlacedItem" || item.typename === "RasterItem") {
    return { source: item, fromResult: false };
  }
  if (item.typename === "GroupItem") {
    var note = String(item.note || "");
    var matched = /^VectorPanel\/1\|source=([^|]+)\|/.exec(note);
    if (matched) {
      return { source: VP_image(documentRef, matched[1]), fromResult: true };
    }
  }
  throw new Error("เลือกภาพ raster หรือกลุ่มผล Vector Panel");
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

function VP_capture(encodedUuid, encodedPath, encodedDocumentIdentity) {
  var temporary = null;
  var sourceDocument = null;
  try {
    var uuid = decodeURIComponent(encodedUuid);
    var outputPath = decodeURIComponent(encodedPath);
    var documentIdentity = decodeURIComponent(encodedDocumentIdentity);
    if (app.documents.length === 0) throw new Error("เอกสาร Illustrator ถูกปิดแล้ว");
    sourceDocument = app.activeDocument;
    if (VP_documentIdentity(sourceDocument) !== documentIdentity) throw new Error("เอกสารปัจจุบันเปลี่ยนไป กรุณากดตรวจภาพอีกครั้ง");
    var resolved = VP_selectionSource(sourceDocument);
    if (resolved.source.uuid !== uuid) throw new Error("ภาพที่เลือกเปลี่ยนไป กรุณากดตรวจภาพอีกครั้ง");
    var source = resolved.source;
    var bounds = source.geometricBounds;
    var width = Number(bounds[2]) - Number(bounds[0]);
    var height = Number(bounds[1]) - Number(bounds[3]);
    if (width <= 0 || height <= 0) throw new Error("ขนาดภาพไม่ถูกต้อง");

    var selectedBeforeCopy = sourceDocument.selection[0];
    selectedBeforeCopy.selected = false;
    source.selected = true;
    app.copy();
    temporary = app.documents.add(sourceDocument.documentColorSpace, Math.max(10, width), Math.max(10, height));
    app.paste();
    var pasted = temporary.selection;
    if (!pasted || pasted.length === 0) throw new Error("คัดลอกภาพไปเอกสารชั่วคราวไม่สำเร็จ");
    var captureBounds = pasted[0].visibleBounds;
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
    var source = VP_image(doc, uuid);
    var bounds = source.geometricBounds;
    if (!VP_boundsMatch(bounds, boundsText)) throw new Error("ภาพต้นฉบับถูกย้ายหรือปรับขนาด กรุณาแปลงใหม่");
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

function VP_nameExists(collection, name) {
  try {
    return !!collection.getByName(name);
  } catch (ignored) {
    return false;
  }
}

function VP_uniqueName(collection, base) {
  var name = base;
  var suffix = 2;
  while (VP_nameExists(collection, name)) {
    name = base + " " + suffix;
    suffix++;
  }
  return name;
}

function VP_documentColor(doc, r, g, b) {
  if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
    var cyan = 1 - r / 255;
    var magenta = 1 - g / 255;
    var yellow = 1 - b / 255;
    var black = Math.min(cyan, Math.min(magenta, yellow));
    var cmyk = new CMYKColor();
    if (black >= 0.999) {
      cmyk.cyan = 0;
      cmyk.magenta = 0;
      cmyk.yellow = 0;
      cmyk.black = 100;
    } else {
      cmyk.cyan = ((cyan - black) / (1 - black)) * 100;
      cmyk.magenta = ((magenta - black) / (1 - black)) * 100;
      cmyk.yellow = ((yellow - black) / (1 - black)) * 100;
      cmyk.black = black * 100;
    }
    return cmyk;
  }
  var rgb = new RGBColor();
  rgb.red = r;
  rgb.green = g;
  rgb.blue = b;
  return rgb;
}

function VP_swatches(encodedName, encodedColors) {
  try {
    if (app.documents.length === 0) throw new Error("เปิดเอกสาร Illustrator ก่อน");
    var doc = app.activeDocument;
    var groupName = VP_uniqueName(doc.swatchGroups, decodeURIComponent(encodedName));
    var payload = decodeURIComponent(encodedColors);
    if (!payload) throw new Error("ไม่มีสีให้ใส่");
    var parts = payload.split(";");
    var group = doc.swatchGroups.add();
    group.name = groupName;
    var added = 0;
    for (var i = 0; i < parts.length; i++) {
      var channels = parts[i].split(",");
      if (channels.length !== 3) throw new Error("รูปแบบสีไม่ถูกต้อง");
      var red = Number(channels[0]);
      var green = Number(channels[1]);
      var blue = Number(channels[2]);
      if (!isFinite(red) || !isFinite(green) || !isFinite(blue)) throw new Error("ค่าสีไม่ถูกต้อง");
      var swatch = doc.swatches.add();
      swatch.color = VP_documentColor(doc, red, green, blue);
      swatch.name = VP_uniqueName(doc.swatches, groupName + " " + (i + 1));
      group.addSwatch(swatch);
      added++;
    }
    return VP_ok([group.name, added]);
  } catch (error) {
    return VP_error(error);
  }
}

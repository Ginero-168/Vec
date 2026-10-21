import {
  ColorDocument,
  TRANSPARENT,
  defaultZapThresholds,
  rgbHex,
  type EditResult,
  type Rgb,
  type Segmentation
} from "./color/model";

export type ColorEditorHooks = {
  onVectorPreview?: () => void;
  onResegment?: () => void;
  onExportSwatches?: (palette: readonly Rgb[]) => void;
  onChange?: (colorCount: number) => void;
};

export type ColorEditor = {
  load(segmentation: Segmentation): void;
  clear(): void;
  hasDocument(): boolean;
  dirty(): boolean;
  colorCount(): number;
  segmentation(): Segmentation;
  confirmDiscard(message: string): Promise<boolean>;
  destroy(): void;
};

type Tool = "zap" | "fill" | "pencil" | "dropper" | "smooth";

const TOOL_HINT: Record<Tool, string> = {
  zap: "Zap · คลิกเศษขอบหรือจุดเล็ก ระบบแยกชิ้นที่ติดกันแล้วรวมเข้าสีข้างเคียง",
  fill: "Fill · คลิกพื้นที่ที่ติดกัน เพื่อเทสีที่เลือกอยู่",
  pencil: "Pencil · ลากเพื่อระบายทีละพิกเซล ด้วยสีที่เลือก",
  dropper: "Color · คลิกบนภาพเพื่อหยิบสีจากส่วนนั้น",
  smooth: "Smooth · คลิกช่วงขอบเพื่อเกลาให้เป็นเส้นหรือส่วนโค้ง ลากเพื่อปัด Shift ค้างแล้วลากเพื่อคลุมกรอบ"
};

const ICONS: Record<string, string> = {
  undo: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.5 3.2 3 6.5l3.5 3.2V7.4c2.7.2 4.4 1.6 5.2 3.6.2-3.4-1.4-6.2-5.2-6.6V3.2z"/></svg>',
  redo: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.5 3.2 13 6.5 9.5 9.7V7.4c-2.7.2-4.4 1.6-5.2 3.6-.2-3.4 1.4-6.2 5.2-6.6V3.2z"/></svg>',
  revert: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M8 3.2v3.2M8 3.2A4.8 4.8 0 1 1 3.4 8"/><path fill="currentColor" d="M8 2.2 5.8 5h4.4L8 2.2z"/></svg>',
  zap: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.2 1 3 9h4.2L6.4 15 13 6.6H8.6L9.2 1z"/></svg>',
  fill: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8.2 1.6 3.4 8.2c-.8 1.1-.2 2.8 1.2 2.8h.2l-.6 2.6h8.2l-.7-2.6h.2c1.4 0 2-.1 1.2-2.8L8.2 1.6z"/></svg>',
  pencil: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.2 1.8 14.2 4.8 5.6 13.4 2 14l.6-3.6 8.6-8.6z"/></svg>',
  dropper: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10.2 1.6c.8.1 1.6.5 2.2 1.1l.9.9c.6.6 1 1.4 1.1 2.2l-2.2.6-4.7 4.7-2.6-2.6 4.7-4.7.6-2.2zM3.2 10.2l2.6 2.6-2.2 1.2-1.6-1.6 1.2-2.2z"/></svg>',
  smooth: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M2 11c2.2-4 3.4-4 5.2-1.2C8.8 12.2 10 12.4 14 5"/></svg>'
};

export function createColorEditor(container: HTMLElement, hooks: ColorEditorHooks = {}): ColorEditor {
  container.replaceChildren();
  container.insertAdjacentHTML("beforeend", editorMarkup(hooks));
  const canvas = required(container, "canvas", HTMLCanvasElement);
  const context = canvasContext(canvas);
  const stage = document.createElement("div");
  stage.className = "seg-stage";
  const smoothMarquee = document.createElement("div");
  smoothMarquee.className = "marquee";
  smoothMarquee.hidden = true;
  canvas.replaceWith(stage);
  stage.append(canvas, smoothMarquee);
  const countNow = required(container, ".count-now", HTMLElement);
  const countNext = required(container, ".count-next", HTMLElement);
  const note = required(container, ".editor-note", HTMLElement);
  const hint = required(container, ".tool-hint", HTMLElement);
  const readout = required(container, ".readout", HTMLElement);
  const hex = required(container, ".active-hex", HTMLElement);
  const swatch = required(container, ".active-swatch", HTMLElement);
  const diagram = required(container, ".diagram", HTMLElement);
  const collapse = required(container, "[data-action='collapse']", HTMLButtonElement);
  const zoom = required(container, ".zoom-range", HTMLInputElement);
  const areaInput = required(container, "[data-threshold='area']", HTMLInputElement);
  const thinInput = required(container, "[data-threshold='thin']", HTMLInputElement);
  const ratioInput = required(container, "[data-threshold='ratio']", HTMLInputElement);
  const dialog = required(container, "dialog", HTMLDialogElement);
  const dialogCopy = required(container, ".confirm-copy", HTMLElement);
  const marquee = document.createElement("div");
  marquee.className = "marquee";
  marquee.hidden = true;
  diagram.append(marquee);

  let doc: ColorDocument | null = null;
  let tool: Tool = "zap";
  let bitmap: ImageData | null = null;
  let positions = new Map<string, { x: number; y: number }>();
  let selected = new Set<string>();
  let representative: string | null = null;
  let stroke: { pushed: boolean } | null = null;
  let targetHex: string | null = null;

  type Drag =
    | { kind: "dot"; pointerId: number; index: number; hex: string; sx: number; sy: number; moved: boolean; group: boolean; origins: Map<string, { x: number; y: number }> }
    | { kind: "marquee"; pointerId: number; x0: number; y0: number; x1: number; y1: number; moved: boolean }
    | { kind: "pencil"; pointerId: number; x: number; y: number }
    | { kind: "smooth"; pointerId: number; x: number; y: number }
    | { kind: "smooth-lasso"; pointerId: number; x0: number; y0: number; x1: number; y1: number; moved: boolean };

  let drag: Drag | null = null;

  function noteText(value: string): void {
    note.textContent = value;
  }

  function showCount(next: number | null): void {
    const current = doc ? doc.colorCount() : 0;
    countNow.textContent = current + " สี";
    if (next === null || next === current) {
      countNext.hidden = true;
      countNext.textContent = "";
    } else {
      countNext.hidden = false;
      countNext.textContent = "→ " + next;
    }
  }

  function armedCollapse(): number | null {
    if (!doc || representative === null) return null;
    const members = selectedIndices();
    if (members.length < 2) return null;
    if (!members.some((index) => rgbHex(doc!.palette[index]!) === representative)) return null;
    return doc.colorCount() - (members.length - 1);
  }

  function selectedIndices(): number[] {
    if (!doc) return [];
    const indices: number[] = [];
    doc.palette.forEach((color, index) => {
      if (selected.has(rgbHex(color))) indices.push(index);
    });
    return indices;
  }

  function syncChrome(): void {
    const tools = container.querySelectorAll<HTMLButtonElement>("[data-tool]");
    tools.forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.tool === tool ? "true" : "false");
    });
    hint.textContent = TOOL_HINT[tool];
    const undo = container.querySelector<HTMLButtonElement>("[data-history='undo']");
    const redo = container.querySelector<HTMLButtonElement>("[data-history='redo']");
    const revert = container.querySelector<HTMLButtonElement>("[data-history='revert']");
    if (undo) undo.disabled = !doc || !doc.canUndo();
    if (redo) redo.disabled = !doc || !doc.canRedo();
    if (revert) revert.disabled = !doc || !doc.dirty();
    collapse.disabled = !doc || selectedIndices().length < 2;
    const color = doc && doc.active >= 0 ? doc.palette[doc.active] : null;
    if (color) {
      swatch.style.background = rgbHex(color);
      hex.textContent = rgbHex(color);
    } else {
      swatch.style.background = "transparent";
      hex.textContent = "ไม่มีสี";
    }
    if (!drag || drag.kind !== "dot" || drag.group) showCount(armedCollapse());
    canvas.style.cursor = tool === "dropper" ? "copy" : "crosshair";
  }

  function paintBitmap(): void {
    if (!doc) return;
    bitmap = context.createImageData(doc.width, doc.height);
    const data = bitmap.data;
    for (let i = 0; i < doc.labels.length; i++) {
      const label = doc.labels[i] ?? TRANSPARENT;
      const offset = i * 4;
      const color = label === TRANSPARENT ? null : doc.palette[label];
      if (!color) {
        data[offset + 3] = 0;
        continue;
      }
      const marked = (doc.smoothMask[i] ?? 0) > 0;
      data[offset] = marked ? Math.round(color.r * 0.42 + 207 * 0.58) : color.r;
      data[offset + 1] = marked ? Math.round(color.g * 0.42 + 182 * 0.58) : color.g;
      data[offset + 2] = marked ? Math.round(color.b * 0.42 + 255 * 0.58) : color.b;
      data[offset + 3] = 255;
    }
    canvas.width = doc.width;
    canvas.height = doc.height;
    context.putImageData(bitmap, 0, 0);
    applyZoom();
  }

  function applyZoom(): void {
    const scale = Number(zoom.value) || 1;
    canvas.style.width = canvas.width * scale + "px";
    canvas.style.height = canvas.height * scale + "px";
  }

  function placeMissing(): void {
    if (!doc) return;
    const box = diagram.clientWidth || container.clientWidth || 320;
    const gap = 68;
    const cols = Math.max(1, Math.floor((box - 8) / gap));
    let slot = 0;
    for (const color of doc.palette) {
      const key = rgbHex(color);
      if (positions.has(key)) continue;
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      slot++;
      positions.set(key, { x: 36 + col * gap, y: 40 + row * gap });
    }
  }

  function radiusFor(count: number, max: number): number {
    const ratio = max > 0 ? Math.sqrt(count / max) : 0;
    return 13 + ratio * 17;
  }

  function renderDiagram(): void {
    if (!doc) {
      diagram.style.height = "120px";
      return;
    }
    placeMissing();
    const counts = doc.counts();
    const max = counts.reduce((best, value) => Math.max(best, value), 0);
    diagram.querySelectorAll(".swatch-dot").forEach((node) => node.remove());
    let lowest = 120;
    doc.palette.forEach((color, index) => {
      const key = rgbHex(color);
      const pos = positions.get(key) ?? { x: 40, y: 40 };
      const radius = radiusFor(counts[index] ?? 0, max);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch-dot";
      button.dataset.index = String(index);
      button.dataset.hex = key;
      button.style.left = pos.x + "px";
      button.style.top = pos.y + "px";
      button.style.width = radius * 2 + "px";
      button.style.height = radius * 2 + "px";
      button.style.background = key;
      button.title = key + " · " + (counts[index] ?? 0) + " พิกเซล";
      button.setAttribute("aria-label", "สี " + key + " " + (counts[index] ?? 0) + " พิกเซล");
      if (selected.has(key)) button.classList.add("is-selected");
      if (representative === key) button.classList.add("is-representative");
      if (targetHex === key) button.classList.add("is-target");
      button.addEventListener("pointerdown", onDotPointerDown);
      diagram.append(button);
      lowest = Math.max(lowest, pos.y + radius + 28);
    });
    diagram.style.height = lowest + "px";
  }

  function renderAll(): void {
    paintBitmap();
    renderDiagram();
    syncChrome();
    if (doc) hooks.onChange?.(doc.colorCount());
  }

  function finish(result: EditResult): void {
    if (!result.ok) {
      noteText(result.reason);
      syncChrome();
      return;
    }
    if (result.detail) noteText(result.detail);
    if (result.changed) renderAll();
    else syncChrome();
  }

  function eventPixel(event: PointerEvent): { x: number; y: number } | null {
    if (!doc) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * doc.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * doc.height);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
    return { x, y };
  }

  function paintPixel(x: number, y: number): void {
    if (!doc || !stroke) return;
    doc.pencil(x, y, stroke);
    if (!bitmap) return;
    const color = doc.palette[doc.active];
    if (!color) return;
    const offset = (y * doc.width + x) * 4;
    bitmap.data[offset] = color.r;
    bitmap.data[offset + 1] = color.g;
    bitmap.data[offset + 2] = color.b;
    bitmap.data[offset + 3] = 255;
  }

  function paintLine(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (true) {
      paintPixel(x, y);
      if (x === x1 && y === y1) break;
      const doubled = 2 * err;
      if (doubled > -dy) {
        err -= dy;
        x += sx;
      }
      if (doubled < dx) {
        err += dx;
        y += sy;
      }
    }
    if (bitmap) context.putImageData(bitmap, 0, 0);
  }

  function paintSmooth(x0: number, y0: number, x1: number, y1: number): void {
    if (!doc || !stroke) return;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    let changed = false;
    while (true) {
      const result = doc.smoothAt(x, y, stroke);
      if (result.ok && result.changed) changed = true;
      if (x === x1 && y === y1) break;
      const doubled = 2 * err;
      if (doubled > -dy) {
        err -= dy;
        x += sx;
      }
      if (doubled < dx) {
        err += dx;
        y += sy;
      }
    }
    if (changed) paintBitmap();
  }

  function placeSmoothMarquee(x0: number, y0: number, x1: number, y1: number): void {
    const scale = Number(zoom.value) || 1;
    const left = Math.min(x0, x1) * scale;
    const top = Math.min(y0, y1) * scale;
    smoothMarquee.hidden = false;
    smoothMarquee.style.left = left + "px";
    smoothMarquee.style.top = top + "px";
    smoothMarquee.style.width = Math.abs(x1 - x0) * scale + "px";
    smoothMarquee.style.height = Math.abs(y1 - y0) * scale + "px";
  }

  function localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = diagram.getBoundingClientRect();
    return { x: event.clientX - rect.left + diagram.scrollLeft, y: event.clientY - rect.top + diagram.scrollTop };
  }

  function hitDot(x: number, y: number, ignore: number): number | null {
    if (!doc) return null;
    const counts = doc.counts();
    const max = counts.reduce((best, value) => Math.max(best, value), 0);
    let found: number | null = null;
    doc.palette.forEach((color, index) => {
      if (index === ignore) return;
      const pos = positions.get(rgbHex(color));
      if (!pos) return;
      const radius = radiusFor(counts[index] ?? 0, max) + 6;
      const dx = x - pos.x;
      const dy = y - pos.y;
      if (dx * dx + dy * dy <= radius * radius) found = index;
    });
    return found;
  }

  function onDotPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !doc) return;
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(button.dataset.index);
    const colorHex = button.dataset.hex ?? "";
    try { button.setPointerCapture(event.pointerId); } catch { /* Pointer capture is unavailable for a synthetic event. */ }
    const group = selected.size > 1 && selected.has(colorHex);
    const origins = new Map<string, { x: number; y: number }>();
    if (group) {
      for (const key of selected) {
        const pos = positions.get(key);
        if (pos) origins.set(key, { ...pos });
      }
    } else {
      const pos = positions.get(colorHex);
      if (pos) origins.set(colorHex, { ...pos });
    }
    drag = { kind: "dot", pointerId: event.pointerId, index, hex: colorHex, sx: event.clientX, sy: event.clientY, moved: false, group, origins };
    targetHex = null;
  }

  function moveDots(event: PointerEvent, current: Extract<Drag, { kind: "dot" }>): void {
    const dx = event.clientX - current.sx;
    const dy = event.clientY - current.sy;
    if (!current.moved && Math.hypot(dx, dy) < 4) return;
    current.moved = true;
    for (const [key, origin] of current.origins) {
      positions.set(key, { x: origin.x + dx, y: origin.y + dy });
    }
    if (!current.group && doc) {
      const point = localPoint(event);
      const hit = hitDot(point.x, point.y, current.index);
      const hitColor = hit === null ? undefined : doc.palette[hit];
      targetHex = hitColor ? rgbHex(hitColor) : null;
      showCount(hit === null ? null : doc.colorCount() - 1);
    }
    moveDotElements();
    syncChrome();
  }

  function moveDotElements(): void {
    let lowest = 120;
    diagram.querySelectorAll<HTMLButtonElement>(".swatch-dot").forEach((button) => {
      const key = button.dataset.hex;
      if (!key) return;
      const pos = positions.get(key);
      if (!pos) return;
      button.style.left = pos.x + "px";
      button.style.top = pos.y + "px";
      button.classList.toggle("is-target", targetHex === key);
      lowest = Math.max(lowest, pos.y + button.offsetHeight / 2 + 28);
    });
    diagram.style.height = lowest + "px";
  }

  function releaseDot(current: Extract<Drag, { kind: "dot" }>): void {
    if (!doc) return;
    if (!current.moved) {
      doc.setActive(current.index);
      if (selected.size > 1 && selected.has(current.hex)) representative = current.hex;
      else {
        selected = new Set([current.hex]);
        representative = null;
      }
      noteText("");
    } else if (!current.group && targetHex) {
      const target = doc.palette.findIndex((color) => rgbHex(color) === targetHex);
      if (target >= 0) {
        const before = doc.colorCount();
        const result = doc.merge(current.index, target);
        targetHex = null;
        if (result.ok && result.changed) {
          selected.delete(current.hex);
          if (representative === current.hex) representative = null;
          noteText(before + " → " + doc.colorCount() + " สี · " + result.detail);
        } else if (!result.ok) noteText(result.reason);
      }
    }
    targetHex = null;
    renderAll();
  }

  function onPointerMove(event: PointerEvent): void {
    if (drag && event.pointerId === drag.pointerId && drag.kind === "dot") {
      moveDots(event, drag);
      return;
    }
    if (drag && event.pointerId === drag.pointerId && drag.kind === "pencil") {
      const pixel = eventPixel(event);
      if (!pixel) return;
      paintLine(drag.x, drag.y, pixel.x, pixel.y);
      drag.x = pixel.x;
      drag.y = pixel.y;
      return;
    }
    if (drag && event.pointerId === drag.pointerId && drag.kind === "smooth") {
      const pixel = eventPixel(event);
      if (!pixel) return;
      paintSmooth(drag.x, drag.y, pixel.x, pixel.y);
      drag.x = pixel.x;
      drag.y = pixel.y;
      return;
    }
    if (drag && event.pointerId === drag.pointerId && drag.kind === "smooth-lasso") {
      const pixel = eventPixel(event);
      if (!pixel) return;
      drag.x1 = pixel.x;
      drag.y1 = pixel.y;
      if (Math.abs(pixel.x - drag.x0) + Math.abs(pixel.y - drag.y0) > 2) drag.moved = true;
      placeSmoothMarquee(drag.x0, drag.y0, pixel.x, pixel.y);
      return;
    }
    if (drag && event.pointerId === drag.pointerId && drag.kind === "marquee") {
      const point = localPoint(event);
      drag.x1 = point.x;
      drag.y1 = point.y;
      if (Math.hypot(point.x - drag.x0, point.y - drag.y0) > 4) drag.moved = true;
      const left = Math.min(drag.x0, point.x);
      const top = Math.min(drag.y0, point.y);
      marquee.hidden = false;
      marquee.style.left = left + "px";
      marquee.style.top = top + "px";
      marquee.style.width = Math.abs(point.x - drag.x0) + "px";
      marquee.style.height = Math.abs(point.y - drag.y0) + "px";
      return;
    }
    if (event.currentTarget === canvas || canvas.contains(event.target as Node)) {
      const pixel = eventPixel(event);
      if (!pixel || !doc) {
        readout.textContent = "";
        return;
      }
      const label = doc.labels[pixel.y * doc.width + pixel.x] ?? TRANSPARENT;
      const color = label === TRANSPARENT ? null : doc.palette[label];
      readout.textContent = pixel.x + ", " + pixel.y + (color ? " · " + rgbHex(color) : " · โปร่งใส");
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    marquee.hidden = true;
    if (current.kind === "dot") releaseDot(current);
    else if (current.kind === "pencil") {
      if (doc && stroke) finish(doc.endPencil(stroke));
      stroke = null;
    } else if (current.kind === "smooth") {
      stroke = null;
      syncChrome();
    } else if (current.kind === "smooth-lasso") {
      smoothMarquee.hidden = true;
      if (doc && current.moved) finish(doc.smoothLasso(current.x0, current.y0, current.x1, current.y1));
      else if (doc) finish(doc.smoothAt(current.x0, current.y0, null));
    } else if (current.kind === "marquee") {
      if (!current.moved || !doc) {
        selected = new Set();
        representative = null;
      } else {
        const left = Math.min(current.x0, current.x1);
        const right = Math.max(current.x0, current.x1);
        const top = Math.min(current.y0, current.y1);
        const bottom = Math.max(current.y0, current.y1);
        const next = new Set<string>();
        for (const color of doc.palette) {
          const key = rgbHex(color);
          const pos = positions.get(key);
          if (!pos) continue;
          if (pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom) next.add(key);
        }
        selected = next;
        representative = null;
        if (next.size >= 2) noteText("คลิกสีในกลุ่มที่ต้องการเก็บ แล้วกดยุบกลุ่ม");
      }
      renderDiagram();
      syncChrome();
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !doc) return;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Pointer capture is unavailable for a synthetic event. */ }
    const pixel = eventPixel(event);
    if (!pixel) return;
    if (tool === "pencil") {
      stroke = { pushed: false };
      drag = { kind: "pencil", pointerId: event.pointerId, x: pixel.x, y: pixel.y };
      paintLine(pixel.x, pixel.y, pixel.x, pixel.y);
      return;
    }
    if (tool === "smooth") {
      stroke = { pushed: false };
      if (event.shiftKey) {
        drag = { kind: "smooth-lasso", pointerId: event.pointerId, x0: pixel.x, y0: pixel.y, x1: pixel.x, y1: pixel.y, moved: false };
        placeSmoothMarquee(pixel.x, pixel.y, pixel.x, pixel.y);
      } else {
        drag = { kind: "smooth", pointerId: event.pointerId, x: pixel.x, y: pixel.y };
        finish(doc.smoothAt(pixel.x, pixel.y, stroke));
      }
      return;
    }
    if (tool === "zap") finish(doc.zap(pixel.x, pixel.y));
    else if (tool === "fill") finish(doc.fill(pixel.x, pixel.y));
    else {
      const label = doc.labels[pixel.y * doc.width + pixel.x] ?? TRANSPARENT;
      if (label === TRANSPARENT) noteText("จุดนี้โปร่งใส");
      else {
        doc.setActive(label);
        noteText("เลือก " + rgbHex(doc.palette[label]!));
        syncChrome();
      }
    }
  });
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  diagram.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".swatch-dot")) return;
    try { diagram.setPointerCapture(event.pointerId); } catch { /* Pointer capture is unavailable for a synthetic event. */ }
    const point = localPoint(event);
    drag = { kind: "marquee", pointerId: event.pointerId, x0: point.x, y0: point.y, x1: point.x, y1: point.y, moved: false };
  });
  diagram.addEventListener("pointermove", onPointerMove);
  diagram.addEventListener("pointerup", onPointerUp);
  diagram.addEventListener("pointercancel", onPointerUp);

  container.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.tool;
      if (next === "zap" || next === "fill" || next === "pencil" || next === "dropper" || next === "smooth") {
        tool = next;
        noteText("");
        syncChrome();
      }
    });
  });
  container.querySelector("[data-history='undo']")?.addEventListener("click", () => {
    if (!doc || !doc.undo()) return;
    noteText("ย้อนแล้ว · " + doc.colorCount() + " สี");
    renderAll();
  });
  container.querySelector("[data-history='redo']")?.addEventListener("click", () => {
    if (!doc || !doc.redo()) return;
    noteText("ทำซ้ำแล้ว · " + doc.colorCount() + " สี");
    renderAll();
  });
  container.querySelector("[data-history='revert']")?.addEventListener("click", () => {
    if (!doc || !doc.revert()) return;
    selected = new Set();
    representative = null;
    noteText("คืนค่าตอนแยกสีครั้งแรก · " + doc.colorCount() + " สี");
    renderAll();
  });
  collapse.addEventListener("click", () => {
    if (!doc) return;
    const members = selectedIndices();
    if (members.length < 2) return;
    const representativeIndex = doc.palette.findIndex((color) => rgbHex(color) === representative);
    if (representativeIndex < 0) {
      noteText("คลิกสีในกลุ่มที่ต้องการเก็บไว้ แล้วกดยุบกลุ่มอีกครั้ง");
      return;
    }
    const before = doc.colorCount();
    const result = doc.collapse(members, representativeIndex);
    if (!result.ok) {
      noteText(result.reason);
      return;
    }
    selected = new Set(representative ? [representative] : []);
    noteText(before + " → " + doc.colorCount() + " สี · " + result.detail);
    renderAll();
  });
  zoom.addEventListener("input", applyZoom);
  const pushThresholds = () => {
    if (!doc) return;
    doc.setThresholds({
      maxSpeckleArea: clampNumber(areaInput.value, 1, 5000, defaultZapThresholds.maxSpeckleArea),
      maxThinWidth: clampNumber(thinInput.value, 1, 8, defaultZapThresholds.maxThinWidth),
      minBoundaryRatio: clampNumber(ratioInput.value, 0.2, 4, defaultZapThresholds.minBoundaryRatio)
    });
  };
  areaInput.addEventListener("input", pushThresholds);
  thinInput.addEventListener("input", pushThresholds);
  ratioInput.addEventListener("input", pushThresholds);
  container.querySelector("[data-action='vector']")?.addEventListener("click", () => hooks.onVectorPreview?.());
  container.querySelector("[data-action='resegment']")?.addEventListener("click", () => hooks.onResegment?.());
  container.querySelector("[data-action='swatches']")?.addEventListener("click", () => {
    if (doc) hooks.onExportSwatches?.(doc.palette);
  });

  function onKey(event: KeyboardEvent): void {
    if (!doc || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (key === "z") doc.undo();
    else if (key === "y") doc.redo();
    else if (key === "t") {
      if (doc.revert()) {
        selected = new Set();
        representative = null;
      }
    } else if (key === "d") tool = "zap";
    else if (key === "f") tool = "fill";
    else if (key === "x") tool = "pencil";
    else if (key === "c") tool = "dropper";
    else return;
    event.preventDefault();
    renderAll();
  }
  window.addEventListener("keydown", onKey);

  function load(segmentation: Segmentation): void {
    doc = ColorDocument.fromSegmentation(segmentation, {
      ...defaultZapThresholds,
      maxSpeckleArea: clampNumber(areaInput.value, 1, 5000, defaultZapThresholds.maxSpeckleArea),
      maxThinWidth: clampNumber(thinInput.value, 1, 8, defaultZapThresholds.maxThinWidth),
      minBoundaryRatio: clampNumber(ratioInput.value, 0.2, 4, defaultZapThresholds.minBoundaryRatio)
    });
    positions = new Map();
    selected = new Set();
    representative = null;
    targetHex = null;
    noteText("แยกได้ " + doc.colorCount() + " สี แก้บนภาพนี้ก่อนทำเส้น");
    renderAll();
  }

  return {
    load,
    clear() {
      doc = null;
      bitmap = null;
      positions = new Map();
      selected = new Set();
      representative = null;
      context.clearRect(0, 0, canvas.width, canvas.height);
      diagram.querySelectorAll(".swatch-dot").forEach((node) => node.remove());
      showCount(null);
      syncChrome();
    },
    hasDocument: () => doc !== null,
    dirty: () => doc?.dirty() ?? false,
    colorCount: () => doc?.colorCount() ?? 0,
    segmentation() {
      if (!doc) throw new Error("ยังไม่มีแผนที่สี");
      return doc.segmentation();
    },
    confirmDiscard(message: string) {
      if (!doc || !doc.dirty()) return Promise.resolve(true);
      dialogCopy.textContent = message;
      if (typeof dialog.showModal !== "function") return Promise.resolve(window.confirm(message));
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      });
    },
    destroy() {
      window.removeEventListener("keydown", onKey);
      container.replaceChildren();
    }
  };
}

function editorMarkup(hooks: ColorEditorHooks): string {
  const vector = hooks.onVectorPreview ? '<button type="button" class="primary" data-action="vector">ดูเส้น</button>' : "";
  const resegment = hooks.onResegment ? '<button type="button" class="secondary" data-action="resegment">แปลงใหม่</button>' : "";
  const swatches = hooks.onExportSwatches ? '<button type="button" class="secondary" data-action="swatches">ใส่ Swatches</button>' : "";
  return `
    <section class="editor" aria-labelledby="editor-title">
      <div class="section-heading">
        <h2 id="editor-title">แก้สี</h2>
        <p class="count-pill" aria-live="polite"><span class="count-now">0 สี</span><span class="count-next" hidden></span></p>
      </div>
      <p class="editor-lead">แก้บนแผนที่สีเดียวกันนี้ก่อนทำเส้นให้เรียบ ตัวเลขคือจำนวนสีที่ใช้จริง</p>
      <div class="seg-frame"><canvas aria-label="แผนที่สีที่แก้ได้"></canvas></div>
      <div class="editor-meta">
        <span class="active-swatch" aria-hidden="true"></span>
        <span class="active-hex">ไม่มีสี</span>
        <span class="readout"></span>
        <label class="zoom-label" for="zoom-range">ขยาย <input class="zoom-range" id="zoom-range" name="zoom" type="range" min="1" max="8" value="2" /></label>
      </div>
      <div class="toolstrip" role="toolbar" aria-label="เครื่องมือแก้สี">
        ${toolButton("undo", "data-history", "Undo", "Undo (Z)")}
        ${toolButton("redo", "data-history", "Redo", "Redo (Y)")}
        ${toolButton("revert", "data-history", "Revert", "Revert (T)")}
        ${toolButton("zap", "data-tool", "Zap", "Zap (D)")}
        ${toolButton("fill", "data-tool", "Fill", "Fill (F)")}
        ${toolButton("pencil", "data-tool", "Pencil", "Pencil (X)")}
        ${toolButton("dropper", "data-tool", "Color", "Color (C)")}
        ${toolButton("smooth", "data-tool", "Smooth", "Smooth")}
      </div>
      <p class="tool-hint"></p>
      <p class="editor-note" role="status"></p>
      <details class="zap-tune">
        <summary>เกณฑ์ Zap</summary>
        <label for="zap-area">จุดเล็กไม่เกิน <input id="zap-area" name="zap-area" data-threshold="area" type="number" min="1" max="5000" value="${defaultZapThresholds.maxSpeckleArea}" /> px</label>
        <label for="zap-thin">เส้นบางไม่เกิน <input id="zap-thin" name="zap-thin" data-threshold="thin" type="number" min="1" max="8" value="${defaultZapThresholds.maxThinWidth}" /> px</label>
        <label for="zap-ratio">อัตราส่วนขอบ <input id="zap-ratio" name="zap-ratio" data-threshold="ratio" type="number" min="0.2" max="4" step="0.1" value="${defaultZapThresholds.minBoundaryRatio}" /></label>
      </details>
      <div class="section-heading">
        <h3>แผนภาพสี</h3>
        <button type="button" class="text-button" data-action="collapse" disabled>ยุบกลุ่ม</button>
      </div>
      <p class="diagram-lead">ลากวงกลมไปวางบนอีกสีเพื่อรวม สีปลายทางคือสีที่เก็บ ลากบนพื้นที่ว่างเพื่อคลุมกลุ่ม แล้วคลิกสีที่จะเก็บก่อนกดยุบกลุ่ม กลุ่มที่เลือกแล้วย้ายได้ทั้งก้อน</p>
      <div class="diagram" aria-label="แผนภาพสี ลากเพื่อรวมหรือจัดกลุ่ม"></div>
      <div class="editor-actions">${vector}${resegment}${swatches}</div>
      <dialog class="confirm">
        <form method="dialog">
          <h3>การทำซ้ำจะล้างการแก้สี</h3>
          <p class="confirm-copy"></p>
          <div class="confirm-actions">
            <button type="submit" class="secondary" value="cancel">ยกเลิก</button>
            <button type="submit" class="primary" value="ok">ล้างแล้วทำต่อ</button>
          </div>
        </form>
      </dialog>
    </section>`;
}

function toolButton(name: string, attribute: "data-tool" | "data-history", label: string, title: string): string {
  const pressed = attribute === "data-tool" && name === "zap" ? ' aria-pressed="true"' : attribute === "data-tool" ? ' aria-pressed="false"' : "";
  return `<button type="button" class="tool" ${attribute}="${name}" title="${title}"${pressed}>${ICONS[name] ?? ""}<span>${label}</span></button>`;
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("ใช้ canvas 2d ไม่ได้");
  return context;
}

function required<T extends Element>(container: ParentNode, selector: string, kind: { new (): T }): T {
  const value = container.querySelector(selector);
  if (!value || !(value instanceof kind)) throw new Error("Missing editor element: " + selector);
  return value;
}

function clampNumber(raw: string, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

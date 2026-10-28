/**
 * Interactive color-cluster diagram for the Colors step.
 * Pure DOM + SVG, zero dependencies. Runs in CEP Chromium with limited Node.
 */

import type { SegmentColorStage } from "./segment.ts";
import {
  applyEdits,
  applyHide,
  applyMerge,
  applyRecolor,
  applySplit,
  applySplitShade,
  createDimmedPreview,
  extractClusters,
  hexToRgb,
  isNetZeroEdits,
  PaletteEditHistory,
  remapEditsAcrossMaxColors,
  rgbToHex,
  type PaletteCluster,
  type PaletteEdit
} from "./palette-edit.ts";
import { rgbToOklab } from "./color.ts";

export type ColorDiagramApi = {
  readonly onMerge?: (from: number, to: number) => void;
  readonly onSplit?: (cluster: number, k?: number) => void;
  readonly onSplitShade?: (cluster: number, shadeIndex: number) => void;
  readonly onRecolor?: (cluster: number, hex: string, alpha?: number) => void;
  readonly onHide?: (cluster: number, hidden: boolean) => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onToggleView?: (view: "original" | "output") => void;
  readonly onSetMaxColors?: (count: number) => void;
  readonly getMaxColors?: () => number;
  readonly onEditsChanged?: (edits: readonly PaletteEdit[], currentStage: SegmentColorStage) => void;
  readonly onApply?: (editedStage: SegmentColorStage) => void;
  readonly onDiscard?: () => void;
  readonly onSelectCluster?: (clusterIndex: number | null, dimmedRaster: Uint8Array | null) => void;
  readonly onPreviewUpdate?: (raster: Uint8Array) => void;
};

export type ColorDiagramHandle = {
  readonly update: (colorsOutput: SegmentColorStage | null, options?: { readonly maxColors?: number }) => void;
  readonly selectCluster: (clusterIndex: number | null) => void;
  readonly showApplyBar: (show: boolean) => void;
  readonly destroy: () => void;
};

export type PositionedBubble = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function packCirclesDeterministic(items: readonly { id: number; r: number }[]): { id: number; r: number; x: number; y: number }[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.r - a.r);
  if (sorted.length === 1) {
    return [{ id: sorted[0]!.id, r: sorted[0]!.r, x: 0, y: 0 }];
  }

  const placed: { id: number; r: number; x: number; y: number }[] = [];
  placed.push({ id: sorted[0]!.id, r: sorted[0]!.r, x: 0, y: 0 });
  placed.push({ id: sorted[1]!.id, r: sorted[1]!.r, x: sorted[0]!.r + sorted[1]!.r, y: 0 });

  for (let i = 2; i < sorted.length; i++) {
    const r_i = sorted[i]!.r;
    let bestScore = Infinity;
    let bestX = 0;
    let bestY = 0;
    let found = false;

    for (let j = 0; j < placed.length; j++) {
      for (let k = j + 1; k < placed.length; k++) {
        const cj = placed[j]!;
        const ck = placed[k]!;
        const dx = ck.x - cj.x;
        const dy = ck.y - cj.y;
        const d = Math.hypot(dx, dy);
        const dj = cj.r + r_i;
        const dk = ck.r + r_i;

        if (d > dj + dk || d < Math.abs(dj - dk) || d < 1e-4) continue;

        const a = (dj * dj - dk * dk + d * d) / (2 * d);
        const hSq = dj * dj - a * a;
        if (hSq < 0) continue;
        const h = Math.sqrt(hSq);

        const mx = cj.x + (a * dx) / d;
        const my = cj.y + (a * dy) / d;
        const rx = (-dy / d) * h;
        const ry = (dx / d) * h;

        const candidates = [
          { x: mx + rx, y: my + ry },
          { x: mx - rx, y: my - ry }
        ];

        for (const cand of candidates) {
          let collides = false;
          for (let m = 0; m < placed.length; m++) {
            if (m === j || m === k) continue;
            const dist = Math.hypot(cand.x - placed[m]!.x, cand.y - placed[m]!.y);
            if (dist < r_i + placed[m]!.r - 0.5) {
              collides = true;
              break;
            }
          }
          if (!collides) {
            const score = cand.x * cand.x + cand.y * cand.y;
            if (score < bestScore) {
              bestScore = score;
              bestX = cand.x;
              bestY = cand.y;
              found = true;
            }
          }
        }
      }
    }

    if (!found) {
      let minOriginDist = Infinity;
      let refCircle = placed[0]!;
      for (const p of placed) {
        const dist = Math.hypot(p.x, p.y);
        if (dist < minOriginDist) {
          minOriginDist = dist;
          refCircle = p;
        }
      }
      const angle = i * 2.399963229728653;
      bestX = refCircle.x + Math.cos(angle) * (refCircle.r + r_i + 2);
      bestY = refCircle.y + Math.sin(angle) * (refCircle.r + r_i + 2);
    }

    placed.push({ id: sorted[i]!.id, r: r_i, x: bestX, y: bestY });
  }

  return placed;
}

export function mountColorDiagram(
  container: HTMLElement | null,
  api: ColorDiagramApi = {}
): ColorDiagramHandle {
  if (container === null) {
    return {
      update: () => undefined,
      selectCluster: () => undefined,
      showApplyBar: () => undefined,
      destroy: () => undefined
    };
  }

  const root = document.createElement("div");
  root.className = "color-diagram-root";
  container.replaceChildren(root);

  let rawColorsOutput: SegmentColorStage | null = null;
  let activeColorsOutput: SegmentColorStage | null = null;
  const history = new PaletteEditHistory();

  let activeTool: "none" | "merge" | "split" | "edit" = "none";
  let viewMode: "original" | "output" = "output";
  let currentMaxColors = api.getMaxColors ? api.getMaxColors() : 35;
  if (!currentMaxColors || currentMaxColors <= 0) currentMaxColors = 35;

  let selectedClusterIndex: number | null = null;
  let forceShowApplyBar = false;

  // Layout cache: guarantees position stability across edits
  const bubblePositionCache = new Map<string, { x: number; y: number }>();

  // 1. Header Bar
  const header = document.createElement("div");
  header.className = "cd-header";

  const applyBar = document.createElement("div");
  applyBar.className = "cd-apply-bar";
  applyBar.style.display = "none";

  const btnDiscard = document.createElement("button");
  btnDiscard.type = "button";
  btnDiscard.className = "cd-btn-discard";
  btnDiscard.innerHTML = "<span>&larr;</span><span>Discard</span>";

  const btnApply = document.createElement("button");
  btnApply.type = "button";
  btnApply.className = "cd-btn-apply";
  btnApply.innerHTML = "<span>Apply</span><span>&rarr;</span>";

  applyBar.append(btnDiscard, btnApply);

  const btnAllTools = document.createElement("button");
  btnAllTools.type = "button";
  btnAllTools.className = "cd-btn-all-tools";
  btnAllTools.innerHTML = "<span>&larr;</span><span>All tools</span>";

  const headerActions = document.createElement("div");
  headerActions.className = "cd-header-actions";

  const btnUndo = document.createElement("button");
  btnUndo.type = "button";
  btnUndo.className = "cd-icon-btn";
  btnUndo.title = "Undo";
  btnUndo.disabled = true;
  btnUndo.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`;

  const btnRedo = document.createElement("button");
  btnRedo.type = "button";
  btnRedo.className = "cd-icon-btn";
  btnRedo.title = "Redo";
  btnRedo.disabled = true;
  btnRedo.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"></path></svg>`;

  const badgeCount = document.createElement("div");
  badgeCount.className = "cd-badge-count";
  badgeCount.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4" fill="currentColor"></circle></svg><span id="cd-count-text">${currentMaxColors}</span>`;

  headerActions.append(btnUndo, btnRedo, badgeCount);
  header.append(applyBar, btnAllTools, headerActions);

  // 2. Canvas Container
  const canvasContainer = document.createElement("div");
  canvasContainer.className = "cd-canvas-container";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "cd-svg-stage");
  svg.setAttribute("viewBox", "0 0 440 360");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  canvasContainer.append(svg);

  // 3. Cluster Editor Panel
  const editorPanel = document.createElement("div");
  editorPanel.className = "cd-editor-panel";
  editorPanel.style.display = "none";

  editorPanel.innerHTML = `
    <div class="cd-editor-row">
      <div class="cd-editor-field">
        <label>RGB</label>
        <div class="cd-colorwell-wrap">
          <input type="color" id="cd-edit-colorwell" class="cd-colorwell" />
          <input type="text" id="cd-edit-hex" class="cd-hex-input" maxlength="7" spellcheck="false" />
        </div>
      </div>
      <div class="cd-editor-field">
        <label>A</label>
        <input type="number" id="cd-edit-alpha" class="cd-alpha-input" min="0" max="255" value="255" />
      </div>
      <div class="cd-editor-field cd-eye-field">
        <label class="cd-eye-toggle" title="Toggle visibility">
          <input type="checkbox" id="cd-edit-eye" checked />
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </label>
      </div>
      <div class="cd-editor-actions">
        <button type="button" id="cd-edit-revert" class="cd-btn-circle" title="Revert"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg></button>
        <button type="button" id="cd-edit-cancel" class="cd-btn-circle cd-btn-cancel" title="Cancel"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>
        <button type="button" id="cd-edit-accept" class="cd-btn-circle cd-btn-accept" title="Accept"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg></button>
      </div>
    </div>
  `;
  canvasContainer.append(editorPanel);

  const editColorwell = editorPanel.querySelector("#cd-edit-colorwell") as HTMLInputElement;
  const editHex = editorPanel.querySelector("#cd-edit-hex") as HTMLInputElement;
  const editAlpha = editorPanel.querySelector("#cd-edit-alpha") as HTMLInputElement;
  const editEye = editorPanel.querySelector("#cd-edit-eye") as HTMLInputElement;
  const editRevert = editorPanel.querySelector("#cd-edit-revert") as HTMLButtonElement;
  const editCancel = editorPanel.querySelector("#cd-edit-cancel") as HTMLButtonElement;
  const editAccept = editorPanel.querySelector("#cd-edit-accept") as HTMLButtonElement;

  editColorwell.addEventListener("input", () => {
    editHex.value = editColorwell.value;
    previewCurrentEditorTweak();
  });

  editHex.addEventListener("change", () => {
    let val = editHex.value.trim();
    if (!val.startsWith("#")) val = "#" + val;
    if (/^#[0-9a-f]{6}$/i.test(val)) {
      editColorwell.value = val;
      previewCurrentEditorTweak();
    }
  });

  editAlpha.addEventListener("input", () => {
    previewCurrentEditorTweak();
  });

  editEye.addEventListener("change", () => {
    previewCurrentEditorTweak();
  });

  editRevert.addEventListener("click", () => {
    if (selectedClusterIndex !== null && rawColorsOutput) {
      const orig = rawColorsOutput.palette[selectedClusterIndex];
      if (orig) {
        const hex = rgbToHex(orig);
        editColorwell.value = hex;
        editHex.value = hex;
        editAlpha.value = "255";
        editEye.checked = true;
        previewCurrentEditorTweak();
      }
    }
  });

  editCancel.addEventListener("click", () => {
    closeEditor();
  });

  editAccept.addEventListener("click", () => {
    if (selectedClusterIndex !== null) {
      const hex = editHex.value;
      const alpha = Number(editAlpha.value);
      const isVisible = editEye.checked;

      if (!isVisible) {
        applyEditAction({ kind: "hide", cluster: selectedClusterIndex, hidden: true });
      } else {
        applyEditAction({ kind: "recolor", cluster: selectedClusterIndex, hex, alpha });
      }
    }
    closeEditor();
  });

  function previewCurrentEditorTweak(): void {
    if (selectedClusterIndex === null || !activeColorsOutput) return;
    const hex = editHex.value;
    const alpha = Number(editAlpha.value);
    const isVisible = editEye.checked;

    let tweaked: SegmentColorStage;
    if (!isVisible) {
      tweaked = applyHide(activeColorsOutput, selectedClusterIndex, true);
    } else {
      tweaked = applyRecolor(activeColorsOutput, selectedClusterIndex, hex, alpha);
    }
    api.onPreviewUpdate?.(tweaked.colors);
  }

  function openEditor(clusterIndex: number): void {
    selectedClusterIndex = clusterIndex;
    if (!activeColorsOutput) return;

    const cluster = activeColorsOutput.palette[clusterIndex];
    if (!cluster) return;

    const hex = rgbToHex(cluster);
    editColorwell.value = hex;
    editHex.value = hex;
    editAlpha.value = "255";
    editEye.checked = true;
    editorPanel.style.display = "block";

    const dimmed = createDimmedPreview(activeColorsOutput, clusterIndex);
    api.onSelectCluster?.(clusterIndex, dimmed);
    api.onPreviewUpdate?.(dimmed);

    renderBubbles();
  }

  function closeEditor(): void {
    selectedClusterIndex = null;
    editorPanel.style.display = "none";
    if (activeColorsOutput) {
      api.onPreviewUpdate?.(activeColorsOutput.colors);
    }
    api.onSelectCluster?.(null, null);
    renderBubbles();
  }

  // 4. Tool Row
  const toolRow = document.createElement("div");
  toolRow.className = "cd-tool-row";

  const toggleView = document.createElement("div");
  toggleView.className = "cd-toggle-view cd-output-mode";
  toggleView.innerHTML = `
    <span class="cd-toggle-label">Original</span>
    <div class="cd-toggle-pill">
      <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><path d="m7 16-4-4 4-4"></path><path d="m17 8 4 4-4 4"></path><path d="M3 12h18"></path></svg>
    </div>
    <span class="cd-toggle-label">Output</span>
  `;
  toggleView.addEventListener("click", () => {
    viewMode = viewMode === "original" ? "output" : "original";
    toggleView.classList.toggle("cd-output-mode", viewMode === "output");
    renderBubbles();
    api.onToggleView?.(viewMode);
  });

  const btnMerge = document.createElement("button");
  btnMerge.type = "button";
  btnMerge.className = "cd-tool-btn";
  btnMerge.innerHTML = `
    <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
      <circle cx="6" cy="12" r="3.5"></circle>
      <circle cx="18" cy="12" r="3.5"></circle>
      <path d="M9.5 12h5"></path>
    </svg>
    <span>Merge</span>
  `;
  btnMerge.addEventListener("click", () => {
    setTool(activeTool === "merge" ? "none" : "merge");
  });

  const btnSplit = document.createElement("button");
  btnSplit.type = "button";
  btnSplit.className = "cd-tool-btn";
  btnSplit.innerHTML = `
    <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
      <circle cx="12" cy="12" r="4"></circle>
      <circle cx="6" cy="6" r="2.5"></circle>
      <circle cx="18" cy="18" r="2.5"></circle>
      <path d="M9.5 9.5 7.5 7.5M14.5 14.5l2 2"></path>
    </svg>
    <span>Split</span>
  `;
  btnSplit.addEventListener("click", () => {
    setTool(activeTool === "split" ? "none" : "split");
  });

  const btnEdit = document.createElement("button");
  btnEdit.type = "button";
  btnEdit.className = "cd-tool-btn";
  btnEdit.innerHTML = `
    <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
      <circle cx="12" cy="12" r="9"></circle>
      <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
      <path d="m14 14 6 6"></path>
    </svg>
    <span>Edit</span>
  `;
  btnEdit.addEventListener("click", () => {
    setTool(activeTool === "edit" ? "none" : "edit");
  });

  toolRow.append(toggleView, btnMerge, btnSplit, btnEdit);

  // 5. Presets Section
  const presetsSection = document.createElement("div");
  presetsSection.className = "cd-presets-section";

  const presetsHeader = document.createElement("div");
  presetsHeader.className = "cd-presets-title";
  presetsHeader.innerHTML = `Palette Presets <span class="cd-presets-subtitle">(processing color count)</span>`;

  const swatchGrid = document.createElement("div");
  swatchGrid.className = "cd-swatch-grid";

  const MAX_PRESET_COUNT = 48;
  const swatchButtons: HTMLDivElement[] = [];

  for (let count = 1; count <= MAX_PRESET_COUNT; count++) {
    const swatch = document.createElement("div");
    swatch.className = "cd-swatch";
    swatch.textContent = String(count);
    swatch.dataset.count = String(count);

    const hue = (count * 137.508) % 360;
    const lightness = 40 + ((count * 19) % 25);
    swatch.style.backgroundColor = `hsl(${hue}, 70%, ${lightness}%)`;

    if (count === currentMaxColors) {
      swatch.classList.add("selected");
    }

    swatch.addEventListener("click", () => {
      handleMaxColorsChange(count);
    });

    swatchGrid.append(swatch);
    swatchButtons.push(swatch);
  }

  presetsSection.append(presetsHeader, swatchGrid);
  root.append(header, canvasContainer, toolRow, presetsSection);

  function handleMaxColorsChange(newCount: number): void {
    if (newCount === currentMaxColors) return;
    currentMaxColors = newCount;
    updateSelectedPreset();
    api.onSetMaxColors?.(newCount);
  }

  function updateSelectedPreset(): void {
    const badgeText = root.querySelector("#cd-count-text");
    if (badgeText) badgeText.textContent = String(currentMaxColors);

    for (const btn of swatchButtons) {
      const c = Number(btn.dataset.count);
      btn.classList.toggle("selected", c === currentMaxColors);
    }
  }

  function setTool(tool: "none" | "merge" | "split" | "edit"): void {
    activeTool = tool;
    btnMerge.classList.toggle("active", activeTool === "merge");
    btnSplit.classList.toggle("active", activeTool === "split");
    btnEdit.classList.toggle("active", activeTool === "edit");
  }

  function syncDiscardApplyBar(): void {
    if (forceShowApplyBar) {
      applyBar.style.display = "inline-flex";
      btnAllTools.style.display = "none";
      return;
    }

    if (!rawColorsOutput || !activeColorsOutput) {
      applyBar.style.display = "none";
      btnAllTools.style.display = "inline-flex";
      return;
    }

    const hasNetChanges = !isNetZeroEdits(rawColorsOutput, activeColorsOutput);
    if (hasNetChanges) {
      applyBar.style.display = "inline-flex";
      btnAllTools.style.display = "none";
    } else {
      applyBar.style.display = "none";
      btnAllTools.style.display = "inline-flex";
    }
  }

  btnDiscard.addEventListener("click", () => {
    history.clear();
    forceShowApplyBar = false;
    if (rawColorsOutput) {
      activeColorsOutput = rawColorsOutput;
      api.onPreviewUpdate?.(activeColorsOutput.colors);
      api.onEditsChanged?.([], activeColorsOutput);
      api.onDiscard?.();
    }
    syncHistoryButtons();
    syncDiscardApplyBar();
    renderBubbles();
  });

  btnApply.addEventListener("click", () => {
    if (activeColorsOutput) {
      api.onApply?.(activeColorsOutput);
    }
  });

  function applyEditAction(edit: PaletteEdit): void {
    if (!rawColorsOutput) return;
    history.push(edit);
    activeColorsOutput = applyEdits(rawColorsOutput, history.getEdits());
    syncHistoryButtons();
    syncDiscardApplyBar();
    renderBubbles();

    api.onPreviewUpdate?.(activeColorsOutput.colors);

    if (edit.kind === "merge") api.onMerge?.(edit.from, edit.to);
    else if (edit.kind === "split") api.onSplit?.(edit.cluster, edit.k ?? 2);
    else if (edit.kind === "splitShade") api.onSplitShade?.(edit.cluster, edit.shadeIndex);
    else if (edit.kind === "recolor") api.onRecolor?.(edit.cluster, edit.hex, edit.alpha);
    else if (edit.kind === "hide") api.onHide?.(edit.cluster, edit.hidden);

    api.onEditsChanged?.(history.getEdits(), activeColorsOutput);
  }

  function syncHistoryButtons(): void {
    btnUndo.disabled = !history.canUndo();
    btnRedo.disabled = !history.canRedo();
  }

  btnUndo.addEventListener("click", () => {
    if (!rawColorsOutput) return;
    const undone = history.undo();
    if (undone) {
      activeColorsOutput = applyEdits(rawColorsOutput, history.getEdits());
      syncHistoryButtons();
      syncDiscardApplyBar();
      renderBubbles();
      api.onPreviewUpdate?.(activeColorsOutput.colors);
      api.onUndo?.();
      api.onEditsChanged?.(history.getEdits(), activeColorsOutput);
    }
  });

  btnRedo.addEventListener("click", () => {
    if (!rawColorsOutput) return;
    const redone = history.redo();
    if (redone) {
      activeColorsOutput = applyEdits(rawColorsOutput, history.getEdits());
      syncHistoryButtons();
      syncDiscardApplyBar();
      renderBubbles();
      api.onPreviewUpdate?.(activeColorsOutput.colors);
      api.onRedo?.();
      api.onEditsChanged?.(history.getEdits(), activeColorsOutput);
    }
  });

  function computeStablePackedPositions(clusters: PaletteCluster[]): PositionedBubble[] {
    const viewW = 440;
    const viewH = 340;
    const maxPixels = Math.max(...clusters.map((c) => c.pixelCount), 1);

    const items = clusters.map((c) => {
      const normalized = Math.sqrt(c.pixelCount / maxPixels);
      const r = Math.max(20, Math.min(65, normalized * 62));
      return { id: c.index, r, hex: c.hex };
    });

    const allCached = items.every((it) => bubblePositionCache.has(it.hex));
    if (allCached) {
      return items.map((it) => {
        const pos = bubblePositionCache.get(it.hex)!;
        return { id: it.id, x: pos.x, y: pos.y, r: it.r };
      });
    }

    const sorted = [...items].sort((a, b) => b.r - a.r);
    const packed = packCirclesDeterministic(sorted);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    packed.forEach((p) => {
      minX = Math.min(minX, p.x - p.r);
      maxX = Math.max(maxX, p.x + p.r);
      minY = Math.min(minY, p.y - p.r);
      maxY = Math.max(maxY, p.y + p.r);
    });

    const pad = 24;
    const packW = Math.max(1, maxX - minX);
    const packH = Math.max(1, maxY - minY);
    const scale = Math.min((viewW - pad * 2) / packW, (viewH - pad * 2) / packH, 1.15);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const results: PositionedBubble[] = [];
    packed.forEach((p) => {
      const orig = items.find((it) => it.id === p.id);
      const x = viewW / 2 + (p.x - centerX) * scale;
      const y = viewH / 2 + (p.y - centerY) * scale;
      const r = p.r * scale;

      if (orig) {
        bubblePositionCache.set(orig.hex, { x, y });
      }
      results.push({ id: p.id, x, y, r });
    });

    return results;
  }

  function renderBubbles(): void {
    svg.replaceChildren();

    if (!activeColorsOutput || activeColorsOutput.palette.length === 0) {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", "220");
      text.setAttribute("y", "180");
      text.setAttribute("fill", "#64748b");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "14");
      text.textContent = "ไม่มีข้อมูลกลุ่มสี (No color clusters)";
      svg.append(text);
      return;
    }

    const clusters = extractClusters(activeColorsOutput);
    if (clusters.length === 0) return;

    const defs = document.createElementNS(SVG_NS, "defs");

    const filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", "cd-bubble-shadow");
    filter.setAttribute("x", "-20%");
    filter.setAttribute("y", "-20%");
    filter.setAttribute("width", "140%");
    filter.setAttribute("height", "140%");
    filter.innerHTML = `<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.45" />`;
    defs.append(filter);

    clusters.forEach((c) => {
      const grad = document.createElementNS(SVG_NS, "radialGradient");
      grad.setAttribute("id", `cd-grad-${c.index}`);
      grad.setAttribute("cx", "35%");
      grad.setAttribute("cy", "35%");
      grad.setAttribute("r", "70%");
      grad.setAttribute("fx", "30%");
      grad.setAttribute("fy", "30%");

      const stop0 = document.createElementNS(SVG_NS, "stop");
      stop0.setAttribute("offset", "0%");
      stop0.setAttribute("stop-color", lightenHex(c.hex, 0.25));

      const stop1 = document.createElementNS(SVG_NS, "stop");
      stop1.setAttribute("offset", "75%");
      stop1.setAttribute("stop-color", c.hex);

      const stop2 = document.createElementNS(SVG_NS, "stop");
      stop2.setAttribute("offset", "100%");
      stop2.setAttribute("stop-color", darkenHex(c.hex, 0.3));

      grad.append(stop0, stop1, stop2);
      defs.append(grad);
    });
    svg.append(defs);

    const positioned = computeStablePackedPositions(clusters);
    const clusterMap = new Map(clusters.map((c) => [c.index, c]));

    positioned.forEach((p) => {
      const cluster = clusterMap.get(p.id);
      if (!cluster) return;

      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", "cd-bubble-group");
      group.dataset.cluster = String(cluster.index);

      if (selectedClusterIndex === cluster.index) {
        group.classList.add("cd-selected-bubble");
      }

      // Main cluster bubble
      const mainCircle = document.createElementNS(SVG_NS, "circle");
      mainCircle.setAttribute("class", "cd-main-bubble");
      mainCircle.setAttribute("cx", String(p.x));
      mainCircle.setAttribute("cy", String(p.y));
      mainCircle.setAttribute("r", String(p.r));
      mainCircle.setAttribute("fill", `url(#cd-grad-${cluster.index})`);
      mainCircle.setAttribute("stroke", selectedClusterIndex === cluster.index ? "#38bdf8" : "rgba(255, 255, 255, 0.12)");
      mainCircle.setAttribute("stroke-width", selectedClusterIndex === cluster.index ? "3.5" : "1");
      mainCircle.setAttribute("filter", "url(#cd-bubble-shadow)");
      group.append(mainCircle);

      // Inner circles = source colors folded into output color
      if (cluster.subShades.length > 0 && p.r > 16) {
        const subCount = cluster.subShades.length;
        const subRadius = Math.max(3.5, Math.min(9.5, (p.r * 0.65) / Math.sqrt(subCount)));

        cluster.subShades.forEach((shade, sIdx) => {
          const subAngle = (sIdx * 2.399963229728653);
          const subDist = Math.min(p.r * 0.65, Math.sqrt(sIdx + 0.5) * subRadius * 1.5);
          const scx = p.x + Math.cos(subAngle) * subDist;
          const scy = p.y + Math.sin(subAngle) * subDist;

          const subCircle = document.createElementNS(SVG_NS, "circle");
          subCircle.setAttribute("class", "cd-sub-bubble");
          subCircle.dataset.cluster = String(cluster.index);
          subCircle.dataset.shadeIndex = String(sIdx);
          subCircle.setAttribute("cx", String(scx));
          subCircle.setAttribute("cy", String(scy));
          subCircle.setAttribute("r", String(subRadius));
          subCircle.setAttribute("fill", viewMode === "original" ? shade.hex : lightenHex(cluster.hex, 0.15));
          subCircle.setAttribute("stroke", "rgba(255, 255, 255, 0.28)");
          subCircle.setAttribute("stroke-width", "0.75");
          subCircle.setAttribute("cursor", "grab");

          subCircle.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
            const startX = event.clientX;
            const startY = event.clientY;
            let isDraggingOut = false;

            const onPointerMove = (moveEv: PointerEvent) => {
              const dist = Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY);
              if (dist > p.r * 0.75) {
                isDraggingOut = true;
                subCircle.classList.add("cd-drag-out");
              }
            };

            const onPointerUp = () => {
              window.removeEventListener("pointermove", onPointerMove);
              window.removeEventListener("pointerup", onPointerUp);
              subCircle.classList.remove("cd-drag-out");

              if (isDraggingOut) {
                applyEditAction({ kind: "splitShade", cluster: cluster.index, shadeIndex: sIdx });
              }
            };

            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
          });

          group.append(subCircle);
        });
      }

      // Bubble pointer interactions
      group.addEventListener("pointerdown", (event) => {
        if (activeTool === "split") {
          applyEditAction({ kind: "split", cluster: cluster.index, k: 2 });
          return;
        }

        if (activeTool === "edit") {
          openEditor(cluster.index);
          return;
        }

        const startX = event.clientX;
        const startY = event.clientY;
        let isDragging = false;

        const onPointerMove = (moveEvent: PointerEvent) => {
          const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (dist > 5 && !isDragging) {
            isDragging = true;
            group.classList.add("cd-drag-source");
          }

          if (isDragging) {
            const elements = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY);
            const targetGroup = elements.find((el) => el.classList.contains("cd-bubble-group")) as HTMLElement | undefined;

            svg.querySelectorAll(".cd-drop-target").forEach((el) => el.classList.remove("cd-drop-target"));
            if (targetGroup && targetGroup.dataset.cluster !== String(cluster.index)) {
              targetGroup.classList.add("cd-drop-target");
            }
          }
        };

        const onPointerUp = (upEvent: PointerEvent) => {
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          group.classList.remove("cd-drag-source");

          const elements = document.elementsFromPoint(upEvent.clientX, upEvent.clientY);
          const targetGroup = elements.find((el) => el.classList.contains("cd-bubble-group")) as HTMLElement | undefined;
          svg.querySelectorAll(".cd-drop-target").forEach((el) => el.classList.remove("cd-drop-target"));

          if (isDragging && targetGroup) {
            const targetCluster = Number(targetGroup.dataset.cluster);
            if (!isNaN(targetCluster) && targetCluster !== cluster.index) {
              applyEditAction({ kind: "merge", from: cluster.index, to: targetCluster });
            }
          } else if (!isDragging) {
            if (selectedClusterIndex === cluster.index) {
              closeEditor();
            } else {
              openEditor(cluster.index);
            }
          }
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
      });

      svg.append(group);
    });
  }

  return {
    update(colorsOutput: SegmentColorStage | null, options?: { readonly maxColors?: number }): void {
      if (options?.maxColors !== undefined && options.maxColors > 0) {
        currentMaxColors = options.maxColors;
        updateSelectedPreset();
      }

      const prevRaw = rawColorsOutput;
      rawColorsOutput = colorsOutput;

      if (colorsOutput) {
        if (prevRaw && prevRaw.palette.length !== colorsOutput.palette.length && history.getEdits().length > 0) {
          const { remappedEdits } = remapEditsAcrossMaxColors(history.getEdits(), prevRaw, colorsOutput);
          history.setEdits(remappedEdits);
        }

        activeColorsOutput = applyEdits(colorsOutput, history.getEdits());
      } else {
        activeColorsOutput = null;
      }

      syncHistoryButtons();
      syncDiscardApplyBar();
      renderBubbles();
    },

    selectCluster(clusterIndex: number | null): void {
      if (clusterIndex === null) {
        closeEditor();
      } else {
        openEditor(clusterIndex);
      }
    },

    showApplyBar(show: boolean): void {
      forceShowApplyBar = show;
      syncDiscardApplyBar();
    },

    destroy(): void {
      container.replaceChildren();
    }
  };
}

function lightenHex(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * percent));
  const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * percent));
  const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * percent));
  return rgbToHex({ r, g, b });
}

function darkenHex(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  const r = Math.max(0, Math.round(rgb.r * (1 - percent)));
  const g = Math.max(0, Math.round(rgb.g * (1 - percent)));
  const b = Math.max(0, Math.round(rgb.b * (1 - percent)));
  return rgbToHex({ r, g, b });
}

export type Bounds = readonly [number, number, number, number];

export type ArtNode = {
  readonly typename: string;
  readonly uuid: string;
  readonly note?: string;
  readonly bounds: Bounds;
  readonly children?: readonly ArtNode[];
};

export type TraceTarget = {
  readonly source: ArtNode;
  readonly fromResult: boolean;
};

const NOTE_PATTERN = /^VectorPanel\/1\|source=([^|]+)\|/;

export function resolveTraceTarget(selected: ArtNode, lookup: (uuid: string) => ArtNode | null): TraceTarget {
  if (isRaster(selected)) return { source: selected, fromResult: false };
  if (selected.typename === "GroupItem") {
    const linked = linkedSource(selected, lookup);
    if (linked !== null) return { source: linked, fromResult: true };
    const inner = largestRaster(selected);
    if (inner !== null) return { source: inner, fromResult: false };
  }
  return { source: selected, fromResult: false };
}

export function commitBounds(item: ArtNode | null, recorded: Bounds): { readonly bounds: Bounds; readonly moved: boolean } {
  if (item === null) return { bounds: recorded, moved: false };
  if (boundsMatch(item.bounds, recorded)) return { bounds: item.bounds, moved: false };
  const matched = collectRasters(item).find((raster) => boundsMatch(raster.bounds, recorded));
  if (matched !== undefined) return { bounds: matched.bounds, moved: false };
  if (isRaster(item) || collectRasters(item).length > 0) return { bounds: item.bounds, moved: true };
  return { bounds: recorded, moved: false };
}

function linkedSource(group: ArtNode, lookup: (uuid: string) => ArtNode | null): ArtNode | null {
  const matched = NOTE_PATTERN.exec(group.note ?? "");
  const uuid = matched?.[1];
  if (uuid === undefined) return null;
  const linked = lookup(uuid);
  if (linked === null) return null;
  if (isRaster(linked)) return linked;
  return largestRaster(linked);
}

function largestRaster(item: ArtNode): ArtNode | null {
  const rasters = collectRasters(item);
  let best: ArtNode | null = null;
  let bestArea = 0;
  for (const raster of rasters) {
    const size = area(raster.bounds);
    if (size > bestArea) {
      best = raster;
      bestArea = size;
    }
  }
  return best;
}

function collectRasters(item: ArtNode): ArtNode[] {
  const found: ArtNode[] = [];
  const seen = new Set<string>();
  walk(item, found, seen);
  return found;
}

function walk(item: ArtNode, found: ArtNode[], seen: Set<string>): void {
  if (seen.has(item.uuid)) return;
  seen.add(item.uuid);
  if (isRaster(item)) {
    found.push(item);
    return;
  }
  if (item.typename !== "GroupItem") return;
  for (const child of item.children ?? []) walk(child, found, seen);
}

function isRaster(item: ArtNode): boolean {
  return item.typename === "PlacedItem" || item.typename === "RasterItem";
}

function area(bounds: Bounds): number {
  const width = bounds[2] - bounds[0];
  const height = bounds[1] - bounds[3];
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function boundsMatch(actual: Bounds, expected: Bounds): boolean {
  for (let index = 0; index < 4; index += 1) {
    if (Math.abs((actual[index] ?? 0) - (expected[index] ?? 0)) > 0.05) return false;
  }
  return true;
}

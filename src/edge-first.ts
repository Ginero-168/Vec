/**
 * Edge-first finish (port of stage 4 of Vecy's edge-first prototype, ef_v5.py): the regions of a source-resolution
 * label map become one shared crack graph, each shared boundary chain gets sub-pixel edge points by anti-aliasing area
 * integration against the source, corners are split and sharpened, each chain is fitted once (Schneider, max and rms
 * error), and every drawn region is emitted as itself plus its smaller neighbours, largest first, so abutting shapes
 * share their curves exactly and nothing shows between them.
 */

import { SPECK_SOURCE, TRACER_LAYER_DIFFERENCE } from "./flat-trace.ts";
import { NEAR_FILL } from "./score.ts";
import { RANGE_SIGMA } from "./denoise.ts";

type Point = [number, number];
type Cubic = [Point, Point, Point, Point];

/** Region labels at source resolution: an ink index per pixel, or -1 for the undrawn backdrop. */
export type EdgeLabels = {
  readonly width: number;
  readonly height: number;
  readonly labels: Int32Array;
  /** Ink colours (#rrggbb), indexed by label. */
  readonly inks: readonly string[];
};

/** The prototype's fit: a cubic passes when its largest error is within KMAX tolerances and its rms within KRMS. */
const KMAX = 2.5;
const KRMS = 0.5;
/**
 * The fit tolerance (source px). The largest error a cubic may have, KMAX * tolerance, is the anti-aliased band an edge
 * occupies: half a pixel either side of it (an edge further off than that changes which pixels it covers).
 */
export const EDGE_TOLERANCE = 0.5 / KMAX;
/** Corners: a turn of more than this over 2 px of outline is split and sharpened (the prototype's corner angle). */
const CORNER_DEGREES = 50;
/** Pixels each side of a boundary that the area integration reads (3 clean; 2 lossy, where the window picks up noise). */
const WINDOW_CLEAN = 3;
const WINDOW_LOSSY = 2;
/** A lossy edge point averages a 2-px window instead of 3, so its noise, and the tolerance, grow by sqrt(3 / 2). */
const LOSSY_TOLERANCE = EDGE_TOLERANCE * Math.sqrt(WINDOW_CLEAN / WINDOW_LOSSY);

type Edge = { readonly a: number; readonly b: number; readonly kind: "h" | "v"; readonly y: number; readonly x: number; readonly la: number; readonly lb: number };
type Chain = { readonly vs: number[]; readonly es: number[]; readonly closed: boolean; readonly pair: readonly [number, number] };

/**
 * The SVG for `labels`, read against `source` (rgba, same size). `lossy`: the source is a lossy (JPEG) raster, whose
 * edge points use the narrower window. Transparent backdrop when the source has transparency, else the backdrop colour
 * is the source's most common border colour.
 */
export function edgeFirstSvg(labelMap: EdgeLabels, source: Uint8Array, lossy: boolean): string {
  const { width: W, height: H } = labelMap;
  const { regions, count, inkOf } = connectedRegions(labelMap, source, lossy);
  const X = new Float32Array(W * H * 4);
  let clearPixels = 0;
  for (let at = 0; at < W * H; at += 1) {
    const alpha = (source[at * 4 + 3] ?? 0) / 255;
    if (alpha < 250 / 255) clearPixels += 1;
    for (let channel = 0; channel < 3; channel += 1) X[at * 4 + channel] = (source[at * 4 + channel] ?? 0) * alpha;
    X[at * 4 + 3] = alpha * 255;
  }
  const hasAlpha = clearPixels > 0.002 * W * H;
  const backdrop = hasAlpha ? [0, 0, 0, 0] : borderColour(X, W, H);
  // On an opaque image the background is not a shape every neighbour has to be unioned with. Where the plan punched a
  // backdrop, border regions of the backdrop's colour join it; otherwise the border region with the longest boundary
  // to the others (what everything sits on; the larger on a tie) becomes one canvas-sized underlay drawn first.
  let underlay = -1;
  const underRegions = new Set<number>();
  if (!hasAlpha) {
    const size = new Map<number, number>(), contact = new Map<number, number>();
    for (let at = 0; at < W * H; at += 1) {
      const here = regions[at]!;
      size.set(here, (size.get(here) ?? 0) + 1);
      if (at % W + 1 < W && regions[at + 1] !== here) for (const r of [here, regions[at + 1]!]) contact.set(r, (contact.get(r) ?? 0) + 1);
      if (at + W < W * H && regions[at + W] !== here) for (const r of [here, regions[at + W]!]) contact.set(r, (contact.get(r) ?? 0) + 1);
    }
    const onBorder = new Set<number>();
    for (let at = 0; at < W * H; at += 1) {
      const x = at % W, y = Math.floor(at / W);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) onBorder.add(regions[at]!);
    }
    const punched = [...onBorder].some((region) => inkOf[region]! < 0);
    // Near the backdrop: within NEAR_FILL, or on a lossy source within the denoiser's noise range.
    const nearBy = lossy ? RANGE_SIGMA : NEAR_FILL;
    const near = (ink: number) => hexRgb(labelMap.inks[ink]!).every((v, c) => Math.abs(v - backdrop[c]!) <= nearBy);
    if (punched) {
      // The plan already punched the backdrop: border regions of its colour are more of it, and stay undrawn.
      for (const region of onBorder) if (inkOf[region]! >= 0 && near(inkOf[region]!)) inkOf[region] = -1;
    } else {
      let best = -1;
      for (const region of onBorder) {
        const score = (contact.get(region) ?? 0) * (W * H + 1) + size.get(region)!;
        if (inkOf[region]! >= 0 && score > best) { best = score; underlay = inkOf[region]!; }
      }
      for (const region of onBorder) if (inkOf[region] === underlay) underRegions.add(region);
    }
    for (const region of underRegions) inkOf[region] = -1;
  }
  const colours: number[][] = [];
  for (let region = 0; region < count; region += 1) {
    const ink = inkOf[region]!;
    colours.push(underRegions.has(region) ? [...hexRgb(labelMap.inks[underlay]!), 255] : ink < 0 ? backdrop : [...hexRgb(labelMap.inks[ink]!), 255]);
  }
  const { edges, chains } = crackGraph(regions, W, H);
  const window = lossy ? WINDOW_LOSSY : WINDOW_CLEAN;
  const corner = (v: number): Point => [v % (W + 1), Math.floor(v / (W + 1))];
  const allPoints = chains.map((chain) => subpixelPoints(chain, edges, regions, W, H, X, colours, window, backdrop, lossy));
  // A junction on the canvas border slides along the border to where the boundaries meeting it reach it (the mean of
  // their nearest edge points within the integration's reach), so an edge that crosses the border does not bend back
  // to the crack corner there. Every chain ending at the junction uses the moved point. A boundary that meets the
  // border tangentially (it leaves within 45 degrees of the border) does not reach it at the crack corner: the corner
  // only marks where its partly covered pixels stop. There the junction takes the boundary's own nearest edge point,
  // off the border, and the border chain's end crack (left unshifted) is dropped, so the edge runs on along the
  // border chain's shifted points.
  const moved = new Map<number, Point>();
  const reach = new Map<number, Point[]>();
  const tangent = new Set<number>();
  const onBorder = (v: number) => { const [vx, vy] = corner(v); return vx === 0 || vx === W || vy === 0 || vy === H; };
  const canvasCorner = (v: number) => { const [vx, vy] = corner(v); return (vx === 0 || vx === W) && (vy === 0 || vy === H); };
  chains.forEach((chain, index) => {
    if (chain.closed || chain.pair[0] < 0 || allPoints[index]!.length === 0) return;
    const pts = allPoints[index]!;
    for (const [v, p, far] of [[chain.vs[0]!, pts[0]!, pts[Math.min(3, pts.length - 1)]!], [chain.vs[chain.vs.length - 1]!, pts[pts.length - 1]!, pts[Math.max(0, pts.length - 4)]!]] as const) {
      if (!onBorder(v) || canvasCorner(v)) continue;
      const [vx, vy] = corner(v);
      if (Math.hypot(p[0] - vx, p[1] - vy) > 1.5) continue;
      (reach.get(v) ?? reach.set(v, []).get(v)!).push(p);
      // The boundary's own direction, from its nearest edge point (the crack corner sits off a tangent boundary).
      const along = vx === 0 || vx === W ? Math.abs(far[1] - p[1]) : Math.abs(far[0] - p[0]);
      const across = vx === 0 || vx === W ? Math.abs(far[0] - p[0]) : Math.abs(far[1] - p[1]);
      if (along > across) tangent.add(v);
    }
  });
  for (const [v, ps] of reach) {
    const [vx, vy] = corner(v);
    const mean: Point = [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
    if (tangent.has(v) && ps.length === 1) { moved.set(v, mean); continue; }
    tangent.delete(v);
    moved.set(v, vx === 0 || vx === W ? [vx, Math.min(H, Math.max(0, mean[1]))] : [Math.min(W, Math.max(0, mean[0])), vy]);
  }
  const tolerance = lossy ? LOSSY_TOLERANCE : EDGE_TOLERANCE;
  const end = (v: number): Point => moved.get(v) ?? corner(v);
  const curves = chains.map((chain, index) => {
    let points = allPoints[index]!;
    if (chain.closed) {
      const loop = points.length >= 3 ? points : chain.vs.slice(0, -1).map(corner);
      return fitChain(loop, true, tolerance);
    }
    if (chain.pair[0] < 0 || chain.pair[1] < 0) {
      const first = tangent.has(chain.vs[0]!) ? 1 : 0, last = tangent.has(chain.vs[chain.vs.length - 1]!) ? 1 : 0;
      if (points.length > first + last) points = points.slice(first, points.length - last);
    }
    const v0 = end(chain.vs[0]!), v1 = end(chain.vs[chain.vs.length - 1]!);
    let inner = points.filter((p) => Math.hypot(p[0] - v0[0], p[1] - v0[1]) > 0.5 && Math.hypot(p[0] - v1[0], p[1] - v1[1]) > 0.5);
    if (inner.length === 0 && chain.vs.length > 2) inner = chain.vs.slice(1, -1).map(corner);
    return fitChain([v0, ...inner, v1], false, tolerance);
  });
  const area = new Array<number>(count).fill(0);
  for (const region of regions) area[region]! += 1;
  const drawn = [...Array(count).keys()].filter((region) => inkOf[region]! >= 0);
  const order = drawn.sort((left, right) => area[right]! - area[left]! || left - right);
  const rank = new Map(order.map((region, index) => [region, index]));
  const neighbours = new Map<number, Set<number>>();
  const byRegion = new Map<number, number[]>();
  chains.forEach((chain, index) => {
    const [a, b] = chain.pair;
    for (const [p, q] of [[a, b], [b, a]] as const) {
      if (p < 0) continue;
      (byRegion.get(p) ?? byRegion.set(p, []).get(p)!).push(index);
      if (q >= 0) (neighbours.get(p) ?? neighbours.set(p, new Set()).get(p)!).add(q);
    }
  });
  const parts: string[] = underlay < 0 ? [] : [`<path d="M0,0L${W},0L${W},${H}L0,${H}Z" fill="${labelMap.inks[underlay]!.toUpperCase()}"/>`];
  for (const region of order) {
    const union = new Set([region]);
    for (const other of neighbours.get(region) ?? []) if ((rank.get(other) ?? -1) > rank.get(region)!) union.add(other);
    const boundary = new Set<number>();
    for (const member of union) {
      for (const index of byRegion.get(member) ?? []) {
        const [a, b] = chains[index]!.pair;
        if (union.has(a) !== union.has(b)) boundary.add(index);
      }
    }
    const d = loops([...boundary].sort((l, r) => l - r), chains, curves, W);
    if (d !== "") parts.push(`<path d="${d}" fill="${labelMap.inks[inkOf[region]!]!.toUpperCase()}" fill-rule="evenodd"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

/**
 * The 4-connected regions of one ink each (the backdrop, -1, is a region too). A region smaller than the speckle the
 * flat trace already drops (SPECK_SOURCE source px, VTracer's filter-speckle) joins the neighbour it shares the most
 * boundary with, as VTracer folds such a patch into its surroundings.
 */
function connectedRegions(labelMap: EdgeLabels, source: Uint8Array, lossy: boolean): { regions: Int32Array; count: number; inkOf: number[] } {
  const { width: W, height: H } = labelMap;
  const labels = Int32Array.from(labelMap.labels);
  const speck = lossy ? LOSSY_SPECK : SPECK_SOURCE;
  foldThinMixes(labels, labelMap.inks, source, W, H, lossy);
  for (let pass = 0; pass < 4; pass += 1) {
    const found = components(labels, W, H);
    let changed = false;
    const size = new Array<number>(found.count).fill(0);
    for (const region of found.regions) size[region]! += 1;
    const shared = new Map<number, Map<number, number>>();
    for (let at = 0; at < W * H; at += 1) {
      const here = found.regions[at]!;
      if (size[here]! >= speck) continue;
      const x = at % W;
      for (const next of [x > 0 ? at - 1 : -1, x < W - 1 ? at + 1 : -1, at - W, at + W]) {
        if (next < 0 || next >= W * H) continue;
        const other = found.regions[next]!;
        if (other === here) continue;
        const tally = shared.get(here) ?? shared.set(here, new Map()).get(here)!;
        tally.set(other, (tally.get(other) ?? 0) + 1);
      }
    }
    const inkOfRegion = found.inkOf;
    const target = new Map<number, number>();
    for (const [region, tally] of shared) {
      let best = -1, most = 0;
      for (const [other, count] of tally) if (count > most || (count === most && size[other]! > size[best]!)) { best = other; most = count; }
      if (best >= 0 && inkOfRegion[best]! !== inkOfRegion[region]!) target.set(region, inkOfRegion[best]!);
    }
    for (let at = 0; at < W * H; at += 1) {
      const ink = target.get(found.regions[at]!);
      if (ink !== undefined) { labels[at] = ink; changed = true; }
    }
    if (!changed) break;
  }
  return components(labels, W, H);
}

/** On a lossy (4:2:0) source a patch smaller than one chroma sample (2 x 2 px) has no colour of its own. */
const LOSSY_SPECK = 4;
/** A strip is anti-aliasing when it is narrower than this (area / perimeter is half a long strip's width). */
const THIN_RATIO = 0.7;

/**
 * A thin region (narrower than about 1.4 px, THIN_RATIO) whose ink is a mix of two neighbouring inks, within the
 * tracer's own layer difference of the line between them, is an anti-aliasing ramp: its pixels join the neighbour
 * the mix is nearer to. A region between two parts of one ink (a hairline) is kept: its ink is no mix of two inks.
 */
function foldThinMixes(labels: Int32Array, inks: readonly string[], source: Uint8Array, W: number, H: number, lossy: boolean): void {
  const inkRgb = inks.map((hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)));
  // On an opaque image the page goes on past the canvas edge in the backdrop colour (edgeFirstSvg's test), so the
  // canvas outside is one more side a border fringe can be the mix with.
  let clear = 0;
  const premultiplied = new Float32Array(W * H * 4);
  for (let at = 0; at < W * H; at += 1) {
    const alpha = source[at * 4 + 3]! / 255;
    if (alpha < 250 / 255) clear += 1;
    for (let c = 0; c < 3; c += 1) premultiplied[at * 4 + c] = source[at * 4 + c]! * alpha;
    premultiplied[at * 4 + 3] = alpha * 255;
  }
  const page = clear > 0.002 * W * H ? null : borderColour(premultiplied, W, H).slice(0, 3);
  const PAGE = -2;
  for (let pass = 0; pass < 3; pass += 1) {
    const found = components(labels, W, H);
    const area = new Array<number>(found.count).fill(0), perimeter = new Array<number>(found.count).fill(0);
    const interior = new Array<number>(found.count).fill(0), edge = new Uint8Array(found.count);
    // Region colours from the source (alpha-weighted): a catch-all fringe ink is no mix of any one pair, its pixels are.
    const sum = Array.from({ length: found.count }, () => [0, 0, 0, 0]);
    for (let at = 0; at < W * H; at += 1) {
      const total = sum[found.regions[at]!]!, alpha = source[at * 4 + 3]! / 255;
      for (let c = 0; c < 3; c += 1) total[c]! += source[at * 4 + c]! * alpha;
      total[3]! += alpha;
    }
    const rgb = sum.map((total) => total[3]! > 0 ? [0, 1, 2].map((c) => total[c]! / total[3]!) : [0, 0, 0]);
    const touching = new Map<number, Set<number>>();
    for (let at = 0; at < W * H; at += 1) {
      const here = found.regions[at]!, x = at % W, y = Math.floor(at / W);
      area[here]! += 1;
      let inside = true;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { perimeter[here]! += 1; edge[here] = 1; continue; }
        const other = found.regions[ny * W + nx]!;
        if (other === here) continue;
        perimeter[here]! += 1; inside = false;
        (touching.get(here) ?? touching.set(here, new Set()).get(here)!).add(other);
      }
      if (inside) interior[here]! += 1;
    }
    const into = new Map<number, number>();
    if (lossy) {
      // On a lossy source two touching regions whose inks differ by less than the denoiser's own range (RANGE_SIGMA,
      // what it blends as noise) in every channel are one colour: the smaller joins the larger.
      for (let region = 0; region < found.count; region += 1) {
        const ink = found.inkOf[region]!;
        if (ink < 0) continue;
        let best = -1;
        for (const other of touching.get(region) ?? []) {
          const otherInk = found.inkOf[other]!;
          if (otherInk < 0 || otherInk === ink || area[other]! <= area[region]!) continue;
          if (!inkRgb[ink]!.every((v, c) => Math.abs(v - inkRgb[otherInk]![c]!) < RANGE_SIGMA)) continue;
          if (best < 0 || area[other]! > area[best]!) best = other;
        }
        if (best >= 0) into.set(region, found.inkOf[best]!);
      }
    }
    for (let region = 0; region < found.count; region += 1) {
      if (into.has(region)) continue;
      const ink = found.inkOf[region]!;
      if (ink < 0 || area[region]! >= THIN_RATIO * perimeter[region]!) continue;
      const own = rgb[region]!;
      const inkRegion = new Map<number, number>();
      for (const other of touching.get(region) ?? []) {
        const otherInk = found.inkOf[other]!;
        // The punched backdrop is a side too where it is opaque (its colour is the source's); a fringe against a
        // transparent backdrop changes alpha, not colour, and is no mix.
        if (otherInk === ink || (otherInk < 0 && sum[other]![3]! < 0.5 * area[other]!)) continue;
        if (!inkRegion.has(otherInk) || area[other]! > area[inkRegion.get(otherInk)!]!) inkRegion.set(otherInk, other);
      }
      const neighbours = [...inkRegion.keys()];
      if (page !== null && edge[region] === 1) neighbours.push(PAGE);
      const colourOf = (key: number) => (key === PAGE ? page! : rgb[inkRegion.get(key)!]!);
      let best: { residual: number; ink: number } | null = null;
      for (let a = 0; a < neighbours.length; a += 1) {
        for (let b = a + 1; b < neighbours.length; b += 1) {
          const A = colourOf(neighbours[a]!), B = colourOf(neighbours[b]!), d = B.map((v, c) => v - A[c]!), dd = d.reduce((sum, v) => sum + v * v, 0);
          if (dd < 1e-6) continue;
          const t = Math.min(1, Math.max(0, own.reduce((sum, v, c) => sum + (v - A[c]!) * d[c]!, 0) / dd));
          const residual = own.reduce((sum, v, c) => sum + Math.abs(A[c]! + t * d[c]! - v), 0);
          // With no interior pixel every pixel is an edge pixel and the region has no colour of its own: it is a mix
          // when nearer the line between the two inks than half the step between them.
          const off = Math.hypot(...own.map((v, c) => A[c]! + t * d[c]! - v)), edgeOnly = interior[region] === 0;
          if (t <= 0 || t >= 1 || (residual > TRACER_LAYER_DIFFERENCE + 1 && !(edgeOnly && off < 0.5 * Math.sqrt(dd)))) continue;
          // A fringe against the page is its ink's anti-aliasing there: it joins that ink, and the edge shift places it.
          const side = neighbours[a] === PAGE ? neighbours[b]! : neighbours[b] === PAGE ? neighbours[a]! : t < 0.5 ? neighbours[a]! : neighbours[b]!;
          if (best === null || residual < best.residual) best = { residual, ink: side };
        }
      }
      if (best !== null) into.set(region, best.ink);
    }
    if (into.size === 0) return;
    for (let at = 0; at < W * H; at += 1) { const ink = into.get(found.regions[at]!); if (ink !== undefined) labels[at] = ink; }
  }
}

function components(labels: Int32Array, W: number, H: number): { regions: Int32Array; count: number; inkOf: number[] } {
  const regions = new Int32Array(W * H).fill(-1);
  const inkOf: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start += 1) {
    if (regions[start] !== -1) continue;
    const id = inkOf.length, ink = labels[start]!;
    inkOf.push(ink);
    regions[start] = id; stack.push(start);
    while (stack.length > 0) {
      const at = stack.pop()!, x = at % W;
      for (const next of [x > 0 ? at - 1 : -1, x < W - 1 ? at + 1 : -1, at - W, at + W]) {
        if (next < 0 || next >= W * H || regions[next] !== -1 || labels[next] !== ink) continue;
        regions[next] = id; stack.push(next);
      }
    }
  }
  return { regions, count: inkOf.length, inkOf };
}

/** The most common border colour (premultiplied, binned by 8), as the median of its pixels. */
function borderColour(X: Float32Array, W: number, H: number): number[] {
  const at: number[] = [];
  for (let x = 0; x < W; x += 1) at.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 1) at.push(y * W, y * W + W - 1);
  const bins = new Map<string, number[]>();
  for (const pixel of at) {
    const key = [0, 1, 2, 3].map((c) => Math.round(X[pixel * 4 + c]! / 8)).join(",");
    (bins.get(key) ?? bins.set(key, []).get(key)!).push(pixel);
  }
  let best: number[] = [];
  for (const pixels of bins.values()) if (pixels.length > best.length) best = pixels;
  return [0, 1, 2, 3].map((c) => { const v = best.map((p) => X[p * 4 + c]!).sort((l, r) => l - r); return v.length % 2 === 1 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2; });
}

/** Cracks between differently labelled pixels (the canvas outside is -1), walked into chains between junctions. */
function crackGraph(regions: Int32Array, W: number, H: number): { edges: Edge[]; chains: Chain[] } {
  const label = (y: number, x: number) => (y < 0 || x < 0 || y >= H || x >= W ? -1 : regions[y * W + x]!);
  const vertex = (y: number, x: number) => y * (W + 1) + x;
  const edges: Edge[] = [];
  for (let y = 0; y <= H; y += 1) for (let x = 0; x < W; x += 1) {
    const la = label(y - 1, x), lb = label(y, x);
    if (la !== lb) edges.push({ a: vertex(y, x), b: vertex(y, x + 1), kind: "h", y, x, la, lb });
  }
  for (let y = 0; y < H; y += 1) for (let x = 0; x <= W; x += 1) {
    const la = label(y, x - 1), lb = label(y, x);
    if (la !== lb) edges.push({ a: vertex(y, x), b: vertex(y + 1, x), kind: "v", y, x, la, lb });
  }
  const incident = new Map<number, number[]>();
  edges.forEach((edge, index) => {
    (incident.get(edge.a) ?? incident.set(edge.a, []).get(edge.a)!).push(index);
    (incident.get(edge.b) ?? incident.set(edge.b, []).get(edge.b)!).push(index);
  });
  const junction = new Set<number>();
  for (const [v, list] of incident) if (list.length !== 2) junction.add(v);
  const used = new Uint8Array(edges.length);
  const chains: Chain[] = [];
  const walk = (start: number, first: number, loopOnly: boolean) => {
    const vs = [start], es: number[] = [];
    let v = start, index = first, closed = loopOnly;
    for (;;) {
      used[index] = 1; es.push(index);
      const edge = edges[index]!;
      v = edge.a === v ? edge.b : edge.a; vs.push(v);
      if (junction.has(v)) break;
      const next = incident.get(v)!.find((k) => used[k] === 0);
      if (next === undefined) { closed = closed || vs[0] === v; break; }
      index = next;
    }
    const edge = edges[es[0]!]!;
    chains.push({ vs, es, closed: closed || vs[0] === vs[vs.length - 1], pair: [Math.min(edge.la, edge.lb), Math.max(edge.la, edge.lb)] });
  };
  for (const v of [...junction].sort((l, r) => l - r)) for (const index of incident.get(v)!) if (used[index] === 0) walk(v, index, false);
  for (let index = 0; index < edges.length; index += 1) if (used[index] === 0) walk(edges[index]!.a, index, true);
  return { edges, chains };
}

/**
 * The sub-pixel edge points of one chain. Per crack, the edge sits where the unmixing fractions across a window of
 * same-region pixels put it (area conservation: x_e = right end - sum of t); near-vertical boundaries are sampled per
 * row and near-horizontal ones per column. A canvas-border chain moves a partly covered border pixel's edge inward.
 */
const rgbaDot = (p: readonly number[], q: readonly number[]) => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]! + p[3]! * q[3]!;
/**
 * The unmixing product on a lossy source, in JPEG's own BT.601 YCbCr. 4:2:0 codes one chroma sample per four pixels,
 * with the coarser quantiser, so near an edge a pixel's chroma is the noisier measurement (chroma bleed and ringing);
 * weighting each component by its sample density (chroma 1/4) is the inverse-variance unmix. Inks of equal luma still
 * separate on chroma.
 */
const lossyDot = (p: readonly number[], q: readonly number[]) => {
  const y = (v: readonly number[]) => 0.299 * v[0]! + 0.587 * v[1]! + 0.114 * v[2]!;
  const cb = (v: readonly number[]) => -0.168736 * v[0]! - 0.331264 * v[1]! + 0.5 * v[2]!;
  const cr = (v: readonly number[]) => 0.5 * v[0]! - 0.418688 * v[1]! - 0.081312 * v[2]!;
  return y(p) * y(q) + (cb(p) * cb(q) + cr(p) * cr(q)) / 4 + p[3]! * q[3]!;
};

/** A border pixel further than this (RGBA) from the line between region and backdrop colours is not their mix. */
const MIX_RESIDUAL = 30;

function subpixelPoints(chain: Chain, edges: readonly Edge[], regions: Int32Array, W: number, H: number, X: Float32Array, colours: readonly number[][], window: number, backdrop: readonly number[], lossy: boolean): Point[] {
  const [la, lb] = chain.pair;
  const pixel = (y: number, x: number) => [0, 1, 2, 3].map((c) => X[(y * W + x) * 4 + c]!);
  // Fractions use the weighted product; the distance tests below compare RGB distances with RGB thresholds.
  const dot = rgbaDot, mixDot = lossy ? lossyDot : rgbaDot;
  const out: Point[] = [];
  // A side's window is the run of its region along the scan line, up to `window` px, but only half a run that ends at
  // another edge: the far half belongs to that edge's anti-aliasing.
  const reach = (from: number, step: number, size: number, at: (i: number) => number, region: number) => {
    let run = 0, i = from;
    while (i >= 0 && i < size && at(i) === region && run < 2 * window) { run += 1; i += step; }
    return i < 0 || i >= size ? Math.min(window, run) : Math.max(1, Math.min(window, Math.floor(run / 2)));
  };
  if (la < 0 || lb < 0) {
    const C = colours[lb < 0 ? la : lb]!, d = C.map((v, c) => v - backdrop[c]!), dd = dot(d, d);
    chain.es.forEach((index, k) => {
      const e = edges[index]!;
      // At an open chain's ends the border pixel lies on the crossing boundary's anti-aliasing, not on this edge's.
      const atEnd = !chain.closed && (k === 0 || k === chain.es.length - 1);
      const ax = e.a % (W + 1), ay = Math.floor(e.a / (W + 1)), bx = e.b % (W + 1), by = Math.floor(e.b / (W + 1));
      let mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (dd > 400 && !atEnd) {
        const outsideFirst = e.la < 0, inward = outsideFirst ? 1 : -1;
        const [py, px] = e.kind === "h" ? (outsideFirst ? [e.y, e.x] : [e.y - 1, e.x]) : (outsideFirst ? [e.y, e.x] : [e.y, e.x - 1]);
        const pv = pixel(py, px);
        const cover = (v: readonly number[]) => Math.min(1, Math.max(0, dot(v.map((value, c) => value - backdrop[c]!), d) / dd));
        const t = cover(pv);
        // The residual off the mix line, in the same product (on a lossy source chroma error counts a quarter).
        const off = pv.map((v, c) => backdrop[c]! + t * d[c]! - v), residual = Math.sqrt(mixDot(off, off));
        // On a lossy source the block transform spreads the region's full pixels into the border pixel, so its edge is
        // the area integral over the region's run inward (as between regions: run length - sum of t), not that pixel's t.
        let shift = 1 - t;
        if (lossy) {
          const region = la < 0 ? lb : la;
          let n = 0, sum = 0;
          for (let k = 0; k < window; k += 1) {
            const y = e.kind === "h" ? py + k * inward : py, x = e.kind === "h" ? px : px + k * inward;
            if (y < 0 || y >= H || x < 0 || x >= W || regions[y * W + x] !== region) break;
            n += 1; sum += cover(pixel(y, x));
          }
          shift = Math.min(1, Math.max(0, n - sum));
        }
        // On a lossy source a shift is only real where the colour it implies exceeds the denoiser's noise range.
        if (residual < MIX_RESIDUAL && (!lossy || shift * Math.sqrt(dd) >= RANGE_SIGMA)) { if (e.kind === "h") my += shift * inward; else mx += shift * inward; }
      }
      out.push([mx, my]);
    });
    return out;
  }
  const vs = chain.vs, n = chain.es.length, Vx = (k: number) => vs[k]! % (W + 1), Vy = (k: number) => Math.floor(vs[k]! / (W + 1));
  chain.es.forEach((index, k) => {
    const e = edges[index]!;
    let dx: number, dy: number;
    if (chain.closed) { const p = ((k + 4) % n), q = (((k - 3) % n) + n) % n; dx = Vx(p) - Vx(q); dy = Vy(p) - Vy(q); }
    else { const i0 = Math.max(0, k - 3), i1 = Math.min(vs.length - 1, k + 4); dx = Vx(i1) - Vx(i0); dy = Vy(i1) - Vy(i0); }
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (e.kind === "h" && ax < 0.75 * ay) return;
    if (e.kind === "v" && ay < 0.75 * ax) return;
    const Ca = colours[e.la]!, Cb = colours[e.lb]!, dv = Cb.map((v, c) => v - Ca[c]!), dd = mixDot(dv, dv);
    if (dd < 1e-3) return;
    const t = (y: number, x: number) => Math.min(1, Math.max(0, mixDot(pixel(y, x).map((v, c) => v - Ca[c]!), dv) / dd));
    if (e.kind === "v") {
      const y = e.y, x = e.x; let l = x - 1, r = x;
      const wl = reach(x - 1, -1, W, (i) => regions[y * W + i]!, e.la), wr = reach(x, 1, W, (i) => regions[y * W + i]!, e.lb);
      while (l - 1 >= 0 && x - 1 - (l - 1) < wl && regions[y * W + l - 1] === e.la) l -= 1;
      while (r + 1 < W && r + 1 - x < wr && regions[y * W + r + 1] === e.lb) r += 1;
      let sum = 0; for (let i = l; i <= r; i += 1) sum += t(y, i);
      out.push([Math.min(Math.max(r + 1 - sum, x - 1), x + 1), y + 0.5]);
    } else {
      const y = e.y, x = e.x; let l = y - 1, r = y;
      const wl = reach(y - 1, -1, H, (i) => regions[i * W + x]!, e.la), wr = reach(y, 1, H, (i) => regions[i * W + x]!, e.lb);
      while (l - 1 >= 0 && y - 1 - (l - 1) < wl && regions[(l - 1) * W + x] === e.la) l -= 1;
      while (r + 1 < H && r + 1 - y < wr && regions[(r + 1) * W + x] === e.lb) r += 1;
      let sum = 0; for (let i = l; i <= r; i += 1) sum += t(i, x);
      out.push([x + 0.5, Math.min(Math.max(r + 1 - sum, y - 1), y + 1)]);
    }
  });
  return out;
}

// ---------------------------------------------------------------- curve fitting (Schneider, max + rms error)
const sub = (p: Point, q: Point): Point => [p[0] - q[0], p[1] - q[1]];
const add = (p: Point, q: Point): Point => [p[0] + q[0], p[1] + q[1]];
const mul = (p: Point, k: number): Point => [p[0] * k, p[1] * k];
const norm = (p: Point) => Math.hypot(p[0], p[1]);
const unit = (p: Point): Point => { const n = norm(p); return n > 1e-9 ? [p[0] / n, p[1] / n] : p; };
const bez = (b: Cubic, t: number): Point => { const m = 1 - t; return [0, 1].map((c) => m * m * m * b[0][c]! + 3 * m * m * t * b[1][c]! + 3 * m * t * t * b[2][c]! + t * t * t * b[3][c]!) as Point; };
const bezd = (b: Cubic, t: number): Point => { const m = 1 - t; return [0, 1].map((c) => 3 * m * m * (b[1][c]! - b[0][c]!) + 6 * m * t * (b[2][c]! - b[1][c]!) + 3 * t * t * (b[3][c]! - b[2][c]!)) as Point; };
const bezdd = (b: Cubic, t: number): Point => [0, 1].map((c) => 6 * (1 - t) * (b[2][c]! - 2 * b[1][c]! + b[0][c]!) + 6 * t * (b[3][c]! - 2 * b[2][c]! + b[1][c]!)) as Point;
const line = (p: Point, q: Point): Cubic => [p, add(p, mul(sub(q, p), 1 / 3)), add(p, mul(sub(q, p), 2 / 3)), q];

function chordU(P: readonly Point[]): number[] {
  const d = [0];
  for (let i = 1; i < P.length; i += 1) d.push(d[i - 1]! + norm(sub(P[i]!, P[i - 1]!)));
  const total = d[d.length - 1]!;
  return total > 0 ? d.map((v) => v / total) : P.map((_, i) => i / Math.max(1, P.length - 1));
}

function genBez(P: readonly Point[], u: readonly number[], t1: Point, t2: Point): Cubic {
  const p0 = P[0]!, p3 = P[P.length - 1]!;
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  u.forEach((t, i) => {
    const a1 = mul(t1, 3 * (1 - t) ** 2 * t), a2 = mul(t2, 3 * (1 - t) * t * t);
    c00 += a1[0] * a1[0] + a1[1] * a1[1]; c01 += a1[0] * a2[0] + a1[1] * a2[1]; c11 += a2[0] * a2[0] + a2[1] * a2[1];
    const tmp = sub(P[i]!, bez([p0, p0, p3, p3], t));
    x0 += a1[0] * tmp[0] + a1[1] * tmp[1]; x1 += a2[0] * tmp[0] + a2[1] * tmp[1];
  });
  const det = c00 * c11 - c01 * c01, seg = norm(sub(p3, p0));
  let a1 = seg / 3, a2 = seg / 3;
  if (Math.abs(det) > 1e-12) { a1 = (x0 * c11 - x1 * c01) / det; a2 = (c00 * x1 - c01 * x0) / det; }
  if (a1 < 1e-6 * seg || a2 < 1e-6 * seg || a1 > 2 * seg || a2 > 2 * seg) { a1 = seg / 3; a2 = seg / 3; }
  return [p0, add(p0, mul(t1, a1)), add(p3, mul(t2, a2)), p3];
}

function reparam(b: Cubic, P: readonly Point[], u: readonly number[]): number[] {
  return u.map((t, i) => {
    const d = sub(bez(b, t), P[i]!), d1 = bezd(b, t), d2 = bezdd(b, t);
    const num = d[0] * d1[0] + d[1] * d1[1], den = d1[0] * d1[0] + d1[1] * d1[1] + d[0] * d2[0] + d[1] * d2[1];
    return Math.min(1, Math.max(0, t - (Math.abs(den) > 1e-9 ? num / den : 0)));
  });
}

/** The fit error in tolerance terms: the larger of max error / KMAX and rms / KRMS, and the worst sample. */
function fitError(b: Cubic, P: readonly Point[], u: readonly number[]): [number, number] {
  let worst = 0, at = 0, squares = 0;
  u.forEach((t, i) => { const e = norm(sub(bez(b, t), P[i]!)); squares += e * e; if (e > worst) { worst = e; at = i; } });
  return [Math.max(worst / KMAX, Math.sqrt(squares / P.length) / KRMS), at];
}

function endTangent(P: readonly Point[], forward: boolean, reach = 2): Point {
  if (forward) { for (let j = 1; j < P.length; j += 1) if (norm(sub(P[j]!, P[0]!)) >= reach || j === P.length - 1) return unit(sub(P[j]!, P[0]!)); }
  else { for (let j = P.length - 2; j >= 0; j -= 1) if (norm(sub(P[j]!, P[P.length - 1]!)) >= reach || j === 0) return unit(sub(P[j]!, P[P.length - 1]!)); }
  return [0, 0];
}

function straightWithin(P: readonly Point[], limit: number): boolean {
  const ch = sub(P[P.length - 1]!, P[0]!), L = norm(ch);
  if (L < 1e-9) return false;
  const n: Point = [-ch[1] / L, ch[0] / L];
  return P.every((p) => Math.abs((p[0] - P[0]![0]) * n[0] + (p[1] - P[0]![1]) * n[1]) <= limit);
}

function fitCubic(P: readonly Point[], t1: Point, t2: Point, tol: number, depth = 0): Cubic[] {
  if (P.length > 3 && norm(sub(P[P.length - 1]!, P[0]!)) < 1e-6) {
    let m = 0, far = -1; P.forEach((p, i) => { const d = norm(sub(p, P[0]!)); if (d > far) { far = d; m = i; } });
    m = Math.min(Math.max(m, 1), P.length - 2);
    const tm = unit(sub(P[Math.min(m + 1, P.length - 1)]!, P[m - 1]!));
    return [...fitCubic(P.slice(0, m + 1), t1, mul(tm, -1), tol, depth + 1), ...fitCubic(P.slice(m), tm, t2, tol, depth + 1)];
  }
  if (P.length === 2 || norm(sub(P[P.length - 1]!, P[0]!)) < 1e-6) {
    const d = norm(sub(P[P.length - 1]!, P[0]!)) / 3;
    return [[P[0]!, add(P[0]!, mul(t1, d)), add(P[P.length - 1]!, mul(t2, d)), P[P.length - 1]!]];
  }
  if (straightWithin(P, tol)) return [line(P[0]!, P[P.length - 1]!)];
  let u = chordU(P), b = genBez(P, u, t1, t2), [e, i] = fitError(b, P, u);
  if (e <= tol) return [b];
  if (e <= tol * 4) {
    for (let k = 0; k < 8; k += 1) { u = reparam(b, P, u); b = genBez(P, u, t1, t2); [e, i] = fitError(b, P, u); if (e <= tol) return [b]; }
  }
  if (P.length < 4 || depth > 40) return [b];
  i = Math.min(Math.max(i, 1), P.length - 2);
  const tc = unit(sub(P[Math.max(0, i - 2)]!, P[Math.min(P.length - 1, i + 2)]!));
  return [...fitCubic(P.slice(0, i + 1), t1, tc, tol, depth + 1), ...fitCubic(P.slice(i), mul(tc, -1), t2, tol, depth + 1)];
}

function tryFit(S: readonly Point[], t1: Point, t2: Point, tol: number): Cubic | null {
  if (norm(sub(S[S.length - 1]!, S[0]!)) < 1e-9) return null;
  if (S.length <= 2 || straightWithin(S, tol * KMAX * 0.5)) return line(S[0]!, S[S.length - 1]!);
  let u = chordU(S), b = genBez(S, u, t1, t2), [e] = fitError(b, S, u);
  for (let k = 0; k < 10; k += 1) { if (e <= tol) return b; u = reparam(b, S, u); b = genBez(S, u, t1, t2); [e] = fitError(b, S, u); }
  return e <= tol ? b : null;
}

/** Schneider split of one smooth span, then neighbours merged greedily wherever one cubic fits both. */
function fitSpan(S: readonly Point[], tol: number): Cubic[] {
  const cubics = fitCubic(S, endTangent(S, true), endTangent(S, false), tol);
  if (cubics.length <= 1) return cubics;
  const index = [0];
  for (const b of cubics.slice(0, -1)) {
    let j = 0, best = Infinity; S.forEach((p, k) => { const d = norm(sub(p, b[3])); if (d < best) { best = d; j = k; } });
    index.push(Math.max(j, index[index.length - 1]! + 1));
  }
  index.push(S.length - 1);
  type Seg = { i0: number; i1: number; t1: Point; t2: Point; b: Cubic };
  const segs: Seg[] = cubics.map((b, k) => ({ i0: index[k]!, i1: index[k + 1]!, t1: norm(sub(b[1], b[0])) > 1e-9 ? unit(sub(b[1], b[0])) : endTangent(S, true), t2: norm(sub(b[2], b[3])) > 1e-9 ? unit(sub(b[2], b[3])) : endTangent(S, false), b }));
  let changed = true;
  while (changed && segs.length > 1) {
    changed = false;
    for (let k = 0; k < segs.length - 1; k += 1) {
      const part = S.slice(segs[k]!.i0, segs[k + 1]!.i1 + 1);
      const t1 = k > 0 ? segs[k]!.t1 : endTangent(part, true), t2 = k + 1 < segs.length - 1 ? segs[k + 1]!.t2 : endTangent(part, false);
      const b = tryFit(part, t1, t2, tol);
      if (b === null) continue;
      segs.splice(k, 2, { i0: segs[k]!.i0, i1: segs[k + 1]!.i1, t1, t2, b }); changed = true; break;
    }
  }
  return segs.map((seg) => seg.b);
}

function findCorners(P: readonly Point[], closed: boolean): number[] {
  const n = P.length;
  if (n < 5) return [];
  const s = [0]; for (let i = 1; i < n; i += 1) s.push(s[i - 1]! + norm(sub(P[i]!, P[i - 1]!)));
  const angle = new Array<number>(n).fill(0), R = 2;
  for (let i = 0; i < n; i += 1) {
    let j: number, k: number;
    if (closed) {
      j = i; let acc = 0;
      while (acc < R) { const j2 = (j - 1 + n) % n; acc += norm(sub(P[j]!, P[j2]!)); j = j2; if (j === i) break; }
      k = i; acc = 0;
      while (acc < R) { const k2 = (k + 1) % n; acc += norm(sub(P[k2]!, P[k]!)); k = k2; if (k === i) break; }
    } else {
      if (i === 0 || i === n - 1) continue;
      j = 0; while (j + 1 < n && s[j + 1]! <= s[i]! - R) j += 1;
      k = n - 1; for (let q = i; q < n; q += 1) if (s[q]! >= s[i]! + R) { k = q; break; }
      if (j === i || k === i) continue;
    }
    const a = sub(P[i]!, P[j]!), b = sub(P[k]!, P[i]!), na = norm(a), nb = norm(b);
    if (na < 1e-6 || nb < 1e-6) continue;
    angle[i] = (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / na / nb))) * 180) / Math.PI;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (angle[i]! < CORNER_DEGREES) continue;
    let peak = true;
    for (let k = i - 2; k <= i + 2; k += 1) { const v = closed ? angle[((k % n) + n) % n]! : (k >= 0 && k < n ? angle[k]! : 0); if (v > angle[i]!) peak = false; }
    if (peak && (out.length === 0 || i - out[out.length - 1]! > 2)) out.push(i);
  }
  return out;
}

/** The corner's bevelled anti-aliasing points replaced by the intersection of the lines fitted on both sides. */
function sharpenCorner(P: readonly Point[], c: number): [Point[], number] {
  const n = P.length;
  const fitLine = (ix: number[]): [Point, Point] => {
    const m: Point = [ix.reduce((a, i) => a + P[i]![0], 0) / ix.length, ix.reduce((a, i) => a + P[i]![1], 0) / ix.length];
    let xx = 0, xy = 0, yy = 0; for (const i of ix) { const d = sub(P[i]!, m); xx += d[0] * d[0]; xy += d[0] * d[1]; yy += d[1] * d[1]; }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy); return [m, [Math.cos(angle), Math.sin(angle)]];
  };
  // Lines are fitted on the points 1.2-5 px from the corner, clear of its anti-aliased bevel. The detected sample can
  // sit a point before the bevel, so the band is measured again from the first intersection, the better corner.
  const intersect = (from: Point): Point | null => {
    const s = P.map((p) => norm(sub(p, from)));
    const L: number[] = [], R: number[] = [];
    for (let i = Math.max(0, c - 8); i < c; i += 1) if (s[i]! >= 1.2 && s[i]! <= 5) L.push(i);
    for (let i = c + 1; i < Math.min(n, c + 9); i += 1) if (s[i]! >= 1.2 && s[i]! <= 5) R.push(i);
    if (L.length < 2 || R.length < 2) return null;
    const [m1, d1] = fitLine(L), [m2, d2] = fitLine(R);
    const det = d1[0] * -d2[1] - -d2[0] * d1[1];
    if (Math.abs(det) < 0.2) return null;
    const r = sub(m2, m1), t = (r[0] * -d2[1] - -d2[0] * r[1]) / det, X = add(m1, mul(d1, t));
    return norm(sub(X, P[c]!)) > 1.5 ? null : X;
  };
  const first = intersect(P[c]!);
  if (first === null) return [P.slice(), c];
  const X = intersect(first) ?? first;
  // The bevel's points (within 1 px of the corner, and of the sample it replaces) go.
  const s = P.map((p) => Math.min(norm(sub(p, P[c]!)), norm(sub(p, X))));
  const keep = [...Array(n).keys()].filter((i) => i === c || s[i]! >= 1 || i === 0 || i === n - 1);
  const out = keep.map((i) => (i === c ? X : P[i]!));
  return [out, keep.indexOf(c)];
}

function fitChain(input: readonly Point[], closed: boolean, tol: number): Cubic[] {
  let P = input.filter((p, i) => i === 0 || norm(sub(p, input[i - 1]!)) > 1e-4);
  if (closed && P.length > 1 && norm(sub(P[0]!, P[P.length - 1]!)) < 1e-4) P = P.slice(0, -1);
  if (P.length < 2) return [];
  if (!closed && P.length <= 3) return P.slice(0, -1).map((p, i) => line(p, P[i + 1]!));
  let cs = findCorners(P, closed);
  for (let k = 0; k < cs.length; k += 1) {
    const [next, nc] = sharpenCorner(P, cs[k]!);
    if (next.length !== P.length || nc !== cs[k]) {
      const shift = nc - cs[k]!; P = next; cs[k] = nc;
      cs = [...new Set([...cs.slice(0, k + 1), ...cs.slice(k + 1).map((c) => c + shift)].map((c) => Math.min(Math.max(c, 0), P.length - 1)))].sort((l, r) => l - r);
    }
  }
  let bounds: number[];
  if (closed) {
    if (cs.length > 0) {
      const st = cs[0]!; P = [...P.slice(st), ...P.slice(0, st + 1)];
      cs = [...cs.map((c) => (((c - st) % (P.length - 1)) + (P.length - 1)) % (P.length - 1)), P.length - 1];
      if (cs.length === 2) { let m = 0, far = -1; P.forEach((p, i) => { const d = norm(sub(p, P[0]!)); if (d > far) { far = d; m = i; } }); cs.push(m); }
      bounds = [...new Set([...cs, 0])].sort((l, r) => l - r);
    } else {
      let m = 0, far = -1; P.forEach((p, i) => { const d = norm(sub(p, P[0]!)); if (d > far) { far = d; m = i; } });
      P = [...P, P[0]!]; const N = P.length;
      const t0 = unit(sub(P[1]!, P[N - 2]!)), tm = m > 0 && m < N - 1 ? unit(sub(P[m + 1]!, P[m - 1]!)) : t0;
      return [...fitCubic(P.slice(0, m + 1), t0, mul(tm, -1), tol), ...fitCubic(P.slice(m), tm, mul(t0, -1), tol)];
    }
  } else bounds = [...new Set([...cs, 0, P.length - 1])].sort((l, r) => l - r);
  const out: Cubic[] = [];
  for (let k = 0; k + 1 < bounds.length; k += 1) {
    const S = P.slice(bounds[k]!, bounds[k + 1]! + 1);
    if (S.length >= 2) out.push(...fitSpan(S, tol));
  }
  return out;
}

// ---------------------------------------------------------------- assembly
const fmt = (v: number) => { const s = v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); return s === "-0" || s === "" ? "0" : s; };
const reversed = (cubics: readonly Cubic[]): Cubic[] => cubics.slice().reverse().map((b) => [b[3], b[2], b[1], b[0]]);
const pathOf = (input: readonly Cubic[]) => {
  const cubics = joinLines(input);
  return "M" + fmt(cubics[0]![0][0]) + "," + fmt(cubics[0]![0][1]) + cubics.map((b) => "C" + b.slice(1).map((p) => fmt(p[0]) + "," + fmt(p[1])).join(" ")).join("") + "Z";
};

/**
 * Straight segments that meet end to end on one line (within the fit tolerance) become one segment: chains split at
 * junctions the union has dissolved, and a closed loop's first and last segments, need no anchor between them.
 */
function joinLines(cubics: readonly Cubic[]): Cubic[] {
  const straight = (b: Cubic) => straightWithin(b, EDGE_TOLERANCE);
  const joinable = (a: Cubic, b: Cubic) => straight(a) && straight(b) && straightWithin([a[0], a[1], a[2], a[3], b[1], b[2], b[3]], EDGE_TOLERANCE);
  const out: Cubic[] = [];
  for (const b of cubics) {
    const last = out[out.length - 1];
    if (last !== undefined && joinable(last, b)) out[out.length - 1] = line(last[0], b[3]);
    else out.push(b);
  }
  while (out.length > 2 && joinable(out[out.length - 1]!, out[0]!)) out[0] = line(out.pop()![0], out[0]![3]);
  return out;
}

/** Closed loops from the boundary chains of one union: closed chains as they are, open ones joined end to end. */
function loops(ids: readonly number[], chains: readonly Chain[], curves: readonly Cubic[][], W: number): string {
  void W;
  const d: string[] = [], open: number[] = [];
  for (const id of ids) {
    if (chains[id]!.closed) { if (curves[id]!.length > 0) d.push(pathOf(curves[id]!)); }
    else open.push(id);
  }
  const at = new Map<number, [number, 0 | 1][]>();
  for (const id of open) {
    const vs = chains[id]!.vs;
    (at.get(vs[0]!) ?? at.set(vs[0]!, []).get(vs[0]!)!).push([id, 0]);
    (at.get(vs[vs.length - 1]!) ?? at.set(vs[vs.length - 1]!, []).get(vs[vs.length - 1]!)!).push([id, 1]);
  }
  const used = new Set<number>();
  for (const id of open) {
    if (used.has(id)) continue;
    const seq: Cubic[] = []; let cur = id, forward = true; const start = chains[id]!.vs[0]!;
    for (;;) {
      used.add(cur); seq.push(...(forward ? curves[cur]! : reversed(curves[cur]!)));
      const vs: readonly number[] = chains[cur]!.vs, v: number = forward ? vs[vs.length - 1]! : vs[0]!;
      if (v === start) break;
      const next: [number, 0 | 1] | undefined = (at.get(v) ?? []).find(([c]) => !used.has(c));
      if (next === undefined) break;
      cur = next[0]; forward = next[1] === 0;
    }
    if (seq.length > 0) d.push(pathOf(seq));
  }
  return d.join("");
}

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
  /** Per ink, the ink a near-identical cut-out fringe folds into (itself when it stays): see plateLabels. */
  readonly unify?: readonly number[];
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
export function edgeFirstSvg(labelMap: EdgeLabels, source: Uint8Array, lossy: boolean, keep: ReadonlySet<number> = new Set()): string {
  const { width: W, height: H } = labelMap;
  const { regions, count, inkOf } = connectedRegions(labelMap, source, lossy, keep);
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
  // Near the backdrop: within NEAR_FILL, or on a lossy source within the denoiser's noise range.
  const nearBy = lossy ? RANGE_SIGMA : NEAR_FILL;
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
  // A backdrop region's colour is the border colour unless the region itself shows another beyond the noise range
  // (a frame round the page: the border colour is the frame's, what the shapes sit on is the region's own, its median).
  const own = hasAlpha ? new Map<number, number[]>() : regionMedians(regions, X, (region) => inkOf[region]! < 0 && !underRegions.has(region));
  const colours: number[][] = [];
  for (let region = 0; region < count; region += 1) {
    const ink = inkOf[region]!, seen = own.get(region);
    const backdropHere = seen !== undefined && seen.some((v, c) => Math.abs(v - backdrop[c]!) > nearBy) ? seen : backdrop;
    colours.push(underRegions.has(region) ? [...hexRgb(labelMap.inks[underlay]!), 255] : ink < 0 ? backdropHere : [...hexRgb(labelMap.inks[ink]!), 255]);
  }
  const { edges, chains } = crackGraph(regions, W, H);
  const window = lossy ? WINDOW_LOSSY : WINDOW_CLEAN;
  const corner = (v: number): Point => [v % (W + 1), Math.floor(v / (W + 1))];
  // The area integral counts the window's far pixels as pure inks; the coverage they still carry (t on the near side's
  // end, 1 - t on the far side's) is unaccounted, so an edge point is uncertain by that much. Inside a gradient (a
  // posterised band's edge) every point carries it, and a fit closer than that fits the stair noise of the bands: the
  // chain's tolerance grows to its median uncertainty (as the largest error, KMAX tolerances). A real edge has pure
  // window ends and keeps the edge tolerance. A window cut short by its region's run (a thin feature) ends on the
  // feature's own anti-aliasing, which says nothing of a gradient: it is not counted, and a chain most of whose
  // windows are cut short is a thin feature's, not a band's.
  const uncertainty: number[] = [];
  const allPoints = chains.map((chain) => {
    const impurity: number[] = [];
    const points = subpixelPoints(chain, edges, regions, W, H, X, colours, window, backdrop, lossy, impurity);
    const full = impurity.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    uncertainty.push(2 * full.length > impurity.length ? full[full.length >> 1]! : 0);
    return points;
  });
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
  const edgeTolerance = lossy ? LOSSY_TOLERANCE : EDGE_TOLERANCE;
  // Square strip ends (capCorners) read the samples as exact, which they are on a clean render: there each pixel
  // that mixes the boundary's two colours lies between them, to within the half-step rounding of each 8-bit
  // channel. Ringing beside a JPEG-coded edge overshoots one of them (at 256 px a q60 source can pass the noise
  // test, its flat areas coding almost exactly), and inside a region the coding error leaves a pixel off its colour:
  // a mix pixel past either colour, an inner pixel off its own, or a pixel off the two colours' line with no third
  // region beside it, within the window round the end, keeps the bevel.
  // Lossy sources never take the square ends.
  const square = (chain: Chain): ((p: Point) => boolean) | null => {
    if (lossy) return null;
    const A = chain.pair[0]! < 0 ? backdrop : colours[chain.pair[0]!]!, B = chain.pair[1]! < 0 ? backdrop : colours[chain.pair[1]!]!;
    const dv = B.map((v, c) => v - A[c]!), dd = rgbaDot(dv, dv), rounding = dv.reduce((sum, v) => sum + 0.5 * Math.abs(v), 0) / dd;
    if (dd < 1e-3) return () => true;
    return ([px, py]) => {
      for (let y = Math.max(0, Math.floor(py) - WINDOW_CLEAN); y <= Math.min(H - 1, Math.floor(py) + WINDOW_CLEAN); y += 1)
        for (let x = Math.max(0, Math.floor(px) - WINDOW_CLEAN); x <= Math.min(W - 1, Math.floor(px) + WINDOW_CLEAN); x += 1) {
          const d = [0, 1, 2, 3].map((c) => X[(y * W + x) * 4 + c]! - A[c]!), t = rgbaDot(d, dv) / dd;
          const off = d.map((v, c) => v - t * dv[c]!);
          if (rgbaDot(off, off) <= 1 && (t < -rounding || t > 1 + rounding)) return false;
          // A pixel inside one of the two regions (its four neighbours in it too) is that colour, to the same rounding;
          // one of either region with only the two round it is a mix of those two alone, on the line between them.
          const at = y * W + x, here = regions[at]!;
          if ((here === chain.pair[0] || here === chain.pair[1]) && rgbaDot(off, off) > 1 && x > 0 && y > 0 && x < W - 1 && y < H - 1
            && [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1].every((k) => regions[at + k] === chain.pair[0] || regions[at + k] === chain.pair[1])) return false;
          if ((here === chain.pair[0] || here === chain.pair[1]) && [at - 1, at + 1, at - W, at + W].every((n) => n >= 0 && n < W * H && regions[n] === here)) {
            const C = here === chain.pair[0] ? A : B, e = [0, 1, 2, 3].map((c) => X[at * 4 + c]! - C[c]!);
            if (rgbaDot(e, e) > 1) return false;
          }
        }
      return true;
    };
  };
  const end = (v: number): Point => moved.get(v) ?? corner(v);
  const curves = chains.map((chain, index) => {
    const tolerance = Math.max(edgeTolerance, uncertainty[index]! / KMAX);
    let points = allPoints[index]!;
    if (chain.closed) {
      const loop = points.length >= 3 ? points : chain.vs.slice(0, -1).map(corner);
      return fitChain(loop, true, tolerance, square(chain));
    }
    if (chain.pair[0] < 0 || chain.pair[1] < 0) {
      const first = tangent.has(chain.vs[0]!) ? 1 : 0, last = tangent.has(chain.vs[chain.vs.length - 1]!) ? 1 : 0;
      if (points.length > first + last) points = points.slice(first, points.length - last);
    }
    const v0 = end(chain.vs[0]!), v1 = end(chain.vs[chain.vs.length - 1]!);
    let inner = points.filter((p) => Math.hypot(p[0] - v0[0], p[1] - v0[1]) > 0.5 && Math.hypot(p[0] - v1[0], p[1] - v1[1]) > 0.5);
    if (inner.length === 0 && chain.vs.length > 2) inner = chain.vs.slice(1, -1).map(corner);
    return fitChain([v0, ...inner, v1], false, tolerance, square(chain));
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
  // A region is drawn as the union of itself and its later (smaller) neighbours, so it runs on under each of them to
  // their far edges. Where such a member's edge is the background's (the backdrop, the underlay, or clear), both paths
  // cross that edge's pixels with the same coverage a, and a renderer composites them one after the other: the lower
  // colour shows through by a(1 - a), a tinted, too opaque fringe round the member against the page. The lower path
  // there runs instead inside the member, clear of the edge's pixels: every point of a pixel an edge crosses lies within
  // SQRT2 (its diagonal) of the edge, so moved by SQRT2 it no longer reaches them. It must stay as clear of the
  // member's other edge, the one it covers (or the page shows through there instead): the move is the member's width
  // there less SQRT2, at most SQRT2, nothing where the member is narrower than that. The edge's own pixels are read as
  // mixes of the member's and the background's colours, as they are on a clean render: each pixel either side of the
  // chain lies on the line between the two colours, to the half-step rounding of each channel (as capCorners reads its
  // window), unless a third region is beside it. A source whose edge pixels are otherwise keeps the shared edge.
  const mixOk = new Map<number, boolean>();
  const exactMixes = (index: number): boolean => {
    const known = mixOk.get(index);
    if (known !== undefined) return known;
    const chain = chains[index]!, [p, q] = chain.pair, A = colours[p]!, B = colours[q]!;
    const dv = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!, B[3]! - A[3]!], dd = rgbaDot(dv, dv);
    const rounding = (Math.abs(dv[0]!) + Math.abs(dv[1]!) + Math.abs(dv[2]!) + Math.abs(dv[3]!)) * 0.5 / dd;
    let ok = dd >= 1e-3, read = 0;
    for (let k = 0; ok && k < chain.es.length; k += 1) {
      const edge = edges[chain.es[k]!]!;
      for (const at of edge.kind === "h" ? [(edge.y - 1) * W + edge.x, edge.y * W + edge.x] : [edge.y * W + edge.x - 1, edge.y * W + edge.x]) {
        const x = at % W, y = (at - x) / W;
        let third = false;
        for (let ny = Math.max(0, y - 1); !third && ny <= Math.min(H - 1, y + 1); ny += 1)
          for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx += 1) { const r = regions[ny * W + nx]!; if (r !== p && r !== q) { third = true; break; } }
        if (third) continue;
        read += 1;
        const d0 = X[at * 4]! - A[0]!, d1 = X[at * 4 + 1]! - A[1]!, d2 = X[at * 4 + 2]! - A[2]!, d3 = X[at * 4 + 3]! - A[3]!;
        const t = (d0 * dv[0]! + d1 * dv[1]! + d2 * dv[2]! + d3 * dv[3]!) / dd;
        const o0 = d0 - t * dv[0]!, o1 = d1 - t * dv[1]!, o2 = d2 - t * dv[2]!, o3 = d3 - t * dv[3]!;
        if (o0 * o0 + o1 * o1 + o2 * o2 + o3 * o3 > 1 || t < -rounding || t > 1 + rounding) { ok = false; break; }
      }
    }
    // A premise is read off at least two pixels (as S1's windows), not taken for granted where every pixel has a third region.
    ok = ok && read >= 2;
    mixOk.set(index, ok);
    return ok;
  };
  const span = (p: Point, q: Point) => Math.sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]));
  const steps = (cb: Cubic) => Math.max(2, Math.ceil((span(cb[0], cb[1]) + span(cb[1], cb[2]) + span(cb[2], cb[3])) / 0.5));
  // The chain's cubics with each vertex (and its two handles) moved into the member along the vertex's mean normal, by
  // the least clearance over the samples (every half pixel) of the cubics either side; a chain's open ends stay on their
  // junctions. Null when nothing moves. The member's side is the one whose pixels lie a pixel off the curve.
  // The same chain under the same member edges (another lower region whose union holds the same neighbours) moves alike.
  // The chains that can move: on a clean source, between a drawn region and one drawn as nothing (the canvas border's
  // outside, -1, is clipped and has no anti-aliasing to leak).
  const pageEdge = new Uint8Array(chains.length);
  let pageEdges = 0;
  if (!lossy) chains.forEach((chain, index) => {
    const [a, b] = chain.pair;
    if (a >= 0 && b >= 0 && (inkOf[a]! < 0) !== (inkOf[b]! < 0)) { pageEdge[index] = 1; pageEdges += 1; }
  });
  const hiddenMemo = new Map<number, [number[], Cubic[] | null][]>();
  const grids = new Map<string, Map<number, Point[]>>();
  const hidden = (index: number, member: number, union: ReadonlySet<number>): Cubic[] | null => {
    const covered: number[] = [];
    for (const k of byRegion.get(member) ?? []) { const [p, q] = chains[k]!.pair, other = p === member ? q : p; if (other !== member && union.has(other)) covered.push(k); }
    const seen = hiddenMemo.get(index) ?? hiddenMemo.set(index, []).get(index)!;
    for (const [list, result] of seen) if (list.length === covered.length && list.every((k, i) => k === covered[i])) return result;
    const result = hiddenOf(index, member, covered);
    seen.push([covered, result]);
    return result;
  };
  const hiddenOf = (index: number, member: number, covered: readonly number[]): Cubic[] | null => {
    const reach = 2 * Math.SQRT2, gridKey = member + ":" + covered.join(",");
    let grid = grids.get(gridKey);
    if (grid === undefined) {
      grid = new Map<number, Point[]>(); grids.set(gridKey, grid);
      for (const k of covered) for (const cb of curves[k]!) {
        const n = steps(cb);
        for (let j = 0; j <= n; j += 1) { const pt: Point = [bezAt(cb, j / n, 0), bezAt(cb, j / n, 1)], key = Math.floor(pt[1] / reach) * 4096 + Math.floor(pt[0] / reach); (grid.get(key) ?? grid.set(key, []).get(key)!).push(pt); }
      }
    }
    if (grid.size === 0) return null;
    const cs = curves[index]!, closed = chains[index]!.closed, clear: number[] = [];
    let vote = 0, any = false;
    for (const cb of cs) {
      const n = steps(cb);
      let least2 = reach * reach;
      for (let k = 0; k <= n && least2 > 2; k += 1) {
        const t = k / n, px = bezAt(cb, t, 0), py = bezAt(cb, t, 1), cx = Math.floor(px / reach), cy = Math.floor(py / reach);
        for (let gy = cy - 1; gy <= cy + 1; gy += 1) for (let gx = cx - 1; gx <= cx + 1; gx += 1)
          for (const r of grid.get(gy * 4096 + gx) ?? []) { const dx = r[0] - px, dy = r[1] - py, d2 = dx * dx + dy * dy; if (d2 < least2) least2 = d2; }
        const tx = bezdAt(cb, t, 0), ty = bezdAt(cb, t, 1), tl = Math.hypot(tx, ty);
        if (tl < 1e-9) continue;
        for (const sg of [1, -1]) {
          const x = Math.floor(px - sg * ty / tl), y = Math.floor(py + sg * tx / tl);
          if (x >= 0 && y >= 0 && x < W && y < H && regions[y * W + x] === member) vote += sg;
        }
      }
      const e = Math.min(Math.SQRT2, Math.max(0, Math.sqrt(least2) - Math.SQRT2));
      clear.push(e); if (e > 0) any = true;
    }
    if (!any || vote === 0) return null;
    const side = Math.sign(vote), N = cs.length, move: Point[] = [];
    const tangentAt = (cb: Cubic, end: 0 | 1): Point => unit(end === 0 ? sub(norm(sub(cb[1], cb[0])) > 1e-9 ? cb[1] : cb[2], cb[0]) : sub(cb[3], norm(sub(cb[3], cb[2])) > 1e-9 ? cb[2] : cb[1]));
    for (let k = 0; k <= N; k += 1) {
      const before = k > 0 ? k - 1 : closed ? N - 1 : -1, after = k < N ? k : closed ? 0 : -1;
      if (before < 0 || after < 0) { move.push([0, 0]); continue; }
      const tg = unit(add(tangentAt(cs[before]!, 1), tangentAt(cs[after]!, 0))), e = Math.min(clear[before]!, clear[after]!) * side;
      move.push([-tg[1] * e, tg[0] * e]);
    }
    return cs.map((cb, k): Cubic => [add(cb[0], move[k]!), add(cb[1], move[k]!), add(cb[2], move[k + 1]!), add(cb[3], move[k + 1]!)]);
  };
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
    let saved: [number, Cubic[]][] | null = null;
    if (pageEdges > 0) {
      for (const index of boundary) {
        if (pageEdge[index] === 0) continue;
        const [a, b] = chains[index]!.pair, member = union.has(a) ? a : b;
        if (member === region || inkOf[member]! < 0) continue;
        const cs = hidden(index, member, union);
        if (cs !== null && exactMixes(index)) { (saved ??= []).push([index, curves[index]!]); curves[index] = cs; }
      }
    }
    const d = loops([...boundary].sort((l, r) => l - r), chains, curves, W);
    if (saved !== null) for (const [index, cs] of saved) curves[index] = cs;
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
 * boundary with, as VTracer folds such a patch into its surroundings. Speck-sized pieces of one ink that touch at
 * corners are one patch, though: the steps of a 1 px diagonal line are a pixel each, but together they are the line.
 * A patch longer than the clean integration span (an edge's window on both sides, 2 WINDOW_CLEAN) is a line that has
 * edge points of its own away from its ends, and its pieces stay; a shorter cluster is speckle.
 */
function connectedRegions(labelMap: EdgeLabels, source: Uint8Array, lossy: boolean, keep: ReadonlySet<number> = new Set()): { regions: Int32Array; count: number; inkOf: number[] } {
  const { width: W, height: H } = labelMap;
  const labels = Int32Array.from(labelMap.labels);
  // An ink the near-ink separation kept apart (keep) is no fringe of its near neighbour: it is neither unified with it
  // nor folded as a mix.
  const unify = labelMap.unify;
  if (unify !== undefined) for (let at = 0; at < labels.length; at += 1) { const ink = labels[at]!; if (ink >= 0 && !keep.has(ink)) labels[at] = unify[ink]!; }
  const speck = lossy ? LOSSY_SPECK : SPECK_SOURCE;
  if (!lossy) smoothedLines(labels, labelMap.inks, source, W, H);
  foldThinMixes(labels, labelMap.inks, source, W, H, lossy, keep);
  for (let pass = 0; pass < 4; pass += 1) {
    const found = components(labels, W, H);
    let changed = false;
    const size = new Array<number>(found.count).fill(0);
    for (const region of found.regions) size[region]! += 1;
    const line = speckLines(labels, found.regions, size, speck, W, H);
    const shared = new Map<number, Map<number, number>>();
    for (let at = 0; at < W * H; at += 1) {
      const here = found.regions[at]!;
      if (size[here]! >= speck || line.has(here)) continue;
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
    for (const [region, ink] of mislabelledIslands(labelMap.inks, source, found, keep, W, H)) if (!target.has(region)) target.set(region, ink);
    for (let at = 0; at < W * H; at += 1) {
      const ink = target.get(found.regions[at]!);
      if (ink !== undefined) { labels[at] = ink; changed = true; }
    }
    if (!changed) break;
  }
  return components(labels, W, H);
}

/**
 * The islands the plates mislabelled: a region inside one other region (touching nothing else, nor the canvas edge)
 * whose every source pixel is opaque and nearer that region's ink than its own is that region's ink, labelled apart
 * (a posterised gradient band's stair steps leave such pixels). The surround's ink is its nearest ink, so it joins it.
 * A real dot or hairline keeps its core pixels nearer its own ink.
 */
function mislabelledIslands(inks: readonly string[], source: Uint8Array, found: { regions: Int32Array; count: number; inkOf: number[] }, keep: ReadonlySet<number>, W: number, H: number): Map<number, number> {
  const { regions, count, inkOf } = found;
  const inkRgb = inks.map(hexRgb);
  const around = new Int32Array(count).fill(-1), open = new Uint8Array(count);
  for (let at = 0; at < W * H; at += 1) {
    const here = regions[at]!, x = at % W, y = (at - x) / W;
    if (open[here] === 1) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || source[at * 4 + 3]! < 255) { open[here] = 1; continue; }
    for (const next of [at - 1, at + 1, at - W, at + W]) {
      const other = regions[next]!;
      if (other === here) continue;
      if (around[here] === -1) around[here] = other;
      else if (around[here] !== other) { open[here] = 1; break; }
    }
  }
  const nearer = new Uint8Array(count).fill(1);
  for (let at = 0; at < W * H; at += 1) {
    const here = regions[at]!, ink = inkOf[here]!;
    if (open[here] === 1 || around[here] === -1 || nearer[here] === 0 || ink < 0) continue;
    const outer = inkOf[around[here]!]!;
    if (outer < 0) { nearer[here] = 0; continue; }
    const gap = (rgb: readonly number[]) => rgb.reduce((sum, v, c) => sum + Math.abs(v - source[at * 4 + c]!), 0);
    if (gap(inkRgb[outer]!) >= gap(inkRgb[ink]!)) nearer[here] = 0;
  }
  const into = new Map<number, number>();
  for (let region = 0; region < count; region += 1) {
    const ink = inkOf[region]!;
    if (open[region] === 1 || around[region] === -1 || nearer[region] === 0 || ink < 0 || keep.has(ink)) continue;
    const outer = inkOf[around[region]!]!;
    if (outer >= 0 && outer !== ink) into.set(region, outer);
  }
  return into;
}

/**
 * The thin lines the plates' label smoothing took from a clean source: the opaque pixels of a broad region (no strip)
 * nearer another ink than their label's take that ink where, with what is left of that ink's line, they make one
 * 8-connected strip (narrower than THIN_RATIO) longer than the clean integration span (2 WINDOW_CLEAN, as speckLines)
 * that lies in that one region, clear of its other edges by a whole transform block (BLOCK, as foldThinMixes on a
 * lossy source: a source judged clean can still be a JPEG, and a strip within a block of an edge can be its ringing).
 * A 1 px line of a near ink covers at least half of one pixel in every cross-section, and the cross-section integral
 * places it. A strip's own pixels stay: an anti-aliased hairline's pixels can all be nearer its surround's ink.
 */
function smoothedLines(labels: Int32Array, inks: readonly string[], source: Uint8Array, W: number, H: number): void {
  const inkRgb = inks.map(hexRgb), count = inks.length;
  // Each opaque pixel's nearest ink (the first of the least RGB distance, its own ink on a tie), once per colour and
  // label: a pixel of its own ink exactly has none nearer.
  const nearer = new Int32Array(W * H).fill(-1), memo = new Map<number, number>();
  let any = false;
  for (let at = 0; at < W * H; at += 1) {
    const ink = labels[at]!;
    if (ink < 0 || source[at * 4 + 3]! < 255) continue;
    const r = source[at * 4]!, g = source[at * 4 + 1]!, b = source[at * 4 + 2]!, own = inkRgb[ink]!;
    if (own[0] === r && own[1] === g && own[2] === b) continue;
    const key = ((r << 16) | (g << 8) | b) * count + ink;
    let best = memo.get(key);
    if (best === undefined) {
      best = ink; let least = Math.abs(own[0] - r) + Math.abs(own[1] - g) + Math.abs(own[2] - b);
      for (let other = 0; other < count; other += 1) {
        const rgb = inkRgb[other]!, d = Math.abs(rgb[0] - r) + Math.abs(rgb[1] - g) + Math.abs(rgb[2] - b);
        if (d < least) { least = d; best = other; }
      }
      memo.set(key, best);
    }
    if (best !== ink) { nearer[at] = best; any = true; }
  }
  if (!any) return;
  // Only pixels of a broad region (not a strip) count.
  const found = components(labels, W, H);
  const area = new Int32Array(found.count), perimeter = new Int32Array(found.count), regionsOf = found.regions;
  for (let at = 0; at < W * H; at += 1) {
    const here = regionsOf[at]!, x = at % W;
    area[here]! += 1;
    if (x === 0 || regionsOf[at - 1] !== here) perimeter[here]! += 1;
    if (x === W - 1 || regionsOf[at + 1] !== here) perimeter[here]! += 1;
    if (at < W || regionsOf[at - W] !== here) perimeter[here]! += 1;
    if (at >= W * (H - 1) || regionsOf[at + W] !== here) perimeter[here]! += 1;
  }
  for (let at = 0; at < W * H; at += 1) if (nearer[at]! >= 0 && area[regionsOf[at]!]! < THIN_RATIO * perimeter[regionsOf[at]!]!) nearer[at] = -1;
  const seen = new Uint8Array(W * H);
  for (let start = 0; start < W * H; start += 1) {
    if (nearer[start]! < 0 || seen[start] === 1) continue;
    const ink = nearer[start]!, within = found.regions[start]!;
    const line = (at: number) => nearer[at] === ink || labels[at] === ink;
    const patch = [start], taken: number[] = []; seen[start] = 1;
    let x0 = W, x1 = -1, y0 = H, y1 = -1, edge = 0, clear = true;
    for (let k = 0; k < patch.length; k += 1) {
      const at = patch[k]!, x = at % W, y = (at - x) / W;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      const candidate = nearer[at] === ink;
      if (candidate) { taken.push(at); if (found.regions[at] !== within) clear = false; }
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !line(ny * W + nx)) edge += 1;
        // A candidate's surround, a block out along both axes, is the line or its own region.
        if (!candidate) continue;
        for (let d = 1; d <= BLOCK && clear; d += 1) {
          const fx = x + dx * d, fy = y + dy * d;
          if (fx < 0 || fy < 0 || fx >= W || fy >= H) break;
          const far = fy * W + fx;
          if (!line(far) && found.regions[far] !== within) clear = false;
        }
      }
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy, next = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[next] === 1 || !line(next)) continue;
        seen[next] = 1; patch.push(next);
      }
    }
    if (!clear || Math.max(x1 - x0, y1 - y0) + 1 <= 2 * WINDOW_CLEAN || patch.length >= THIN_RATIO * edge) continue;
    // A clean render shows the line's ink in some pixel: to within the half-step rounding of the pixel and of the
    // palette's ink, one level per channel. Block noise at 256 px q60 (which can pass the noise test) leaves none.
    const rgb = inkRgb[ink]!;
    if (!taken.some((at) => rgb.every((v, c) => Math.abs(v - source[at * 4 + c]!) <= 1))) continue;
    for (const at of taken) labels[at] = ink;
  }
}

/** On a lossy (4:2:0) source a patch smaller than one chroma sample (2 x 2 px) has no colour of its own. */
const LOSSY_SPECK = 4;
/** A strip is anti-aliasing when it is narrower than this (area / perimeter is half a long strip's width). */
const THIN_RATIO = 0.7;

/**
 * A thin region (narrower than about 1.4 px, THIN_RATIO) whose ink is a mix of two neighbouring inks, within the
 * tracer's own layer difference of the line between them, is an anti-aliasing ramp: its pixels join the neighbour
 * the mix is nearer to. A region between two parts of one ink (a hairline) is kept: its ink is no mix of two inks.
 * That holds pixel by pixel too (enclosedLine): where a folded or merged region runs as a line between two parts of
 * one ink, those pixels keep their ink, and only the rest of the region joins its neighbour. On a lossy source that
 * ink must run on for a whole DCT block (BLOCK) on both sides: a strip within one block of another edge can be that
 * edge's ringing, which the block's basis spreads along the edge.
 */
function foldThinMixes(labels: Int32Array, inks: readonly string[], source: Uint8Array, W: number, H: number, lossy: boolean, keep: ReadonlySet<number>): void {
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
      if (ink < 0 || keep.has(ink) || area[region]! >= THIN_RATIO * perimeter[region]!) continue;
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
    const members = new Map<number, number[]>();
    for (let at = 0; at < W * H; at += 1) { const region = found.regions[at]!; if (into.has(region)) (members.get(region) ?? members.set(region, []).get(region)!).push(at); }
    const stays = new Set<number>();
    for (const pixels of members.values()) for (const at of enclosedLine(found.regions, found.inkOf, pixels, W, H, lossy ? BLOCK : 1)) stays.add(at);
    let changed = false;
    for (let at = 0; at < W * H; at += 1) {
      const ink = into.get(found.regions[at]!);
      if (ink !== undefined && !stays.has(at)) { labels[at] = ink; changed = true; }
    }
    if (!changed) return;
  }
}

/** A JPEG codes chroma per 16 px MCU and the transform per 8 px block. */
const MCU = 16, BLOCK = 8;

/**
 * The pixels of one region (`pixels`) that run as a line between two parts of one ink: across the region (along the shorter of
 * its row and column runs through the pixel) both sides are the same other ink. They are a line, not a fringe or a
 * noise split, when they reach further than two MCUs (a JPEG's noise is coded per MCU, so a split it makes is no
 * longer than the two MCUs it may straddle; a clean source can be judged clean and still be a JPEG) and are narrower
 * on average than one transform block. Empty otherwise.
 */
function enclosedLine(regions: Int32Array, inkOf: readonly number[], pixels: readonly number[], W: number, H: number, flank: number): number[] {
  const ink = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? null : inkOf[regions[y * W + x]!]!);
  const region = regions[pixels[0]!]!;
  const line: number[] = [];
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (const at of pixels) {
    const x = at % W, y = (at - x) / W;
    let l = x, r = x, u = y, d = y;
    while (l > 0 && regions[at - (x - l) - 1] === region) l -= 1;
    while (r < W - 1 && regions[at + (r - x) + 1] === region) r += 1;
    while (u > 0 && regions[(u - 1) * W + x] === region) u -= 1;
    while (d < H - 1 && regions[(d + 1) * W + x] === region) d += 1;
    const across = r - l <= d - u;
    const side = (k: number) => (across ? [ink(l - k, y), ink(r + k, y)] : [ink(x, u - k), ink(x, d + k)]);
    const [one, other] = side(1);
    if (one === null || one !== other) continue;
    let flanked = true;
    for (let k = 2; k <= flank && flanked; k += 1) flanked = side(k).every((v) => v === one);
    if (!flanked) continue;
    line.push(at); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const reach = Math.max(x1 - x0, y1 - y0) + 1;
  return reach > 2 * MCU && line.length < BLOCK * reach ? line : [];
}

/** The speck-sized regions whose 8-connected patch of speck-sized pieces of their ink spans more than 2 WINDOW_CLEAN. */
function speckLines(labels: Int32Array, regions: Int32Array, size: readonly number[], speck: number, W: number, H: number): Set<number> {
  const small = (at: number) => size[regions[at]!]! < speck;
  const seen = new Uint8Array(W * H), stack: number[] = [], line = new Set<number>();
  for (let start = 0; start < W * H; start += 1) {
    if (seen[start] === 1 || !small(start)) continue;
    const ink = labels[start]!, members: number[] = [];
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    seen[start] = 1; stack.push(start);
    while (stack.length > 0) {
      const at = stack.pop()!, x = at % W, y = (at - x) / W;
      members.push(at); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy, next = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[next] === 1 || labels[next] !== ink || !small(next)) continue;
        seen[next] = 1; stack.push(next);
      }
    }
    if (Math.max(x1 - x0, y1 - y0) + 1 > 2 * WINDOW_CLEAN) for (const at of members) line.add(regions[at]!);
  }
  return line;
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
      if (x > 0 && regions[at - 1] === -1 && labels[at - 1] === ink) { regions[at - 1] = id; stack.push(at - 1); }
      if (x < W - 1 && regions[at + 1] === -1 && labels[at + 1] === ink) { regions[at + 1] = id; stack.push(at + 1); }
      if (at >= W && regions[at - W] === -1 && labels[at - W] === ink) { regions[at - W] = id; stack.push(at - W); }
      if (at + W < W * H && regions[at + W] === -1 && labels[at + W] === ink) { regions[at + W] = id; stack.push(at + W); }
    }
  }
  return { regions, count: inkOf.length, inkOf };
}

/** Per region that `wanted` picks, the median of its pixels (premultiplied RGBA, per channel). */
function regionMedians(regions: Int32Array, X: Float32Array, wanted: (region: number) => boolean): Map<number, number[]> {
  const histograms = new Map<number, Uint32Array>();
  for (let at = 0; at < regions.length; at += 1) {
    const region = regions[at]!;
    if (!wanted(region)) continue;
    const histogram = histograms.get(region) ?? histograms.set(region, new Uint32Array(4 * 256)).get(region)!;
    for (let c = 0; c < 4; c += 1) histogram[c * 256 + Math.min(255, Math.max(0, Math.round(X[at * 4 + c]!)))]! += 1;
  }
  const medians = new Map<number, number[]>();
  for (const [region, histogram] of histograms) {
    let total = 0;
    for (let v = 0; v < 256; v += 1) total += histogram[v]!;
    medians.set(region, [0, 1, 2, 3].map((c) => { let seen = 0, v = 0; for (; v < 255; v += 1) { seen += histogram[c * 256 + v]!; if (2 * seen > total) break; } return v; }));
  }
  return medians;
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

function subpixelPoints(chain: Chain, edges: readonly Edge[], regions: Int32Array, W: number, H: number, X: Float32Array, colours: readonly number[][], window: number, backdrop: readonly number[], lossy: boolean, impurity: number[]): Point[] {
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
    const t = lossy
      ? (y: number, x: number) => Math.min(1, Math.max(0, mixDot(pixel(y, x).map((v, c) => v - Ca[c]!), dv) / dd))
      : (y: number, x: number) => { // rgbaDot of the same differences, in the same order, without the arrays
        const at = (y * W + x) * 4;
        return Math.min(1, Math.max(0, ((X[at]! - Ca[0]!) * dv[0]! + (X[at + 1]! - Ca[1]!) * dv[1]! + (X[at + 2]! - Ca[2]!) * dv[2]! + (X[at + 3]! - Ca[3]!) * dv[3]!) / dd));
      };
    // thin() needs a 1 px run of one side's region with the other side's colour past it: test that first.
    const sameColour = (region: number, colour: readonly number[]) => { const C = colours[region]!; for (let c = 0; c < C.length; c += 1) if (C[c] !== colour[c]) return false; return true; };
    const oneRun = (before: number, after: number) => (before >= 0 && regions[before] !== e.la && sameColour(regions[before]!, Cb)) || (after >= 0 && regions[after] !== e.lb && sameColour(regions[after]!, Ca));
    // (Clean sources only: on a lossy source the block transform spreads a 1 px line's pixels over the outer windows,
    // whose area the integral would read as the line's.)
    // A region one pixel across between two parts of one colour: half of that run cannot be split between its two
    // edges, so each would read the whole pixel, and its anti-aliasing spills into the outer colour's pixels. The
    // whole cross-section (the outer colour's window on both sides and the pixel between) holds the region's area and
    // centroid, which blur keeps: it spans centroid +- width / 2. A longer run gives each edge its own half. The pixel
    // must go on along the edge (a line), so its cross-section's outer pixels are the outer colour's, not the same edge's.
    const thin = (size: number, along: (i: number) => number, share: (i: number) => number, at: number, beside: (i: number) => (readonly [number, number, number])[]): number | null => {
      const regionAt = (i: number) => regions[along(i)]!;
      const same = (region: number, colour: readonly number[]) => colours[region]!.every((v, c) => v === colour[c]);
      for (const [T, O, start, step] of [[e.la, Cb, at - 1, -1], [e.lb, Ca, at, 1]] as const) {
        let n = 0, i = start;
        while (i >= 0 && i < size && regionAt(i) === T && n < 2) { n += 1; i += step; }
        if (n !== 1 || i < 0 || i >= size || !same(regionAt(i), O)) continue;
        // A pixel wholly the region's colour (to within the half-step rounding of each 8-bit channel) holds neither edge:
        // each lies in its own outer pixel, whose share places it exactly. The centroid would instead put an outer
        // pixel's share at its centre, not against the line, and shift a line of 1-2 px towards its wider side.
        const own = (j: number) => T === e.la ? 1 - share(j) : share(j), rounding = dv.reduce((sum, v) => sum + 0.5 * Math.abs(v), 0) / dd;
        if (own(start) >= 1 - rounding) continue;
        // A line runs along the edge: beside its pixel the region goes on one pixel across again (not a lone pixel on an
        // edge's anti-aliased row, nor the tip of a region that widens past it).
        if (!beside(start).some(([cell, prev, next]) => regions[cell] === T && (prev < 0 || regions[prev] !== T) && (next < 0 || regions[next] !== T))) continue;
        // Each outer window is the outer colour's run as reach() reads one: up to `window` px, but only half a run that
        // ends at another edge (the far half is that edge's anti-aliasing, such as the next line's).
        const outer = (from: number, dir: number) => {
          let run = 0, j = from;
          while (j >= 0 && j < size && run < 2 * window && same(regionAt(j), O)) { run += 1; j += dir; }
          return j < 0 || j >= size ? Math.min(window, run) : Math.max(1, Math.min(window, Math.floor(run / 2)));
        };
        const cells: number[] = [], far = outer(i, step), near = outer(start - step, -step);
        for (let j = i, k = 0; k < far; j += step, k += 1) cells.push(j);
        for (let j = start, k = 0; k < n; j += step, k += 1) cells.push(j);
        for (let j = start - step, k = 0; k < near; j -= step, k += 1) cells.push(j);
        // The outer pixels hold this line's anti-aliasing only: beside none of them (along the edge) is the line's
        // region again, as where the line meets another part of itself, whose anti-aliasing they would also hold.
        if (cells.some((j) => j !== start && beside(j).some(([cell]) => regions[cell] === T))) return null;
        // The integral holds the line's whole area only where its coverage stops in the pixels next to its own: a line
        // that only partly covers its pixel is under 2 px wide, so the cells past those are the outer colour (to within
        // the half-step rounding of each 8-bit channel), and so are their neighbours along the line, not inside a
        // spread such as a JPEG's ringing or block noise.
        // Each window then reaches past the neighbouring pixel, or the integral cannot see where the coverage stops.
        const pureAt = (q: number) => { let gap = 0; for (let c = 0; c < 4; c += 1) gap += (X[q * 4 + c]! - O[c]!) ** 2; return gap <= 1; };
        const pure = (j: number) => pureAt(along(j)) && beside(j).every(([cell]) => pureAt(cell));
        if (far < 2 || near < 2 || cells.some((j) => j !== start && j !== i && j !== start - step && !pure(j))) return null;
        let width = 0, moment = 0;
        for (const j of cells) { width += own(j); moment += (j + 0.5) * own(j); }
        if (width <= 0) return null;
        return T === e.la ? moment / width + width / 2 : moment / width - width / 2;
      }
      return null;
    };
    if (e.kind === "v") {
      const y = e.y, x = e.x; let l = x - 1, r = x;
      const wl = reach(x - 1, -1, W, (i) => regions[y * W + i]!, e.la), wr = reach(x, 1, W, (i) => regions[y * W + i]!, e.lb);
      while (l - 1 >= 0 && x - 1 - (l - 1) < wl && regions[y * W + l - 1] === e.la) l -= 1;
      while (r + 1 < W && r + 1 - x < wr && regions[y * W + r + 1] === e.lb) r += 1;
      let sum = 0; for (let i = l; i <= r; i += 1) sum += t(y, i);
      impurity.push(wl === window && wr === window ? t(y, l) + 1 - t(y, r) : NaN);
      const across = lossy || !oneRun(x >= 2 ? y * W + x - 2 : -1, x + 1 < W ? y * W + x + 1 : -1) ? null : thin(W, (i) => y * W + i, (i) => t(y, i), x, (i) => [y - 1, y + 1].filter((v) => v >= 0 && v < H).map((v) => [v * W + i, i > 0 ? v * W + i - 1 : -1, i < W - 1 ? v * W + i + 1 : -1] as const));
      out.push([Math.min(Math.max(across ?? r + 1 - sum, x - 1), x + 1), y + 0.5]);
    } else {
      const y = e.y, x = e.x; let l = y - 1, r = y;
      const wl = reach(y - 1, -1, H, (i) => regions[i * W + x]!, e.la), wr = reach(y, 1, H, (i) => regions[i * W + x]!, e.lb);
      while (l - 1 >= 0 && y - 1 - (l - 1) < wl && regions[(l - 1) * W + x] === e.la) l -= 1;
      while (r + 1 < H && r + 1 - y < wr && regions[(r + 1) * W + x] === e.lb) r += 1;
      let sum = 0; for (let i = l; i <= r; i += 1) sum += t(i, x);
      impurity.push(wl === window && wr === window ? t(l, x) + 1 - t(r, x) : NaN);
      const across = lossy || !oneRun(y >= 2 ? (y - 2) * W + x : -1, y + 1 < H ? (y + 1) * W + x : -1) ? null : thin(H, (i) => i * W + x, (i) => t(i, x), y, (i) => [x - 1, x + 1].filter((v) => v >= 0 && v < W).map((v) => [i * W + v, i > 0 ? (i - 1) * W + v : -1, i < H - 1 ? (i + 1) * W + v : -1] as const));
      out.push([x + 0.5, Math.min(Math.max(across ?? r + 1 - sum, y - 1), y + 1)]);
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
// Per coordinate, written out (the same arithmetic in the same order as a map over [0, 1], without its arrays).
const bezAt = (b: Cubic, t: number, c: number) => { const m = 1 - t; return m * m * m * b[0][c]! + 3 * m * m * t * b[1][c]! + 3 * m * t * t * b[2][c]! + t * t * t * b[3][c]!; };
const bezdAt = (b: Cubic, t: number, c: number) => { const m = 1 - t; return 3 * m * m * (b[1][c]! - b[0][c]!) + 6 * m * t * (b[2][c]! - b[1][c]!) + 3 * t * t * (b[3][c]! - b[2][c]!); };
const bezddAt = (b: Cubic, t: number, c: number) => 6 * (1 - t) * (b[2][c]! - 2 * b[1][c]! + b[0][c]!) + 6 * t * (b[3][c]! - 2 * b[2][c]! + b[1][c]!);
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
  const ends: Cubic = [p0, p0, p3, p3];
  for (let i = 0; i < u.length; i += 1) {
    const t = u[i]!, k1 = 3 * (1 - t) ** 2 * t, k2 = 3 * (1 - t) * t * t;
    const a10 = t1[0] * k1, a11 = t1[1] * k1, a20 = t2[0] * k2, a21 = t2[1] * k2;
    c00 += a10 * a10 + a11 * a11; c01 += a10 * a20 + a11 * a21; c11 += a20 * a20 + a21 * a21;
    const tmp0 = P[i]![0] - bezAt(ends, t, 0), tmp1 = P[i]![1] - bezAt(ends, t, 1);
    x0 += a10 * tmp0 + a11 * tmp1; x1 += a20 * tmp0 + a21 * tmp1;
  }
  const det = c00 * c11 - c01 * c01, seg = norm(sub(p3, p0));
  let a1 = seg / 3, a2 = seg / 3;
  if (Math.abs(det) > 1e-12) { a1 = (x0 * c11 - x1 * c01) / det; a2 = (c00 * x1 - c01 * x0) / det; }
  if (a1 < 1e-6 * seg || a2 < 1e-6 * seg || a1 > 2 * seg || a2 > 2 * seg) { a1 = seg / 3; a2 = seg / 3; }
  return [p0, add(p0, mul(t1, a1)), add(p3, mul(t2, a2)), p3];
}

function reparam(b: Cubic, P: readonly Point[], u: readonly number[]): number[] {
  const out = new Array<number>(u.length);
  for (let i = 0; i < u.length; i += 1) {
    const t = u[i]!, d0 = bezAt(b, t, 0) - P[i]![0], d1 = bezAt(b, t, 1) - P[i]![1];
    const e0 = bezdAt(b, t, 0), e1 = bezdAt(b, t, 1), f0 = bezddAt(b, t, 0), f1 = bezddAt(b, t, 1);
    const num = d0 * e0 + d1 * e1, den = e0 * e0 + e1 * e1 + d0 * f0 + d1 * f1;
    out[i] = Math.min(1, Math.max(0, t - (Math.abs(den) > 1e-9 ? num / den : 0)));
  }
  return out;
}

/** The fit error in tolerance terms: the larger of max error / KMAX and rms / KRMS, and the worst sample. */
function fitError(b: Cubic, P: readonly Point[], u: readonly number[]): [number, number] {
  let worst = 0, at = 0, squares = 0;
  for (let i = 0; i < u.length; i += 1) { const t = u[i]!, e = Math.hypot(bezAt(b, t, 0) - P[i]![0], bezAt(b, t, 1) - P[i]![1]); squares += e * e; if (e > worst) { worst = e; at = i; } }
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
function sharpenCorner(P: readonly Point[], c: number, square: ((p: Point) => boolean) | null): [Point[], number, boolean] {
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
  if (first === null) { const cap = square === null ? null : capCorners(P, c, fitLine); return cap === null || !square!(P[c]!) ? [P.slice(), c, false] : [...cap, true]; }
  const X = intersect(first) ?? first;
  // The bevel's points (within 1 px of the corner, and of the sample it replaces) go.
  const s = P.map((p) => Math.min(norm(sub(p, P[c]!)), norm(sub(p, X))));
  const keep = [...Array(n).keys()].filter((i) => i === c || s[i]! >= 1 || i === 0 || i === n - 1);
  const out = keep.map((i) => (i === c ? X : P[i]!));
  return [out, keep.indexOf(c), false];
}

/**
 * A strip's end narrower than the corner scale: the outline turns back within 2 px, so the two sides are parallel and
 * have no intersection. It is two corners (each a turn of more than CORNER_DEGREES within 2 px): the end runs through
 * the turn's sample across the sides, and meets each side's line within 1.5 px of that sample, as a corner may move.
 * Returns the points with both corners in place of the bevel, and the first corner's index (the second follows it).
 * Clean sources only (sharpenCorner): on a lossy one the sides wander by the block noise, past what the end tests read.
 */
function capCorners(P: readonly Point[], c: number, fitLine: (ix: number[]) => [Point, Point]): [Point[], number] | null {
  const n = P.length, s = P.map((p) => norm(sub(p, P[c]!)));
  const L: number[] = [], R: number[] = [];
  for (let i = Math.max(0, c - 8); i < c; i += 1) if (s[i]! >= 1.2 && s[i]! <= 5) L.push(i);
  for (let i = c + 1; i < Math.min(n, c + 9); i += 1) if (s[i]! >= 1.2 && s[i]! <= 5) R.push(i);
  if (L.length < 2 || R.length < 2) return null;
  const [m1, d1] = fitLine(L), [m2, d2] = fitLine(R);
  if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) >= 0.2) return null;
  // A strip keeps its width: the far side's samples stay one distance from the near side's line, within the half pixel
  // a sampled side wanders (a wedge's sides converge, and its tip lies past the turn, not on an end across them).
  const apart = R.map((i) => Math.abs((P[i]![0] - m1[0]) * d1[1] - (P[i]![1] - m1[1]) * d1[0]));
  if (Math.max(...apart) - Math.min(...apart) >= 0.5) return null;
  // The sides run back along each other: towards the turn on one, away from it on the other.
  const toward = sub(P[c]!, P[L[0]!]!), away = sub(P[R[R.length - 1]!]!, P[c]!);
  if (toward[0] * away[0] + toward[1] * away[1] >= 0) return null;
  const along = (m: Point) => { const t = (P[c]![0] - m[0]) * d1[0] + (P[c]![1] - m[1]) * d1[1]; return add(m, mul(d1, t)); };
  const X1 = along(m1), X2 = add(m2, mul(d2, (P[c]![0] - m2[0]) * d2[0] + (P[c]![1] - m2[1]) * d2[1]));
  if (norm(sub(X1, P[c]!)) > 1.5 || norm(sub(X2, P[c]!)) > 1.5) return null;
  // A square end's sides run up to it: the samples either side of the turn lie within one sample step (1 px) of the end
  // line. A rounded end's sides turn away before it.
  const short = (i: number) => i >= 0 && i < n && Math.abs((P[c]![0] - P[i]![0]) * d1[0] + (P[c]![1] - P[i]![1]) * d1[1]) > 1;
  if (short(c - 1) || short(c + 1)) return null;
  // The bevel's points (within 1 px of the sample or either corner) go; the corners take the sample's place.
  const d = P.map((p) => Math.min(norm(sub(p, P[c]!)), norm(sub(p, X1)), norm(sub(p, X2))));
  const keep = [...Array(n).keys()].filter((i) => i === c || d[i]! >= 1 || i === 0 || i === n - 1);
  const out: Point[] = [];
  for (const i of keep) { if (i === c) out.push(X1, X2); else out.push(P[i]!); }
  return [out, keep.indexOf(c)];
}

function fitChain(input: readonly Point[], closed: boolean, tol: number, square: ((p: Point) => boolean) | null): Cubic[] {
  let P = input.filter((p, i) => i === 0 || norm(sub(p, input[i - 1]!)) > 1e-4);
  if (closed && P.length > 1 && norm(sub(P[0]!, P[P.length - 1]!)) < 1e-4) P = P.slice(0, -1);
  if (P.length < 2) return [];
  if (!closed && P.length <= 3) return P.slice(0, -1).map((p, i) => line(p, P[i + 1]!));
  let cs = findCorners(P, closed);
  for (let k = 0; k < cs.length; k += 1) {
    const [next, nc, cap] = sharpenCorner(P, cs[k]!, square);
    if (cap) {
      // A strip's end became two corners (capCorners): later corners move by the change in length.
      const shift = next.length - P.length; P = next;
      cs = [...new Set([...cs.slice(0, k), nc, nc + 1, ...cs.slice(k + 1).map((c) => c + shift)].map((c) => Math.min(Math.max(c, 0), P.length - 1)))].sort((l, r) => l - r);
      k = Math.max(k, cs.indexOf(nc + 1)); continue;
    }
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

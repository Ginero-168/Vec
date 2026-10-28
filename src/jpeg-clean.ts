import { deltaE2000, oklabToRgb, rgbToLab, type Lab } from "./color.ts";
import { denoiseJpegArtifacts, wouldDenoise } from "./denoise.ts";

/**
 * JPEG cleanup for the flat (logo/icon) trace. Both steps run only on rasters denoise.ts detects as lossy
 * (opaque, at least 48 px, compression residual in flat areas); every other raster passes through untouched, so
 * clean PNG input traces exactly as before.
 */

/** Raster hook for flatPlates: block-offset correction plus one edge-preserving bilateral pass, or the input itself. */
export function jpegCleanRaster(rgba: Uint8Array, width: number, height: number): Uint8Array {
  return denoiseJpegArtifacts(rgba, width, height);
}

// At 64 px a q60 icon's features are one or two pixels wide; the bilateral passes moved them and the per-file gate
// regressed (om-gear-64 MAE +3, tw-apple-64 lost its stem). Smaller lossy sources trace as before.
const MIN_CLEAN_SIDE = 96;

/**
 * The cleanup hook for a whole source, or undefined when the source is not lossy. The decision is made once on the
 * full image: single crops of a clean screenshot (an app icon's gradient) can read as noisy on their own.
 */
export function lossyCleanup(rgba: Uint8Array, width: number, height: number): typeof jpegCleanRaster | undefined {
  // The long side: a tall or wide 128 px logo (gl-figma-128-q60 is 86x128) is as detailed as a square one, and its
  // short side alone kept it out. 64 px sources stay out; cleaning them lost their thin features.
  return Math.max(width, height) >= MIN_CLEAN_SIDE && wouldDenoise(rgba, width, height) ? jpegCleanRaster : undefined;
}

const MERGE_DELTA_E = 3;
const MINOR_DELTA_E = 6;
const MINOR_SHARE = 0.1;
const DARK_L = 12;
const DARK_DELTA_E = 10;

/**
 * Fold palette centres closer than ΔE2000 3 (CIELab) into the centre that explains more core pixels. JPEG noise and
 * ringing split one flat ink into several near-identical centres; each became its own plate colour and its own
 * fragment of paths. The fold is a pixel-weighted mean in OKLab.
 */
export function mergeNearCenters(centers: readonly Lab[], lab: Float64Array, core: Uint8Array): Lab[] {
  if (centers.length < 2) return [...centers];
  const counts = new Float64Array(centers.length);
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const L = lab[index * 3] ?? 0, a = lab[index * 3 + 1] ?? 0, b = lab[index * 3 + 2] ?? 0;
    let best = 0;
    let bestDistance = Infinity;
    for (const [at, center] of centers.entries()) {
      const distance = (center.L - L) ** 2 + (center.a - a) ** 2 + (center.b - b) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = at;
      }
    }
    counts[best] = (counts[best] ?? 0) + 1;
  }
  const cie = centers.map((center) => rgbToLab(oklabToRgb(center)));
  const order = centers.map((_, at) => at).sort((left, right) => (counts[right] ?? 0) - (counts[left] ?? 0) || left - right);
  const groups: { lead: number; members: number[] }[] = [];
  for (const at of order) {
    // A minor centre (under a tenth of the lead's core pixels) within MINOR_DELTA_E is the lead's JPEG noise too:
    // q60 splits one flat ink into a main centre and small satellites ΔE 3-6 away.
    // Near-black inks: q60 tints a thin black outline's pixels navy or brown (ΔE2000 6-11 at CIE L* under 12), and
    // each tint became its own shape over the outline (om-grinning-128-q60's navy blobs over the tongue's corners).
    const limit = (lead: number) =>
      (cie[lead]?.L ?? 100) < DARK_L && (cie[at]?.L ?? 100) < DARK_L ? DARK_DELTA_E
        : (counts[at] ?? 0) < MINOR_SHARE * (counts[lead] ?? 0) ? MINOR_DELTA_E : MERGE_DELTA_E;
    // A centre with no core pixels is a thin feature's ink (an outline); with no flat area there is no noise to fold.
    const home = (counts[at] ?? 0) === 0 ? undefined : groups.find((group) => deltaE2000(cie[group.lead] as Lab, cie[at] as Lab) < limit(group.lead));
    if (home === undefined) groups.push({ lead: at, members: [at] });
    else home.members.push(at);
  }
  // Ringing: a minor centre that sits on the line between two larger inks is their JPEG overshoot (cream around an
  // orange star on white), not an ink of its own. Its pixels go to the nearest remaining centre.
  const kept = groups.filter((group) => !groups.some((left) => groups.some((right) => left !== right && left !== group && right !== group
    && (counts[group.lead] ?? 0) < MINOR_SHARE * Math.min(counts[left.lead] ?? 0, counts[right.lead] ?? 0)
    && onSegment(centers[group.lead] as Lab, centers[left.lead] as Lab, centers[right.lead] as Lab))));
  if (kept.length === centers.length) return [...centers];
  groups.splice(0, groups.length, ...kept);
  // Keep the original order of the lead centres so label numbering stays stable.
  return groups
    .sort((left, right) => left.lead - right.lead)
    .map((group) => {
      const total = group.members.reduce((sum, at) => sum + Math.max(1, counts[at] ?? 0), 0);
      const mix = (pick: (center: Lab) => number) => group.members.reduce((sum, at) => sum + pick(centers[at] as Lab) * Math.max(1, counts[at] ?? 0), 0) / total;
      return { L: mix((center) => center.L), a: mix((center) => center.a), b: mix((center) => center.b) };
    });
}

const RING_DISTANCE = 0.04;

function onSegment(point: Lab, from: Lab, to: Lab): boolean {
  const span = { L: to.L - from.L, a: to.a - from.a, b: to.b - from.b };
  const length = span.L ** 2 + span.a ** 2 + span.b ** 2;
  if (length === 0) return false;
  const t = ((point.L - from.L) * span.L + (point.a - from.a) * span.a + (point.b - from.b) * span.b) / length;
  if (t <= 0 || t >= 1) return false;
  const distance = Math.hypot(point.L - from.L - t * span.L, point.a - from.a - t * span.a, point.b - from.b - t * span.b);
  return distance <= RING_DISTANCE;
}

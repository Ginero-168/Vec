export type Lab = { readonly L: number; readonly a: number; readonly b: number };
export type RGB = { readonly r: number; readonly g: number; readonly b: number };

const D65 = { x: 0.95047, y: 1, z: 1.08883 };

export function srgbChannelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearChannelToSrgb(channel: number): number {
  const value = Math.min(1, Math.max(0, channel));
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

export function rgbToLab(color: RGB): Lab {
  const red = srgbChannelToLinear(color.r);
  const green = srgbChannelToLinear(color.g);
  const blue = srgbChannelToLinear(color.b);
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / D65.x;
  const y = (0.2126729 * red + 0.7151522 * green + 0.072175 * blue) / D65.y;
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / D65.z;
  const fy = labPivot(y);
  return { L: 116 * fy - 16, a: 500 * (labPivot(x) - fy), b: 200 * (fy - labPivot(z)) };
}

export function rgbToOklab(color: RGB): Lab {
  const red = srgbChannelToLinear(color.r);
  const green = srgbChannelToLinear(color.g);
  const blue = srgbChannelToLinear(color.b);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  };
}

export function oklabToRgb(color: Lab): RGB {
  const l = color.L + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const m = color.L - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const s = color.L - 0.0894841775 * color.a - 1.291485548 * color.b;
  const lp = l * l * l;
  const mp = m * m * m;
  const sp = s * s * s;
  return {
    r: linearChannelToSrgb(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp),
    g: linearChannelToSrgb(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp),
    b: linearChannelToSrgb(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp)
  };
}

export function labDistance2(left: Lab, right: Lab): number {
  const dL = left.L - right.L;
  const da = left.a - right.a;
  const db = left.b - right.b;
  return dL * dL + da * da + db * db;
}

/** CIEDE2000, Sharma 2005, with kL = kC = kH = 1. */
export function deltaE2000(left: Lab, right: Lab): number {
  const c1 = Math.hypot(left.a, left.b);
  const c2 = Math.hypot(right.a, right.b);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1 = (1 + g) * left.a;
  const a2 = (1 + g) * right.a;
  const c1p = Math.hypot(a1, left.b);
  const c2p = Math.hypot(a2, right.b);
  const h1 = hueDegrees(left.b, a1);
  const h2 = hueDegrees(right.b, a2);
  const dl = right.L - left.L;
  const dc = c2p - c1p;
  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh * Math.PI) / 360);
  const lBar = (left.L + right.L) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBar = h1 + h2;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1 - h2) <= 180) hBar = (h1 + h2) / 2;
    else if (h1 + h2 < 360) hBar = (h1 + h2 + 360) / 2;
    else hBar = (h1 + h2 - 360) / 2;
  }
  const hue = (degrees: number) => (degrees * Math.PI) / 180;
  const t = 1 - 0.17 * Math.cos(hue(hBar - 30)) + 0.24 * Math.cos(hue(2 * hBar)) + 0.32 * Math.cos(hue(3 * hBar + 6)) - 0.2 * Math.cos(hue(4 * hBar - 63));
  const theta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const cBarP7 = cBarP ** 7;
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(hue(2 * theta)) * rc;
  return Math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh));
}

function labPivot(value: number): number {
  const delta = 6 / 29;
  return value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta * delta) + 4 / 29;
}

function hueDegrees(b: number, a: number): number {
  if (a === 0 && b === 0) return 0;
  const degrees = (Math.atan2(b, a) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

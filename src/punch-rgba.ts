export type PunchedRgba = {
  readonly rgba: Uint8Array;
  readonly droppedColor: string | null;
};

export function punchRgba(rgba: Uint8Array, width: number, height: number, opaqueAt = 128, onProgress?: (fraction: number) => void): PunchedRgba {
  onProgress?.(0);
  const count = width * height;
  if (rgba.length < count * 4) {
    onProgress?.(1);
    return { rgba, droppedColor: null };
  }
  const cutoff = Math.min(255, Math.max(0, opaqueAt));
  const used = new Set<number>();
  let transparent = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const alpha = rgba[offset + 3] ?? 255;
    if (alpha < cutoff) {
      transparent += 1;
      continue;
    }
    used.add(((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0));
    if (index % 16384 === 0) onProgress?.((index / count) * 0.45);
  }
  if (transparent === 0) {
    let needsFlattening = false;
    for (let index = 0; index < count; index += 1) {
      if ((rgba[index * 4 + 3] ?? 255) !== 255) {
        needsFlattening = true;
        break;
      }
    }
    if (!needsFlattening) {
      onProgress?.(1);
      return { rgba, droppedColor: null };
    }
    const opaque = new Uint8Array(rgba);
    for (let index = 0; index < count; index += 1) {
      opaque[index * 4 + 3] = 255;
      if (index % 16384 === 0) onProgress?.(0.45 + (index / count) * 0.55);
    }
    onProgress?.(1);
    return { rgba: opaque, droppedColor: null };
  }
  const sentinel = unusedColor(used);
  const next = new Uint8Array(count * 4);
  next.set(rgba.subarray(0, count * 4));
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    if ((next[offset + 3] ?? 255) < cutoff) {
      next[offset] = (sentinel >> 16) & 255;
      next[offset + 1] = (sentinel >> 8) & 255;
      next[offset + 2] = sentinel & 255;
    }
    next[offset + 3] = 255;
    if (index % 16384 === 0) onProgress?.(0.45 + (index / count) * 0.55);
  }
  onProgress?.(1);
  return { rgba: next, droppedColor: hex(sentinel) };
}

export async function punchRgbaAsync(
  rgba: Uint8Array,
  width: number,
  height: number,
  opaqueAt = 128,
  onProgress?: (fraction: number) => void,
  shouldCancel?: () => boolean
): Promise<PunchedRgba> {
  if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
  let lastYield = Date.now();
  const cooperate = async (): Promise<void> => {
    if (Date.now() - lastYield < 20) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lastYield = Date.now();
    if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
  };
  onProgress?.(0);
  const count = width * height;
  if (rgba.length < count * 4) {
    onProgress?.(1);
    return { rgba, droppedColor: null };
  }
  const cutoff = Math.min(255, Math.max(0, opaqueAt));
  const used = new Set<number>();
  let transparent = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const alpha = rgba[offset + 3] ?? 255;
    if (alpha < cutoff) transparent += 1;
    else used.add(((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0));
    if (index % 8192 === 0) {
      onProgress?.(0.45 * index / count);
      await cooperate();
    }
  }
  if (transparent === 0) {
    let needsFlattening = false;
    for (let index = 0; index < count; index += 1) {
      if ((rgba[index * 4 + 3] ?? 255) !== 255) {
        needsFlattening = true;
        break;
      }
      if (index % 8192 === 0) await cooperate();
    }
    if (!needsFlattening) {
      onProgress?.(1);
      return { rgba, droppedColor: null };
    }
    const opaque = new Uint8Array(rgba);
    for (let index = 0; index < count; index += 1) {
      opaque[index * 4 + 3] = 255;
      if (index % 8192 === 0) {
        onProgress?.(0.45 + 0.55 * index / count);
        await cooperate();
      }
    }
    onProgress?.(1);
    return { rgba: opaque, droppedColor: null };
  }
  const sentinel = unusedColor(used);
  const next = new Uint8Array(count * 4);
  next.set(rgba.subarray(0, count * 4));
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    if ((next[offset + 3] ?? 255) < cutoff) {
      next[offset] = (sentinel >> 16) & 255;
      next[offset + 1] = (sentinel >> 8) & 255;
      next[offset + 2] = sentinel & 255;
    }
    next[offset + 3] = 255;
    if (index % 8192 === 0) {
      onProgress?.(0.45 + 0.55 * index / count);
      await cooperate();
    }
  }
  onProgress?.(1);
  return { rgba: next, droppedColor: hex(sentinel) };
}

export function revealSentinel(rgba: Uint8Array, droppedColor: string | null): Uint8Array {
  if (droppedColor === null) return rgba;
  const parsed = /^#([0-9a-f]{6})$/i.exec(droppedColor);
  if (parsed === null) return rgba;
  const value = Number.parseInt(parsed[1] ?? "", 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const next = new Uint8Array(rgba);
  for (let index = 0; index < next.length; index += 4) {
    if (next[index] === red && next[index + 1] === green && next[index + 2] === blue) next[index + 3] = 0;
  }
  return next;
}

function unusedColor(used: Set<number>): number {
  const candidates = [0xff00ff, 0x00ff00, 0xff00aa, 0x00ffff, 0xffff00];
  for (const color of candidates) if (!used.has(color)) return color;
  for (let color = 0; color < 16777216; color += 97) if (!used.has(color)) return color;
  return 0xff00ff;
}

function hex(color: number): string {
  return "#" + color.toString(16).padStart(6, "0");
}

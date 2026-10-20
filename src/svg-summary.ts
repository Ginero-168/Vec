export type SvgSummary = { readonly pathCount: number };

export function summarizeSvg(svg: string): SvgSummary {
  if (svg.toLowerCase().indexOf("<svg") === -1) throw new Error("ไฟล์ผลลัพธ์ไม่ใช่ SVG");
  const matches = svg.match(/<path\b/gi);
  const pathCount = matches ? matches.length : 0;
  if (pathCount <= 0) throw new Error("VTracer ไม่ได้สร้างเส้นใน SVG");
  return { pathCount };
}

/** Invisible rect covering the SVG canvas. host.jsx fits the import to it, then deletes it. */
export function insertCanvasFrame(svg: string): string {
  if (svg.indexOf('id="vp-canvas"') !== -1) return svg;
  const svgTag = /<svg\b[^>]*>/i.exec(svg);
  if (!svgTag) throw new Error("ผลจาก VTracer ไม่ใช่ SVG");
  const tag = svgTag[0];
  const size = canvasSize(tag);
  if (size === null) throw new Error("SVG ไม่มีขนาด canvas");
  const frame = '<rect id="vp-canvas" x="0" y="0" width="' + size.width + '" height="' + size.height + '" fill="none" stroke="none"/>';
  const at = svgTag.index + tag.length;
  return svg.slice(0, at) + frame + svg.slice(at);
}

function canvasSize(tag: string): { width: string; height: string } | null {
  const width = /\swidth="([\d.]+)"/.exec(tag)?.[1];
  const height = /\sheight="([\d.]+)"/.exec(tag)?.[1];
  if (width && height) return { width, height };
  const box = /\sviewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(tag);
  const boxWidth = box?.[1];
  const boxHeight = box?.[2];
  if (!boxWidth || !boxHeight) return null;
  return { width: boxWidth, height: boxHeight };
}

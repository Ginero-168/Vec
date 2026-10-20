export type SvgSummary = { readonly pathCount: number };

export function summarizeSvg(svg: string): SvgSummary {
  if (svg.toLowerCase().indexOf("<svg") === -1) throw new Error("ไฟล์ผลลัพธ์ไม่ใช่ SVG");
  const matches = svg.match(/<path\b/gi);
  const pathCount = matches ? matches.length : 0;
  if (pathCount <= 0) throw new Error("VTracer ไม่ได้สร้างเส้นใน SVG");
  return { pathCount };
}

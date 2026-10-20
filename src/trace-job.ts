import * as childProcess from "child_process";
import * as fs from "fs";
import { prepareTracePng, stitchStripPngs } from "./image-prep";
import { insertCanvasFrame, summarizeSvg } from "./svg-summary";

export type TraceStage = "prepare" | "trace" | "svg";

export type TraceRequest = {
  readonly binary: string;
  readonly sourcePath: string;
  readonly pngPath: string;
  readonly svgPath: string;
  readonly flags: readonly string[];
  readonly maxPixels: number;
  readonly maxDecodePixels: number;
  readonly stripPaths: readonly string[];
};

export type TraceResult = {
  readonly width: number;
  readonly height: number;
  readonly resized: boolean;
  readonly pathCount: number;
};

export type TraceHooks = {
  onProgress: (stage: TraceStage) => void;
  isCancelled: () => boolean;
  registerChild: (kill: () => void) => void;
  thread?: { readonly threadId: number; readonly isMainThread: boolean };
};

export async function runTraceJob(request: TraceRequest, hooks: TraceHooks): Promise<TraceResult> {
  if (hooks.isCancelled()) throw new Error("ยกเลิกแล้ว");
  hooks.onProgress("prepare");
  writeThreadMarker(hooks.thread);
  if (request.stripPaths.length > 0) {
    await stitchStripPngs(request.stripPaths, request.pngPath);
  }
  const prepared = await prepareTracePng(
    request.stripPaths.length > 0 ? request.pngPath : request.sourcePath,
    request.pngPath,
    request.maxPixels,
    request.maxDecodePixels
  );
  if (hooks.isCancelled()) throw new Error("ยกเลิกแล้ว");
  const stat = await fs.promises.stat(request.pngPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("เตรียมไฟล์ PNG ไม่สำเร็จ");
  hooks.onProgress("trace");
  await spawnVtracer(request, hooks);
  if (hooks.isCancelled()) throw new Error("ยกเลิกแล้ว");
  hooks.onProgress("svg");
  const svg = insertCanvasFrame(await fs.promises.readFile(request.svgPath, "utf8"));
  await fs.promises.writeFile(request.svgPath, svg, "utf8");
  const summary = summarizeSvg(svg);
  return { width: prepared.width, height: prepared.height, resized: prepared.resized, pathCount: summary.pathCount };
}

function spawnVtracer(request: TraceRequest, hooks: TraceHooks): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [request.pngPath, request.svgPath, ...request.flags];
    const child = childProcess.spawn(request.binary, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    hooks.registerChild(() => {
      child.kill();
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8").slice(0, 4000 - stderr.length);
    });
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (hooks.isCancelled()) {
        reject(new Error("ยกเลิกแล้ว"));
      } else if (code === 0 && fs.existsSync(request.svgPath) && fs.statSync(request.svgPath).size > 0) {
        resolve();
      } else {
        reject(new Error("VTracer แปลงภาพไม่สำเร็จ" + (stderr ? ": " + stderr.trim() : "")));
      }
    });
  });
}

function writeThreadMarker(thread: TraceHooks["thread"]): void {
  const file = process.env["VECTOR_PANEL_TRACE_DEBUG"];
  if (!file || !thread) return;
  fs.appendFileSync(file, JSON.stringify({ threadId: thread.threadId, isMainThread: thread.isMainThread }) + "\n");
}

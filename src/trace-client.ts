import { createRequire } from "module";
import * as fs from "fs";
import { ImagePrepError } from "./image-prep";
import { runTraceJob, type TraceRequest, type TraceResult, type TraceStage } from "./trace-job";

type WorkerOutbound =
  | { type: "progress"; id: number; stage: TraceStage }
  | { type: "done"; id: number; result: TraceResult }
  | { type: "error"; id: number; message: string; code: "prep" | "cancel" | "trace" };

type WorkerModule = typeof import("worker_threads");

export class TraceRunner {
  private worker: import("worker_threads").Worker | null = null;
  private nextId = 1;
  private activeId = 0;
  private cancelled = false;
  private killInline: (() => void) | null = null;
  private allowWorker: boolean;

  constructor(private readonly workerPath: string) {
    this.allowWorker = process.env["VECTOR_PANEL_NO_WORKER"] !== "1";
  }

  cancel(): void {
    this.cancelled = true;
    if (this.killInline) this.killInline();
    if (this.worker) this.worker.postMessage({ type: "cancel", id: this.activeId });
  }

  dispose(): void {
    this.cancel();
    if (this.worker) {
      void this.worker.terminate();
      this.worker = null;
    }
  }

  run(request: TraceRequest, onProgress: (stage: TraceStage) => void): Promise<TraceResult> {
    this.cancelled = false;
    this.killInline = null;
    if (!this.allowWorker) return this.runInline(request, onProgress);
    return this.runInWorker(request, onProgress).catch((error: unknown) => {
      if (this.cancelled || !isStartupError(error)) throw error;
      this.allowWorker = false;
      if (this.worker) {
        void this.worker.terminate();
        this.worker = null;
      }
      return this.runInline(request, onProgress);
    });
  }

  private async runInWorker(request: TraceRequest, onProgress: (stage: TraceStage) => void): Promise<TraceResult> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    this.activeId = id;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        worker.off("message", onMessage);
        worker.off("error", onError);
        handler();
      };
      const onMessage = (message: WorkerOutbound) => {
        if (message.id !== id) return;
        if (message.type === "progress") {
          onProgress(message.stage);
          return;
        }
        if (message.type === "done") {
          finish(() => resolve(message.result));
          return;
        }
        finish(() => reject(errorFromWorker(message.message, message.code)));
      };
      const onError = (error: Error) => {
        finish(() => reject(error));
      };
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.postMessage({ type: "run", id, request });
    });
  }

  private ensureWorker(): import("worker_threads").Worker {
    if (this.worker) return this.worker;
    if (!fs.existsSync(this.workerPath)) throw new Error("ไม่พบ trace worker");
    const loaded = loadWorkerThreads();
    if (loaded === null) throw new Error("worker_threads ไม่พร้อม");
    this.worker = new loaded.Worker(this.workerPath);
    return this.worker;
  }

  private runInline(request: TraceRequest, onProgress: (stage: TraceStage) => void): Promise<TraceResult> {
    return runTraceJob(request, {
      onProgress,
      isCancelled: () => this.cancelled,
      registerChild: (kill) => {
        this.killInline = kill;
      },
      thread: { threadId: 0, isMainThread: true }
    });
  }
}

function loadWorkerThreads(): WorkerModule | null {
  try {
    const nodeRequire = createRequire(process.execPath);
    return nodeRequire("worker_threads") as WorkerModule;
  } catch {
    return null;
  }
}

function errorFromWorker(message: string, code: "prep" | "cancel" | "trace"): Error {
  if (code === "prep") return new ImagePrepError(message);
  return new Error(message);
}

function isStartupError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === "ไม่พบ trace worker" || error.message === "worker_threads ไม่พร้อม" || error.message.indexOf("Cannot find module") !== -1;
}

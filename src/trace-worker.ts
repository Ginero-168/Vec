import { isMainThread, parentPort, threadId } from "worker_threads";
import { ImagePrepError } from "./image-prep";
import { runTraceJob, type TraceRequest, type TraceResult, type TraceStage } from "./trace-job";

type RunMessage = { readonly type: "run"; readonly id: number; readonly request: TraceRequest };
type CancelMessage = { readonly type: "cancel"; readonly id: number };
type Inbound = RunMessage | CancelMessage;

type Outbound =
  | { type: "progress"; id: number; stage: TraceStage }
  | { type: "done"; id: number; result: TraceResult }
  | { type: "error"; id: number; message: string; code: "prep" | "cancel" | "trace" };

if (parentPort === null) throw new Error("trace-worker ต้องถูกเรียกเป็น worker");

const port = parentPort;
let activeId = 0;
let cancelled = false;
let killChild: (() => void) | null = null;

port.on("message", (message: Inbound) => {
  if (message.type === "cancel") {
    if (message.id === activeId) {
      cancelled = true;
      if (killChild) killChild();
    }
    return;
  }
  activeId = message.id;
  cancelled = false;
  killChild = null;
  void run(message);
});

async function run(message: RunMessage): Promise<void> {
  try {
    const result = await runTraceJob(message.request, {
      onProgress: (stage) => send({ type: "progress", id: message.id, stage }),
      isCancelled: () => cancelled && message.id === activeId,
      registerChild: (kill) => {
        killChild = kill;
      },
      thread: { threadId, isMainThread }
    });
    if (message.id !== activeId) return;
    send({ type: "done", id: message.id, result });
  } catch (error) {
    if (message.id !== activeId) return;
    const text = error instanceof Error ? error.message : String(error);
    const code = text === "ยกเลิกแล้ว" ? "cancel" : error instanceof ImagePrepError ? "prep" : "trace";
    send({ type: "error", id: message.id, message: text, code });
  }
}

function send(message: Outbound): void {
  port.postMessage(message);
}

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Stacking, TracePreset, TraceRequest } from "./trace.ts";
import { vtracerArguments } from "./trace.ts";

const root = process.cwd();
const port = 4191;
const cache = new Map<string, string>();
let generation = 0;
let active: ChildProcess | null = null;

const files: Readonly<Record<string, { readonly file: string; readonly type: string }>> = {
  "/": { file: "lab/index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "lab/index.html", type: "text/html; charset=utf-8" },
  "/lab.css": { file: "lab/lab.css", type: "text/css; charset=utf-8" },
  "/lab.js": { file: "lab/lab.js", type: "text/javascript; charset=utf-8" },
  "/fixture.png": { file: "fixtures/dock-icons.png", type: "image/png" }
};

function binary(): string {
  if (process.platform === "linux" && existsSync("/tmp/vtracer-linux")) return "/tmp/vtracer-linux";
  return path.join(root, "extension", "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
}

function send(response: ServerResponse, status: number, body: string, type = "application/json; charset=utf-8"): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 6_000_000) {
        reject(new Error("ภาพใหญ่เกินกว่าที่จะลองได้"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function asPreset(value: unknown): TracePreset | null {
  return value === "logo" || value === "icon" || value === "photo" || value === "poster" ? value : null;
}

function asStacking(value: unknown): Stacking | null {
  return value === "cutout" || value === "stacked" ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function requestFrom(body: unknown): TraceRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const preset = asPreset(record.preset);
  const stacking = asStacking(record.stacking);
  if (preset === null || stacking === null) return null;
  const palette = Array.isArray(record.palette) ? record.palette.filter((color): color is string => typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)).slice(0, 32) : undefined;
  const clustering = record.clustering === "watershed" || record.clustering === "off" ? record.clustering : undefined;
  return {
    preset,
    maxColors: asNumber(record.maxColors, 0),
    smoothness: asNumber(record.smoothness, 2),
    removeBackground: record.removeBackground === true,
    stacking,
    palette: palette !== undefined && palette.length > 0 ? palette : undefined,
    colorPrecision: asNumber(record.colorPrecision, preset === "photo" ? 8 : 6),
    filterSpeckle: asNumber(record.filterSpeckle, 0),
    clustering,
    watershedDetail: asNumber(record.watershedDetail, 128),
    simplify: asNumber(record.simplify, 0.4)
  };
}

function trace(png: Buffer, request: TraceRequest, ticket: number): Promise<string> {
  const key = createHash("sha256").update(png).update(JSON.stringify(request)).digest("hex");
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const directory = path.join(tmpdir(), "vector-panel-lab");
  mkdirSync(directory, { recursive: true });
  const pngPath = path.join(directory, key + ".png");
  const svgPath = path.join(directory, key + ".svg");
  writeFileSync(pngPath, png);
  if (active !== null) active.kill();
  return new Promise((resolve, reject) => {
    const child = spawn(binary(), vtracerArguments(pngPath, svgPath, request), { stdio: ["ignore", "ignore", "pipe"] });
    active = child;
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (ticket !== generation) {
        reject(new Error("cancelled"));
        return;
      }
      if (code !== 0 || !existsSync(svgPath)) {
        reject(new Error(stderr.trim() || "ลากเส้นไม่สำเร็จ"));
        return;
      }
      const svg = readFileSync(svgPath, "utf8");
      cache.set(key, svg);
      resolve(svg);
    });
  });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET") {
    const file = files[url.pathname];
    if (file === undefined) {
      send(response, 404, "ไม่พบหน้านี้", "text/plain; charset=utf-8");
      return;
    }
    response.writeHead(200, { "content-type": file.type, "cache-control": "no-store" });
    response.end(readFileSync(path.join(root, file.file)));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/trace") {
    const ticket = ++generation;
    void readBody(request)
      .then((raw) => {
        const parsed = JSON.parse(raw.toString("utf8")) as { readonly png?: unknown; readonly request?: unknown };
        const requestFields = requestFrom(parsed.request);
        if (typeof parsed.png !== "string" || requestFields === null) {
          send(response, 400, JSON.stringify({ error: "คำขอไม่ครบ" }));
          return null;
        }
        const png = Buffer.from(parsed.png, "base64");
        if (png.length < 8 || png[0] !== 137) {
          send(response, 400, JSON.stringify({ error: "ไฟล์ที่ส่งมาไม่ใช่ PNG" }));
          return null;
        }
        return trace(png, requestFields, ticket);
      })
      .then((svg) => {
        if (svg === null || ticket !== generation) {
          if (!response.headersSent && ticket !== generation) send(response, 409, JSON.stringify({ cancelled: true }));
          return;
        }
        send(response, 200, JSON.stringify({ svg }));
      })
      .catch((error: unknown) => {
        if (response.headersSent) return;
        const message = error instanceof Error ? error.message : "ลากเส้นไม่สำเร็จ";
        if (message === "cancelled" || ticket !== generation) {
          send(response, 409, JSON.stringify({ cancelled: true }));
          return;
        }
        send(response, 500, JSON.stringify({ error: message }));
      });
    return;
  }
  send(response, 404, "ไม่พบหน้านี้", "text/plain; charset=utf-8");
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write("ห้องทดลองพร้อมที่ http://127.0.0.1:" + String(port) + "\n");
});

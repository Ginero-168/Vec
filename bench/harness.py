#!/usr/bin/env python3
"""Measure the panel trace pipeline. Numbers come only from this process."""

import io
import json
import os
import subprocess
import time
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.filters import sobel
from skimage.metrics import peak_signal_noise_ratio, structural_similarity
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
FIXTURES = ROOT / "fixtures"
OUT = ROOT / "out"
CLI = ROOT / "trace-cli.js"
RUNS = OUT / "runs.jsonl"


def vtracer_binary() -> str:
    env = os.environ.get("VTRACER_BIN")
    if env:
        return env
    candidates = [ROOT / "bin" / "vtracer", Path("/tmp/vtracer-prefix/bin/vtracer")]
    for path in candidates:
        if path.exists():
            return str(path)
    raise SystemExit("vtracer binary not found; set VTRACER_BIN or build 1.0.0-alpha.4")


def composite(rgba: np.ndarray) -> np.ndarray:
    alpha = rgba[:, :, 3:4].astype(np.float32) / 255.0
    rgb = rgba[:, :, :3].astype(np.float32)
    return rgb * alpha + 255.0 * (1.0 - alpha)


def opaque_box(alpha: np.ndarray, pad: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > 200)
    if len(xs) == 0:
        return 0, 0, alpha.shape[1], alpha.shape[0]
    return (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(alpha.shape[1], int(xs.max()) + 1 + pad),
        min(alpha.shape[0], int(ys.max()) + 1 + pad),
    )


def area_reference(src: np.ndarray, max_edge: int = 2109) -> np.ndarray:
    height, width = src.shape[:2]
    scale = max_edge / max(height, width)
    if scale >= 1:
        return src
    dw = max(1, int(round(width * scale)))
    dh = max(1, int(round(height * scale)))
    small = Image.fromarray(src).resize((dw, dh), Image.Resampling.BOX)
    return np.array(small.resize((width, height), Image.Resampling.BILINEAR))


def edge_f1(left: np.ndarray, right: np.ndarray) -> tuple[float, float, float]:
    def luminance(rgb: np.ndarray) -> np.ndarray:
        return (0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]) / 255.0

    edges_l = sobel(luminance(left)) > 0.08
    edges_r = sobel(luminance(right)) > 0.08
    dil_l = ndimage.binary_dilation(edges_l)
    dil_r = ndimage.binary_dilation(edges_r)
    precision = float((edges_r & dil_l).sum()) / float(max(1, edges_r.sum()))
    recall = float((edges_l & dil_r).sum()) / float(max(1, edges_l.sum()))
    score = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
    return score, precision, recall


def quality(source_path: Path, svg_path: Path) -> dict[str, float]:
    src = np.array(Image.open(source_path).convert("RGBA"))
    png = cairosvg_png(svg_path, src.shape[1], src.shape[0])
    rend = np.array(Image.open(io.BytesIO(png)).convert("RGBA"))
    if rend.shape != src.shape:
        rend = np.array(Image.fromarray(rend).resize((src.shape[1], src.shape[0]), Image.Resampling.BILINEAR))
    x0, y0, x1, y1 = opaque_box(src[:, :, 3])
    src_c = composite(src[y0:y1, x0:x1])
    rend_c = composite(rend[y0:y1, x0:x1])
    src_u8 = np.clip(np.round(src_c), 0, 255).astype(np.uint8)
    rend_u8 = np.clip(np.round(rend_c), 0, 255).astype(np.uint8)
    ssim_source = float(structural_similarity(src_u8, rend_u8, data_range=255, channel_axis=-1))
    psnr_source = float(peak_signal_noise_ratio(src_u8, rend_u8, data_range=255))
    ref = area_reference(src, 2109)
    ref_c = composite(ref[y0:y1, x0:x1])
    ref_u8 = np.clip(np.round(ref_c), 0, 255).astype(np.uint8)
    ssim_structure = float(structural_similarity(ref_u8, rend_u8, data_range=255, channel_axis=-1))
    psnr_structure = float(peak_signal_noise_ratio(ref_u8, rend_u8, data_range=255))
    opaque = src[y0:y1, x0:x1, 3] > 200
    missing = opaque & (rend[y0:y1, x0:x1, 3] < 128)
    gap_ratio = float(missing.sum()) / float(max(1, opaque.sum()))
    err = np.max(np.abs(src_c.astype(np.int16) - rend_c.astype(np.int16)), axis=2)
    high = (err > 45) & opaque
    low = (err < 12) & opaque
    neighbor_low = np.zeros(high.shape, dtype=np.int16)
    for dy in (-2, 0, 2):
        for dx in (-2, 0, 2):
            if dx == 0 and dy == 0:
                continue
            neighbor_low += np.roll(np.roll(low, dy, axis=0), dx, axis=1)
    seam = high & (neighbor_low >= 5)
    seam_ratio = float(seam.sum()) / float(max(1, opaque.sum()))
    f1, precision, recall = edge_f1(ref_u8, rend_u8)
    return {
        "ssimSource": ssim_source,
        "psnrSource": psnr_source,
        "ssimStructure": ssim_structure,
        "psnrStructure": psnr_structure,
        "gapRatio": gap_ratio,
        "seamRatio": seam_ratio,
        "edgeF1": f1,
        "edgePrecision": precision,
        "edgeRecall": recall,
        "crop": [x0, y0, x1, y1],
    }


def cairosvg_png(svg_path: Path, width: int, height: int) -> bytes:
    import cairosvg

    return cairosvg.svg2png(url=str(svg_path), output_width=width, output_height=height)


def run_case(name: str, fixture: str, spec: dict, timeout: int = 180) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    case_dir = OUT / name
    case_dir.mkdir(parents=True, exist_ok=True)
    source = FIXTURES / fixture
    svg = case_dir / "result.svg"
    spec_path = case_dir / "spec.json"
    spec_path.write_text(json.dumps(spec))
    started = time.perf_counter()
    proc = subprocess.run(
        ["node", str(CLI), "--binary", vtracer_binary(), "--input", str(source), "--output", str(svg), "--spec", json.dumps(spec)],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    wall = time.perf_counter() - started
    payload: dict
    try:
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        payload = {"ok": False, "error": "unparseable cli output", "stdout": proc.stdout[-1000:], "stderr": proc.stderr[-1000:]}
    record: dict = {
        "name": name,
        "fixture": fixture,
        "spec": spec,
        "ok": bool(payload.get("ok")),
        "wallS": wall,
        "returnCode": proc.returncode,
        "trace": payload,
    }
    if record["ok"] and svg.exists():
        record["quality"] = quality(source, svg)
    else:
        record["stderr"] = proc.stderr[-2000:]
    with RUNS.open("a") as handle:
        handle.write(json.dumps(record) + "\n")
    summary = {
        "name": name,
        "ok": record["ok"],
        "wallS": round(wall, 3),
        "pipelineMs": payload.get("pipelineMs"),
        "vtracerMs": payload.get("vtracerMs"),
        "peakRssKb": payload.get("peakRssKb"),
        "nodes": payload.get("nodes"),
        "paths": payload.get("paths"),
        "corners45": payload.get("corners45"),
        "fills": payload.get("fills"),
        "paletteSize": payload.get("paletteSize"),
        "svgBytes": payload.get("svgBytes"),
        "working": [payload.get("workingWidth"), payload.get("workingHeight")],
    }
    if "quality" in record:
        summary.update({key: record["quality"][key] for key in ("ssimSource", "psnrSource", "ssimStructure", "edgeF1", "gapRatio", "seamRatio")})
    else:
        summary["error"] = payload.get("error")
    print(json.dumps(summary), flush=True)
    return record


def already(name: str) -> bool:
    if not RUNS.exists():
        return False
    for line in RUNS.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("name") == name and row.get("ok"):
            return True
    return False


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        raise SystemExit("usage: harness.py NAME FIXTURE SPEC_JSON")
    run_case(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]))

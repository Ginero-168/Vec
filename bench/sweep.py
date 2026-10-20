#!/usr/bin/env python3
"""Staged parameter sweep. Re-running skips cases already recorded as ok."""

import json
from pathlib import Path

from harness import already, run_case

ROOT = Path(__file__).resolve().parent


def spec(preset: str, max_colors: int, simplify: float, manual: bool = False, **overlay: object) -> dict:
    body: dict = {"preset": preset, "maxColors": max_colors, "simplify": simplify, "manualPalette": manual}
    if overlay:
        body["overlay"] = overlay
    return body


def cases() -> list[tuple[str, str, dict, int]]:
    photo = "balloon-photo.png"
    flat = "balloon-flat.png"
    planned: list[tuple[str, str, dict, int]] = []

    def add(name: str, fixture: str, body: dict, timeout: int = 180) -> None:
        planned.append((name, fixture, body, timeout))

    add("before-logo-photo", photo, spec("legacy-logo", 8, 1.5), 240)
    add("before-icon-photo", photo, spec("legacy-icon", 4, 1.5), 240)
    add("before-photo-photo", photo, spec("legacy-photo", 24, 1.5), 240)
    add("before-logo-flat", flat, spec("legacy-logo", 8, 1.5), 120)
    add("before-icon-flat", flat, spec("legacy-icon", 4, 1.5), 120)
    add("before-photo-flat", flat, spec("legacy-photo", 24, 1.5), 120)

    center = spec("balanced", 16, 1.4)
    add("center-photo", photo, center)
    add("center-flat", flat, center, 120)
    add("preset-fast-photo", photo, spec("fast", 12, 2.2))
    add("preset-balanced-photo", photo, spec("balanced", 16, 1.4))
    add("preset-detail-photo", photo, spec("detail", 24, 0.8), 240)
    add("preset-fast-flat", flat, spec("fast", 12, 2.2), 120)
    add("preset-balanced-flat", flat, spec("balanced", 16, 1.4), 120)
    add("preset-detail-flat", flat, spec("detail", 24, 0.8), 180)

    overlays = {
        "edge1200": {"maxEdge": 1200},
        "edge2800": {"maxEdge": 2800},
        "edge4200": {"maxEdge": 4200},
        "cutout": {"hierarchical": "cutout"},
        "denoise-off": {"denoise": "off", "denoisePasses": 0},
        "snap-off": {"snapPalette": False},
        "super2": {"supersample": 2},
        "colors8": {},
        "colors24": {},
        "manual16": {},
        "simp0.6": {},
        "simp2.4": {},
        "corner40": {"cornerThreshold": 40},
        "corner120": {"cornerThreshold": 120},
        "adapt-off": {"adaptive": False},
        "ellipse-off": {"ellipseFit": False},
        "weak1.4": {"weakScale": 1.4},
        "weak3.2": {"weakScale": 3.2},
        "grad40": {"weakGradient": 40},
        "grad160": {"weakGradient": 160},
        "speckle2": {"filterSpeckle": 2},
        "speckle8": {"filterSpeckle": 8},
        "prec5": {"colorPrecision": 5},
        "prec8": {"colorPrecision": 8},
        "step12": {"gradientStep": 12},
        "step48": {"gradientStep": 48},
        "photo-preset": {"vtracerPreset": "photo"},
        "optimize2": {"optimize": 2},
        "watershed": {"clustering": "watershed", "vtracerPreset": "none"},
        "knee": {"paletteRule": "knee"},
        "rmse015": {"paletteRmse": 0.015, "paletteCap": 28},
        "rmse030": {"paletteRmse": 0.03},
        "rmse040": {"paletteRmse": 0.04},
        "cap24": {"paletteCap": 24, "paletteRmse": 0.018},
    }
    # colors/simplify are top-level, not overlay.
    specials = {
        "colors8": spec("balanced", 8, 1.4),
        "colors24": spec("balanced", 24, 1.4),
        "manual16": spec("balanced", 16, 1.4, True),
        "simp0.6": spec("balanced", 16, 0.6),
        "simp2.4": spec("balanced", 16, 2.4),
    }
    for name, overlay in overlays.items():
        body = specials.get(name, spec("balanced", 16, 1.4, **overlay))
        timeout = 240 if name in {"edge4200", "super2", "watershed"} else 180
        add(f"ablate-{name}-photo", photo, body, timeout)

    add("ablate-super2-flat", flat, spec("balanced", 16, 1.4, supersample=2), 180)
    add("ablate-ellipse-off-flat", flat, spec("balanced", 16, 1.4, ellipseFit=False), 120)
    add("ablate-cutout-flat", flat, spec("balanced", 16, 1.4, hierarchical="cutout"), 120)
    return planned


def main() -> None:
    for name, fixture, body, timeout in cases():
        if already(name):
            print(json.dumps({"name": name, "skipped": True}), flush=True)
            continue
        try:
            run_case(name, fixture, body, timeout)
        except subprocess_timeout() as exc:
            from harness import RUNS

            RUNS.parent.mkdir(parents=True, exist_ok=True)
            with RUNS.open("a") as handle:
                handle.write(json.dumps({"name": name, "fixture": fixture, "spec": body, "ok": False, "error": str(exc)}) + "\n")
            print(json.dumps({"name": name, "ok": False, "error": str(exc)}), flush=True)


def subprocess_timeout() -> type[BaseException]:
    import subprocess

    return subprocess.TimeoutExpired


if __name__ == "__main__":
    main()

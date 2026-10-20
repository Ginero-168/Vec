#!/usr/bin/env python3
"""Second pass: combine the ablations that moved edge F1 or node count."""

from harness import already, run_case


def spec(simplify: float, **overlay: object) -> dict:
    return {
        "preset": "balanced",
        "maxColors": 16,
        "simplify": simplify,
        "manualPalette": False,
        "overlay": overlay,
    }


def main() -> None:
    photo = "balloon-photo.png"
    flat = "balloon-flat.png"
    jobs = [
        ("r2-smooth-2109", photo, spec(1.2, snapPalette=False, gradientStep=48, cornerThreshold=140, filterSpeckle=6, colorPrecision=8), 180),
        ("r2-smooth-2400", photo, spec(1.4, maxEdge=2400, snapPalette=False, gradientStep=48, cornerThreshold=160, filterSpeckle=6, colorPrecision=8), 180),
        ("r2-smooth-2800", photo, spec(1.6, maxEdge=2800, snapPalette=False, gradientStep=48, cornerThreshold=150, filterSpeckle=6, colorPrecision=8), 240),
        ("r2-corner180", photo, spec(2.0, snapPalette=False, gradientStep=48, cornerThreshold=180, filterSpeckle=8, colorPrecision=8), 180),
        ("r2-bands-2109", photo, spec(1.6, snapPalette=True, gradientStep=48, cornerThreshold=140, filterSpeckle=6), 180),
        ("r2-bands-2600", photo, spec(1.8, maxEdge=2600, snapPalette=True, gradientStep=48, cornerThreshold=130, filterSpeckle=6), 240),
        ("r2-full-snap", photo, spec(2.2, maxEdge=0, denoisePasses=1, snapPalette=True, gradientStep=48, cornerThreshold=120, filterSpeckle=8, colorPrecision=6), 240),
        ("r2-rmse8-smooth", photo, spec(1.6, paletteRmse=0.035, paletteCap=12, snapPalette=True, gradientStep=48, cornerThreshold=150, filterSpeckle=6), 180),
    ]
    flat_names = {"r2-smooth-2109", "r2-bands-2109", "r2-corner180", "r2-rmse8-smooth"}
    planned = list(jobs)
    for name, _, body, _ in jobs:
        if name in flat_names:
            planned.append((name + "-flat", flat, body, 180))
    for name, fixture, body, timeout in planned:
        if already(name):
            print({"name": name, "skipped": True})
            continue
        run_case(name, fixture, body, timeout)


if __name__ == "__main__":
    main()

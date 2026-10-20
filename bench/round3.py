#!/usr/bin/env python3
"""Third pass, rules fixed before the run.

Photo Balanced stays at Vectorizer's working size (long edge 2109), stacked,
16-color RMSE palette, hard snap, gradient step 48. Corner threshold is the
node-count lever. A run can become the Balanced preset only if the flat
fixture keeps structure SSIM >= 0.985 and edge F1 >= 0.90.

paletteMerge collapses OKLab centers closer than the given distance so the
dark outline is one fill instead of several near-blacks.
"""

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
    common = dict(snapPalette=True, gradientStep=48, filterSpeckle=5, colorPrecision=8)
    jobs = [
        ("r3-c100", photo, spec(1.6, cornerThreshold=100, **common), 180),
        ("r3-c120", photo, spec(1.8, cornerThreshold=120, **common), 180),
        ("r3-c160", photo, spec(2.2, cornerThreshold=160, **common), 180),
        ("r3-merge", photo, spec(1.8, cornerThreshold=120, paletteMerge=0.03, **common), 180),
        (
            "r3-fine",
            photo,
            spec(1.6, cornerThreshold=120, paletteCap=32, paletteRmse=0.012, filterSpeckle=4, colorPrecision=8, snapPalette=True, gradientStep=48),
            180,
        ),
        (
            "r3-fast",
            photo,
            spec(
                2.4,
                maxEdge=1400,
                cornerThreshold=120,
                filterSpeckle=8,
                colorPrecision=6,
                paletteRmse=0.035,
                paletteCap=12,
                denoisePasses=1,
                denoiseThreshold=36,
                snapPalette=True,
                gradientStep=48,
            ),
            180,
        ),
        (
            "r3-detail",
            photo,
            spec(
                1.0,
                maxEdge=2800,
                cornerThreshold=100,
                filterSpeckle=4,
                colorPrecision=8,
                paletteCap=24,
                paletteRmse=0.016,
                denoisePasses=1,
                denoiseThreshold=28,
                snapPalette=True,
                gradientStep=48,
            ),
            240,
        ),
    ]
    flat_names = {"r3-c100", "r3-c120", "r3-c160", "r3-merge", "r3-fast", "r3-detail"}
    planned = list(jobs)
    for name, _, body, _ in jobs:
        if name in flat_names:
            planned.append((name + "-flat", flat, body, 180))
    for name, fixture, body, timeout in planned:
        if already(name):
            print({"name": name, "skipped": True}, flush=True)
            continue
        run_case(name, fixture, body, timeout)


if __name__ == "__main__":
    main()

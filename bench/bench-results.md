# Trace engine bench

Measured with `bench/harness.py` on this machine (Linux, VTracer 1.0.0-alpha.4). Wall time is the harness subprocess. Pipeline time, peak RSS, path count, and node count come from the trace CLI. SSIM and edge F1 are computed by the harness after CairoSVG rasterizes the SVG back to the source size. Nothing in the Vectorizer.ai column was measured here.

Two fixtures:

- `bench/fixtures/balloon-photo.png` — the real balloon, 3508×4961 RGBA.
- `bench/fixtures/balloon-flat.png` — a flat-color balloon, 2000×2500 RGBA.

## Vectorizer bar for Balanced

The bar below is the competitor result as stated for this photo: downscale to 1491×2109, under 15 seconds, 16 palette colors, 71 corners, the dark outline kept as one uniform line, grain turned into 4–5 flat tones per stripe, no gaps, ropes and the treble clef kept, sparse long contours. Their SSIM, path count, node count, and memory were not provided.

Balanced is the shipped preset aimed at that bar. Two runs of the same spec produced the same SVG (97,572 bytes, 2,599 nodes).

| | Vectorizer.ai (stated) | Balanced, run A | Balanced, run B |
| --- | --- | --- | --- |
| Working size | 1491×2109 | 1491×2109 | 1491×2109 |
| Time | under 15s | pipeline 1.813s (wall 1.856s) | pipeline 1.952s (wall 1.995s) |
| Peak RSS | not stated | 83,328 KB (81.4 MB) | 83,752 KB (81.8 MB) |
| Palette | 16 | 16 colors, 12 fills | same SVG |
| Paths | sparse long contours | 183 | same SVG |
| Nodes | not stated | 2,599 | same SVG |
| Corners | 71 in their corner UI | 1,981 anchors with a turn of at least 45° | same SVG |
| SSIM vs source | not stated | 0.6177 | same SVG |
| SSIM vs 2109 structure | not stated | 0.8285 | same SVG |
| PSNR vs source | not stated | 20.34 dB | same SVG |
| Edge F1 | not stated | 0.6372 | same SVG |
| Gap ratio | none | 0.000537 | same SVG |

The 45° anchor count is not their corner counter. Balanced is well under the time bar and on the same working size and palette size. It is not on the corner-count bar: 1,981 sharp-ish anchors versus 71. In the stripe crop (x 1500–2400, y 1700–2700), each vertical quarter uses 2–4 palette colors above 4% of the pixels, not a consistent 4–5 tones per stripe. The dark outline is one black (`#000000` plus a near-black that snap does not visibly split). Gap ratio stays under 0.001 in stacked mode.

## Photo, before and after

Legacy rows are the previous panel presets on the full 3508×4961 image with no preprocess. Shipped rows are the confirm run. A repeat of Balanced and Detail produced the same SVG; the second pipeline time is in parentheses.

| Preset | Pipeline | Peak RSS | Paths | Nodes | Corners ≥45° | Fills | SSIM source | SSIM structure | Edge F1 | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Legacy logo | 25.111s | 660.0 MB | 29,054 | 444,547 | 397,783 | 8 | 0.6570 | 0.7964 | 0.4451 | 0.000031 |
| Legacy icon | 24.849s | 659.4 MB | 5,124 | 153,689 | 107,411 | 4 | 0.6261 | 0.7934 | 0.3996 | 0.000069 |
| Legacy photo | 23.955s | 641.6 MB | 1,846 | 55,983 | 39,398 | 22 | 0.6332 | 0.8401 | 0.7145 | 0.000098 |
| Fast | 1.817s (repeat 1.829s) | 81.4 MB | 183 | 2,784 | 2,217 | 12 | 0.6184 | 0.8293 | 0.6414 | 0.000542 |
| Balanced | 1.813s (repeat 1.952s) | 81.4 MB | 183 | 2,599 | 1,981 | 12 | 0.6177 | 0.8285 | 0.6372 | 0.000537 |
| Detail | 5.300s (repeat 5.743s) | 201.6 MB | 818 | 8,629 | 6,082 | 18 | 0.6234 | 0.8323 | 0.6850 | 0.000333 |

Against legacy photo, Balanced is about 13× shorter pipeline time, about 8× less peak RSS, and about 22× fewer nodes. Source SSIM drops by 0.0155 because the preset flattens grain. Structure SSIM drops by 0.0116. Edge F1 drops by 0.0772. Detail keeps more of that edge score (0.6850, short of legacy 0.7145 by 0.0295) at 8,629 nodes.

## Flat balloon

Tolerances were fixed in `bench/report.py` before the sweep: stay within 0.01 structure SSIM, 0.02 edge F1, 0.002 gap, and 0.03 source SSIM of legacy photo on the same fixture. Legacy photo on the flat image is structure SSIM 0.99243, edge F1 0.93065, source SSIM 0.99265, gap about 0. All three shipped presets pass that flat gate.

| Preset | Pipeline | Peak RSS | Paths | Nodes | SSIM source | SSIM structure | Edge F1 | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Legacy photo | 0.531s | 139.0 MB | 15 | 282 | 0.9927 | 0.9924 | 0.9307 | ~0 |
| Fast | 1.493s | 94.5 MB | 13 | 156 | 0.9878 | 0.9876 | 0.9249 | 0 |
| Balanced | 1.506s | 94.5 MB | 13 | 164 | 0.9876 | 0.9875 | 0.9199 | 0 |
| Detail | 1.720s | 132.6 MB | 9 | 172 | 0.9843 | 0.9841 | 0.9123 | ~0 |

## Why these three specs

`bench/report.py` still applies the pre-registered rule. On the photo, 1 of 65 runs is eligible: legacy photo only. Every preprocessed run misses edge F1 0.6945. The closest is Detail at 0.6850. Under that rule the picker would ship legacy photo as Fast, Balanced, and Detail (55,983 nodes, 24.0s, 642 MB), which misses the Vectorizer time and node bar.

The shipped presets are the measured specs that pass the flat-fixture rule and move the photo toward that bar:

- Fast — long edge 2109, 16-color RMSE cap, hard palette snap, gradient step 48, corner threshold 80, simplify 1.6, speckle 5. Fastest flat-eligible 16-color run, and the higher edge F1 of the two 2109 presets.
- Balanced — the same spec with corner threshold 90. Fewest nodes among flat-eligible 16-color runs at 1491×2109.
- Detail — long edge 2800, RMSE cap 24 (threshold 0.016), one denoise pass, corner threshold 130, simplify 1.4. Highest photo edge F1 among runs that still pass the flat rule.

Raising the corner threshold further (100 and above) cut more photo nodes but dropped the flat image below edge F1 0.9107. Cutting the long edge to 1600 or 1400 made the photo faster and lighter, and failed the flat edge gate. Merging palette colors closer than OKLab distance 0.03 did not change the SVG; the nearest 16-color pair on this image is 0.056, and those pairs are stripe tones rather than duplicate blacks.

Stacked paths are the no-gap choice. The cutout ablation on this photo raised the gap ratio from about 0.0005 to 0.00337.

## Preset knobs

| | Fast | Balanced | Detail |
| --- | --- | --- | --- |
| Long edge | 2109 | 2109 | 2800 |
| Palette cap / RMSE | 16 / 0.02 | 16 / 0.02 | 24 / 0.016 |
| Snap | on | on | on |
| Denoise | 2× gated, threshold 34 | 2× gated, threshold 34 | 1× gated, threshold 28 |
| Gradient step | 48 | 48 | 48 |
| Corner threshold | 80 | 90 | 130 |
| Simplify | 1.6 | 1.6 | 1.4 |
| Speckle | 5 | 5 | 5 |
| Color precision | 8 | 8 | 8 |
| Hierarchy | stacked | stacked | stacked |

The panel color slider is the palette cap when automatic palette is on. The smooth slider is VTracer simplify. Preset changes reset both.

Comparison crops of the photo (source, legacy photo, Fast, Balanced, Detail) are `balloon-stripes-compare.png` and `balloon-clef-compare.png`.

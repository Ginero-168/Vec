# Vector Panel: performance rounds (real Illustrator 30.8.2, MacBook Pro M2 8 GB, macOS 27, heavy swap)

Test image: `balloon.png`, 3508×4961 RGBA (hot-air balloon with grain texture). Test document: unsaved `Untitled-1` with three copies:
- VPBENCH: linked, 600 pt wide
- VPBENCH_EMB: embedded RasterItem
- VPBENCH_CLIP: linked copy inside a clipping group

Unless noted, settings are logo preset, 8 colours, simplify 1.5.

How it was measured: `~/vp-debug/tools/bench.py`. Illustrator is driven through AppleScript `do javascript` and loads the branch's `host.jsx`.
- **Main-thread time:** milliseconds measured inside ExtendScript for each host call.
- **Max block:** the longest single host call. Illustrator processes UI events between calls.
- **Hang:** new `HangMonitor: Hang detected` lines in AIGeneral.log.
- **Quality, on the SVG:** `q.py` rasterises it with resvg at 1200 px wide and compares it with the source. Metrics are SSIM, edge F1 (Sobel edges, 1 px tolerance), PSNR, mean absolute difference, transparent "gap" pixels inside the source alpha, and path and node counts.
- **Quality, in Illustrator:** `ai_ssim` comes from an Illustrator render of the imported result (source hidden, 144 ppi). It confirms registration.
- **Undo:** checked right after commit.
- **Image Trace reference:** Illustrator's default Image Trace on the same image, rendered at 144 ppi.

Raw data: `~/vp-debug/rounds.jsonl` (one JSON line per run).

## Rounds

Column key: MT = main-thread time, Max blk = longest single block.

| Round | Code | Source | MT total (ms) | Max blk (ms) | Total (s) | vtracer / worker RSS (MB) | AI ΔRSS (MB) | Hang | SSIM svg / AI | Edge F1 | PSNR | MAD | Gap % | Paths | Nodes | Commit | Undo |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| Image Trace (ref) | Illustrator | linked | 5400–5900 | 5400–5900 | 5.6 | – | – | – | 0.865 | 0.975 | 24.49 | 3.47 | 0 | 881 | 16,040 anchors | native | 1 |
| R0 baseline | tag `pre-offload-417e71b` (= main 417e71b) | linked | 4,589 (capture) | 4,589 | 7.5 | 139 | – | 0* | 0.861 / – | 0.857 | 25.53 | 4.82 | **5.79** | 730 | 18,625 | **fails** (uuid → wrapper group); the place-SVG path raises a modal "cannot be placed" alert | – |
| R2 PR #1 | `af401bc` (cursor/perf-mainthread-4112) | linked | 1,406 (capture) | 1,406 | 4.6 | 110 (worker) | – | 0 | 0.862 / – | 0.877 | 24.75 | 4.98 | **6.31** | 790 | 20,860 | **fails** (same uuid bug); place+embed SVG would raise the same modal alert | – |
| R3 | 482964d (+ linked fix) | linked | 383 | 381 | 7.1 | 244 | +86 | 0 | 0.858 / 0.856 | 0.930 | 23.61 | 5.58 | 0 | 356 | 45,339 | OK, 381 ms | 1 |
| R3 | 482964d | embedded | 3,945 | 3,665 | 9+ | 228 | – | 0 | 0.862 | 0.883 | 23.98 | 5.07 | 0 | 386 | 45,625 | OK | 1 |
| R4 | 23623c5 (colour precision) | linked | 96–432 | ≤429 | 1.4–2.6 | 73–152 | +12…+87 | 0 | 0.864–0.873 / 0.860–0.870 | 0.961–0.974 | 23.8–25.4 | 4.2–6.7 | 0 | 10–265 | 718–29,084 | OK | 1 |
| R4 | 23623c5 | embedded (one capture) | 3,993 | 3,816 | 5.7 | 110 | +253 | 0 | 0.867 / 0.865 | 0.948 | 24.88 | 5.34 | 0 | 93 | 6,940 | OK | 1 |
| **R5** | **272b256** (strip capture) | linked | 281 | 277 (commit) | **1.7** | 87 | +54 | 0 | 0.865 / 0.862 | 0.964 | 23.93 | 6.49 | 0 | 25 | **1,360** | OK, 277 ms | 1 |
| **R5** | 272b256 | embedded | 3,057 over 52 calls | **109** (strip median 54) | 12.2 † | 110 | +66 | 0 | 0.868 / 0.866 | 0.947 | 24.92 | 5.30 | 0 | 81 | 8,067 | OK, 304 ms | 1 |
| **R5** | 272b256 | clip group | 262 | 259 | 1.6 | 87 | +41 | 0 | 0.865 / 0.862 | 0.964 | 23.93 | 6.49 | 0 | 25 | 1,360 | OK | 1 |

\* R0 and R2 never reach a commit, so the modal-alert hang is not counted. In an earlier manual test, that alert blocked Illustrator's main thread for more than 600 s.

† Benchmark artefact. Every host call goes through `osascript`, which costs about 150 ms per round trip. Over 52 strip calls that adds roughly 7 s. Inside CEP, `evalScript` overhead is much smaller. The estimate is host 2.75 s + trace 1.0 s + stitch 0.2 s, about 4.5 s, but this is **not yet measured in the live panel**.

R4 settings grid (linked, 4 MP), with SVG SSIM / edge F1 / nodes:

| Colours / simplify | 2.0 (low detail) | 0.5 (high detail) |
|---|---|---|
| 4 | 0.865 / 0.961 / 718 | 0.869 / 0.970 / 1,298 |
| 8 | 0.864 / 0.961 / 1,301 | 0.868 / 0.968 / 2,324 |
| 16 | 0.868 / 0.964 / 26,653 | 0.873 / 0.974 / 29,084 |

Visual check (`cmp_cp.png`, order: source | colour-precision 4 | colour-precision 6 | Image Trace):
- **Precision 4:** clean, flat stripes.
- **Precision 6:** blotchy texture islands and ragged stripe edges. It has 10× more nodes and a lower edge F1 (0.935 vs 0.960).
- **Choice:** the colour-precision mapping uses 3, 4, 5 and 6 bits for ≤4, ≤10, ≤20 and >20 colours.

**Quality trade-off (honest):** the flat-colour default loses the soft shading.
- PSNR drops: 23.9 vs 25.5 in R0 and 24.5 for Image Trace.
- MAD rises: 6.5 vs 4.8 in R0 and 3.5 for Image Trace.
- SSIM rises (0.865 = Image Trace) and edge F1 rises (0.964 vs 0.857).
- Gaps go from 5.8% to 0, and anchors are 8.5% of Image Trace's count.
- If shading matters, 16 colours with simplify 0.5 gives PSNR 25.4, MAD 4.2, SSIM 0.873 and edge F1 0.974, but at 29k nodes.

## Rubric (DERIVED)

The repo has no explicit 10-point rubric. `Vector-App-complete-plan-th.md:9` only says "10/10 measured per image type". I derived the rubric below from `docs/roadmap-th.md` §7/§8 and the three-part definition of performance: smooth + speed/memory + quality. Each item is worth 1 point.

| # | Criterion (threshold) | R0 417e71b | R2 PR #1 af401bc | R3 482964d | R5 272b256 |
|---|---|---:|---:|---:|---:|
| S1 | Illustrator never blocked > 500 ms in one call (§8); 0 HangMonitor; no modal alerts | 0 | 0 | 0.5 (linked only) | **1** (max 109–304 ms, 0 hangs) |
| S2 | Panel: continuous phase progress, cancel in every phase, persistent errors | 0.5 | 0.5 | 0.5 | 0.5 (in code; live panel not loaded, see blockers) |
| P1 | Preview ≤ 5 s on a 4 MP image (§8) | 0 (7.5 s) | 1 (4.6 s) | 0 (7.1 s) | 0.5 (linked 1.7 s ✓; embedded est. 4.5 s, unmeasured in CEP) |
| P2 | Memory on 8 GB: helper ≤ 256 MB, Illustrator ΔRSS ≤ 100 MB | 1 | 1 | 1 | **1** (87–110 / +41…+66) |
| P3 | Apply: native editable paths, 1 Undo, registration (AI SSIM within 0.005 of SVG SSIM), commit ≤ 500 ms | 0 | 0 | 1 | **1** |
| Q1 | SSIM ≥ Image Trace − 0.01 and PSNR ≥ Image Trace − 1 dB | 1 | 1 | 1 | **1** (0.865, −0.56 dB) |
| Q2 | Edge F1 ≥ Image Trace − 0.02 and 0 % gaps | 0 | 0 | 0 | 0.5 (linked/clip 0.964 ✓; embedded 0.947 ✗) |
| Q3 | Median anchors ≤ 80 % of Image Trace | 0 | 0 | 0 | **1** (8.5 %; embedded 50 %) |
| R1 | Sources: linked, embedded, clip group, plain group, stable two-raster error, re-trace from a result group | 0 | 0 | 0.5 | **1** (all pass on an unsaved document; save/reopen not tested) |
| X1 | Outside this Mac: Windows build, signed/notarised ZXP, 3-designer A/B, 1,050-image corpus | 0 | 0 | 0 | 0 (needs Peerawat / other platforms) |
| | **Total** | **2.5** | **3.5** | **4.5** | **7.5** |

## PR #1 (af401bc) in real Illustrator: blockers found

1. **`VP_image` uses `getPageItemFromUuid` only.** In Illustrator 30 this returns a wrapper GroupItem for a PlacedItem, so `VP_commit` always throws "ต้นฉบับไม่ใช่ภาพ raster" (source is not a raster image). Apply never works. Fix: fall back to scanning placedItems/rasterItems by uuid (done on perf/offload-trace).
2. **The linked fast path is never taken.** `VP_isSimpleScale` requires D > 0, but an unrotated placed item has D < 0 (flipped y). Every linked image therefore goes through the 1.4 s in-document capture.
3. **Commit uses `placedItems.add` + `file = result.svg` + embed.** Illustrator 30 refuses to place SVG and shows a modal "cannot be placed" alert. That alert blocks the main thread until someone clicks OK, and is the likely real freeze. Fix: `GroupItems.createFromFile(svg)` plus an invisible canvas frame for registration, which takes 260–300 ms for the default output.
4. **vtracer flags are unchanged** (cutout, no speckle filter), leaving 6.3% gap pixels, 20.9k nodes and edge F1 0.877.
5. **Its in-document capture is a single `imageCapture`** of up to 4 MP: 1.4 s here, and up to about 4 s on embedded images. That exceeds the 500 ms limit. R5 strips stay ≤ 130 ms per call.

What PR #1 does well:
- Its in-document park beats a scratch document (no document switch, about 1 s cheaper).
- Its worker_threads decode keeps the panel responsive.

R5 adopts the park idea, split into strips.

## Best approach so far

perf/offload-trace @ 272b256 works best. It combines:
- the linked fast path, with the matrix fix;
- strip capture for embedded images;
- `createFromFile` import with a canvas frame;
- stacked vtracer with speckle 16 and colour precision chosen from the palette size.

PR #1's worker idea is complementary: the PNG stitch could move into a worker if the panel ever hitches.

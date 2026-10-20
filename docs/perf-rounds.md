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

---

# Live-panel rounds (2026-10-21 01:56–02:25, Bangkok time / UTC+7)

## How these rounds were measured

**Loading the panel.** The Vector Panel was loaded live from the existing CEP path `~/Library/Application Support/Adobe/CEP/extensions/com.peerawat.vectorpanel`, a symlink to `~/Desktop/Illustrator-Vector-Panel/extension`. CEP logs confirm it loads from there. The `/Library/.../Illustrator-Vector-Panel` folder is a whole-repo copy that CEP does not load as an extension; it was not touched.

**Driving it.** An untracked `extension/.debug` file (excluded via `.git/info/exclude`) opens a CDP port on 8099. Through that port:
- `tools/live.py` and `tools/live_generic.py` click the panel's own buttons (refresh, trace, apply, cancel).
- `live_generic.py` also instruments `CSInterface.evalScript` from outside, so it can time any build.

**What is recorded:**
- the round trip of every evalScript call, i.e. how long that call held Illustrator's main thread;
- the panel's worst event-loop stall;
- per-phase times;
- peak RSS of Illustrator, vtracer and CEPHtmlEngine;
- HangMonitor lines;
- SVG quality, plus an Illustrator render of the applied result;
- one-Undo check.

**Machine state.** Heavy swap throughout: 9.5–10.3 GB used of 10–11 GB. Apply times vary a lot because of it.

## Results

| Round | Build | Source | Preview (s) | Longest Illustrator call during preview (ms) | Apply call (ms) | Panel stall (ms) | AI ΔRSS (MB) | vtracer (MB) | Hang | SSIM svg / AI | Edge F1 svg / AI | PSNR | Gap % | Paths | Nodes | Undo |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---|
| R6/R8 | **9593032** (perf/offload-trace) | linked | 1.13–2.06 (n=8) | 2–24 | 99–1447 (median ≈300) | 82–297 | 5–118 | 40–87 | 0 | 0.865 / 0.862 | 0.964 / 0.957 | 23.93 | 0 | 25 | 1,360 | 1 ✓ |
| R6/R8/R9 | **9593032** | embedded | 4.26–5.11 (n=10, median ≈4.6) | 110–147 | 132–1677 (median ≈560) | 112–256 | 40–183 | 44–92 | 0 | 0.871 / 0.867 | **0.975 / 0.966** | 24.55 | 0 | 15 | **542** | 1 ✓ |
| R6 | 9593032 | clip group | 1.18 | 3 | 114 | 116 | 8 | 55 | 0 | 0.865 | 0.964 | 23.93 | 0 | 25 | 1,360 | 1 ✓ |
| R6 | 9593032 | embedded, 4 colours | 4.26 | 113 | 137 | 144 | 148 | 61 | 0 | 0.870 / 0.865 | 0.967 / 0.959 | 24.32 | 0 | 10 | 542 | 1 ✓ |
| R6 | 9593032 | embedded, 16 colours, simplify 0.5 | 4.40 | 110 | 286 | 146 | 142 | 69 | 0 | 0.873 / 0.873 | 0.987 / 0.985 | 24.51 | 0 | 21 | 1,784 | 1 ✓ |
| R7 | **PR #1 208945b** | linked | 2.74 | 5 | 338 | **955** | 127 | 110 | 0 | 0.869 / 0.867 | 0.958 / 0.958 | 24.96 | 0 | 178 | **18,588** | 1 ✓ |
| R7 | PR #1 208945b | embedded | 5.46 | 111 | 629 | 268 | 40 | 88 | 0 | 0.868 / 0.866 | 0.947 / 0.946 | 24.92 | 0 | 81 | 8,067 | 1 ✓ |
| R7 | PR #1 208945b | clip group | 6.56 (renders the clip in strips) | 137 | 960 | 383 | 105 | 87 | 0 | n/a (cropped) | n/a | n/a | n/a | 86 | 6,109 | 1 ✓ |

**Cancel, live, on 9593032:**
- During embedded capture (strip 19/50): status shows "ยกเลิกแล้ว" (cancelled) after 254 ms. The temporary layer is removed; the document is back to 1 layer / 5 items.
- During the linked trace: cancelled after 152 ms, and vtracer is killed.

**Apply profile** (ExtendScript-internal, warm): find ~40 ms, `createFromFile` ~30 ms, fit and translate ~1 ms, select ~65 ms, about 140 ms in total. The first/cold call took 1,360 ms (644 ms in find and 356 ms in import), consistent with paging under swap.

**CEP 12 has no worker_threads** (`require("worker_threads")` → "SharedArrayBuffer is not a constructor"):
- PR #1's worker always takes its inline fallback, which explains the 955 ms panel stall on linked images.
- My median filter runs in yielded 96-row slices instead.

## What changed in 9593032

- **Embedded captures get a 3×3 median filter.** Illustrator renders embedded rasters with little smoothing, so the grain survives. On the balloon, edge F1 rose from 0.947 to 0.975 and nodes fell from 8,067 to 542, with 0 gaps.
- **Not applied to linked images.** The sips resample is already smooth. On linked images the median filter only moves F1 from 0.954 to 0.959, which is not worth the decode cost, so it is not used. This also agrees with the sweep agent's hint that a median filter hurt the photo case.
- **Colour precision 4 bits for ≤10 colours.** 3 bits is fragile: on the median-filtered capture it collapses stripes (F1 0.80).
- **Timing ledger.** The panel prints a `[VectorPanel] metrics {...}` console line for every preview and apply.

A tried-and-reverted experiment: pipelining strip decode with the next capture gave no measurable gain (host time dominates), so it was reverted.

## Score (same derived rubric, now from live-panel evidence)

| # | Criterion | R5 272b256 (harness) | R5 re-scored with live evidence | **9593032 live** | PR #1 208945b live |
|---|---|---:|---:|---:|---:|
| S1 | No Illustrator call > 500 ms; 0 hangs; no modal | 1 | 0.5 | 0.5 (preview ≤147 ms; Apply median ≈300–560, worst 1.7 s under swap) | 0.5 (Apply up to 960 ms) |
| S2 | Continuous progress, cancel in every phase, persistent errors | 0.5 | 0.5 | **1** (live: "19/50 1.6 s" ticker; cancel 152–254 ms; red errors) | 0.5 (955 ms panel stall on linked) |
| P1 | Preview ≤ 5 s | 0.5 | 0.5 | 0.5 (linked ≤2.1 s; embedded median 4.6 s, worst 5.1 s) | 0 (embedded 5.5 s, clip 6.6 s) |
| P2 | helper ≤ 256 MB, Illustrator ΔRSS ≤ 100 MB | 1 | 0.5 | 0.5 (vtracer ≤92 MB; AI ΔRSS up to 183 MB on embedded) | 0.5 (CEP 549 MB peak) |
| P3 | Native paths, 1 Undo, registration, commit ≤ 500 ms | 1 | 0.5 | 0.5 (all ✓ except commit time under swap) | 0.5 |
| Q1 | SSIM ≥ IT − 0.01, PSNR ≥ IT − 1 dB | 1 | 1 | 1 | 1 |
| Q2 | Edge F1 ≥ IT − 0.02, 0 % gaps | 0.5 | 0.5 | **1** (0.964 linked / 0.975 embedded) | 0.5 (embedded 0.947) |
| Q3 | Anchors ≤ 80 % of IT | 1 | 1 | 1 (8.5 % / 3.4 %) | 0 (linked 116 %) |
| R1 | All source kinds, retrace | 1 | 1 | 1 | 0.5 (retrace not evidenced) |
| X1 | Windows / signed ZXP / designer A/B / corpus | 0 | 0 | 0 | 0 |
| | **Total** | 7.5 | 6.0 | **7.0** | **4.0** |

**Comparison.** Under the live rubric, the gain over the previous best is +1.0: from 6.0 (R5 re-scored live) to 7.0. The headline number moves from 7.5 to 7.0 only because live evidence is stricter than the harness. PR #1 @ 208945b now works in real Illustrator:
- no "ต้นฉบับไม่ใช่ภาพ raster" (source is not a raster image) error;
- no modal;
- native paths and one Undo.

It still loses to perf/offload-trace:
- 13.7× the nodes on linked images;
- edge F1 0.947 on embedded;
- slower embedded and clip previews;
- a 955 ms panel freeze on linked images.

perf/offload-trace remains primary.

## What still blocks 10

- **S1 / P3:** Apply still holds Illustrator up to 1.7 s on this swap-bound 8 GB Mac (warm internal time ~140 ms). Splitting Apply would break single Undo. Needs a less memory-starved machine to verify, or a smaller selection/redraw cost.
- **P1:** embedded preview is about 4.6 s, bounded by Illustrator's `imageCapture` (~3 s for 4 MP in strips). Getting under 5 s reliably needs either fewer pixels or a faster pixel source.
- **P2:** Illustrator RSS rises by up to 183 MB during embedded strip capture.
- **X1:** Windows build, signed/notarised ZXP, 3-designer A/B and the 1,050-image corpus all need Peerawat.

---

# Round 13 — PR #2 A/B, Apply laps, 3 MP embedded cap (3887e81, 2026-10-21 03:02 Bangkok)

Machine: M2 8 GB with swap at 10.1–10.5 GB of 11 GB (Chrome and LINE) for the whole round. Illustrator 30.8.2, CEP 12. Live panel loaded through the Desktop symlink; /Library was not touched.

## PR #2 (cursor/perf-engine-presets-a804 @ 6449209) A/B — no graft

The comparison used the same Mac, the same vtracer and the same q.py. Live runs used the PR #2 panel with `pr2_shim.jsx`, because PR #2 still ships main's clipboard/place host.

| Run | Preview | Panel freeze | Apply | SSIM | Edge F1 | PSNR | MAD | Nodes |
|---|---|---|---|---|---|---|---|---|
| PR #2 balanced, linked | 2.56 s | 1430 ms | 1032 ms | 0.869 | 0.947 | 24.95 | 4.41 | 2880 |
| PR #2 balanced, embedded | 1.10 s (+1357 ms one-shot capture block) | 1910 ms | 603 ms | 0.865 | 0.928 | 24.01 | 5.08 | 2792 |
| PR #2 fast, linked | 2.20 s | 1213 ms | – | 0.870 | 0.949 | 25.10 | 4.37 | 3065 |
| PR #2 detail, linked | 6.31 s | 1394 ms | – | 0.874 | 0.949 | 25.77 | 4.32 | 9871 |
| PR #2 detail, embedded | 1.34 s (+1439 ms block) | 1948 ms | – | 0.869 | 0.969 | 24.58 | 4.79 | 3753 |
| mine 3887e81, linked | 1.66 s | 192 ms | 429 ms | 0.865 | 0.964 | 23.93 | 6.49 | 1360 |
| mine 3887e81, embedded | 3.7–4.0 s (strips, max 105 ms) | 140–180 ms | 333–1174 ms | 0.869 | 0.974 | 24.24 | 6.35 | 510 |

- **Where PR #2 wins:** tonal fidelity (PSNR about +1 dB, MAD 4.4 vs 6.4), from its palette quantiser.
- **Where it loses:**
  - Edge F1 0.928–0.949, below the 0.955 floor.
  - 2–7× the nodes.
  - 1.2–1.9 s panel freezes: decode and palette run on the panel thread, and CEP 12 Node 17.7 has no worker_threads.
  - Its one-shot capture blocks Illustrator for about 1.4 s.
  - Detail preset on linked takes 6.3 s.
- **Graft test** (PR #2 palette + my vtracer flags): MAD improves to 3.8–4.4, but nodes rise to 5.8k–53k and trace time to 3.4–4 s. Rejected.
- **PR #2 bugs found on macOS:**
  1. The bench/CLI calls `/usr/bin/time -f`, which is GNU-only, so it fails on Mac.
  2. The SVG has no registration frame, so the applied art is misregistered (AI-render SSIM 0.70 in the shim combination).
  3. The host is still main's clipboard/place path, so the modal risk remains.
- **PR #2 live score: 4.5/10.**
  - S1 0
  - S2 0.5
  - P1 0.5
  - P2 0.5
  - P3 0.5
  - Q1 1
  - Q2 0
  - Q3 1
  - R1 0.5
  - X1 0

## Apply: cold vs warm (internal laps from VP_commit, CEP12 log)

| Case | find | import (createFromFile) | fit | select | total |
|---|---|---|---|---|---|
| R12 cold (first Apply after preview) | 0–7 | 282–933 | 2–3 | 135–652 | 594–1489 |
| R12 warm (repeat immediately) | 0 | 34–224 | 2 | 106–460 | ~140–700 |
| R13 embedded, first of round | 9 | 673 | 2 | 473 | 1174 |
| R13 linked | 0 | 206 | 2 | 210 | 429 |
| R13 embedded, repeat | 0 | 172 | 3 | 148 | 333 |

- **Code fix:** `find` was 40–644 ms. Taking the source from the current selection first cut it to 0–9 ms.
- **What remains:** `import` and `select` swing 5–6× between cold and warm with the same SVG, which is page-in under 10+ GB swap rather than code.
- **Not shipped:** skipping result selection could save about 100–200 ms warm. It was not shipped because:
  - users expect the result to be selected;
  - an external A/B probe of it stalled Illustrator for more than 30 s under swap, so I stopped probing.
- One Undo is kept on every run.

## Embedded capture budget sweep (strip capture + median + vtracer, balloon)

| Cap | ppi | Strips | Illustrator capture total | Max strip | SSIM | Edge F1 | PSNR | Nodes |
|---|---|---|---|---|---|---|---|---|
| 1 MP | 100 | 25 | 1020 ms | 73 | 0.844 | 0.903 ✗ | 21.51 | 620 |
| 2 MP | 142 | 35 | 1225 ms | 73 | 0.861 | 0.9615 | 23.38 | 481 |
| **3 MP (new)** | 174 | 43 | 2066–2271 ms | 97–105 | 0.869 | 0.9739 | 24.24 | 510 |
| 4 MP (9593032) | 200 | ~50 | 2855–3106 ms | 115–147 | 0.871 | 0.9745 | 24.55 | 542 |

## R13 live round (3887e81) vs main 417e71b and previous best 9593032

| Metric | main 417e71b | 9593032 (R8) | **3887e81 (R13)** |
|---|---|---|---|
| Embedded preview total | 5.5 s+ (harness) | 4.75–5.11 s | **3.66–3.98 s** |
| Embedded: Illustrator busy (sum / max call) | one-shot | 2855–3106 / 115–147 ms | **2178–2271 / 100–105 ms** |
| Linked preview total / Illustrator max | – | 1.6–2.1 s / ≤24 ms | 1.66 s / 3 ms |
| Panel stall (preview) | – | 112–297 ms | 140–192 ms |
| Apply commit (cold → warm) | modal risk | 505–1489 ms | 1174 → 333–429 ms |
| Hangs / modals | 4-min freeze, modal | 0 / 0 | 0 / 0 |
| Illustrator ΔRSS, embedded | – | 45–183 MB | 60–128 MB (76 preview-only) |
| vtracer / CEP peak RSS | – | ≤92 / ~300 MB | ≤63 / 319 MB |
| Embedded SSIM / F1 / PSNR / gaps / nodes | – | 0.871 / 0.9745 / 24.55 / 0 % / 542 | 0.869 / 0.9739 / 24.24 / 0 % / 510 |
| Linked SSIM / F1 / gaps / nodes | – | 0.865 / 0.964 / 0 % / 1360 | same (linked path unchanged) |
| AI-render SSIM / F1 (registration) | – | – | embedded 0.865 / 0.968; linked 0.862 / 0.957 |
| Single Undo | ✗ | ✓ | ✓ |

## Score (live rubric)

| Item | 9593032 | **3887e81** | Note |
|---|---|---|---|
| S1 | 0.5 | 0.5 | Preview max call 105 ms and 0 hangs. Apply is 333–429 ms warm but 1174 ms cold under swap. |
| S2 | 1 | 1 | |
| P1 | 0.5 | **1** | Embedded 3.7–4.0 s and linked 1.7 s, so reliably under 5 s. |
| P2 | 0.5 | 0.5 | Embedded Illustrator ΔRSS 60–128 MB, still sometimes over 100 MB (was up to 183). |
| P3 | 0.5 | 0.5 | Native paths, 1 Undo and registration all pass; cold commit is over 500 ms. |
| Q1 | 1 | 1 | |
| Q2 | 1 | 1 | |
| Q3 | 1 | 1 | |
| R1 | 1 | 1 | |
| X1 | 0 | 0 | |
| **Total** | 7.0 | **7.5** | |

Swap-normalised (warm Apply, machine paging excluded), S1 and P3 would read 1, giving about 8.5.

## What still blocks 10

- **S1 / P3:** cold Apply. `createFromFile` plus selection pages in at 0.7–1.2 s under 10 GB swap. Warm runs are ≤430 ms. Single Undo forbids splitting Apply, so this needs a machine that isn't paging, or fewer DOM objects.
- **P2:** Illustrator ΔRSS during embedded capture is 60–128 MB. It is noisy under swap. Going below 3 MP costs edge F1.
- **X1:** Windows build, signed ZXP, designer A/B and the 1,050-image corpus all need Peerawat.

Screenshots (copied to ~/Desktop/vp-debug-out/):
- r13_panel_embedded_preview.png
- r13_panel_embedded_preview_bottom.png
- r13_embedded_preview.png (the Illustrator window; the Vector Panel tab is behind Rocket Launcher)

---

# Round 14: Apply import/selection, capture memory, live.py warm Apply (6d7b3ac, 2026-10-21 03:30 Bangkok)

Machine: swap was 10.3–11.45 GB used for the whole round, and macOS grew the swap file from 11 GB to 12 GB mid-round. A fresh test doc was built: placing a second linked PNG took ~110 s under swap, so `setup.py` now places once and duplicates.

## What was tried

| Idea | Result | Kept? |
|---|---|---|
| Merge same-colour paths into compound paths before import | vtracer `stacked` output never has two adjacent paths with the same fill (checked on 8 live SVGs: 10–25 paths each, 0 merges). Merging non-adjacent ones would change stacking order and therefore rendering. There are no invisible or tiny paths either (filter-speckle 16). | No: no effect |
| `doc.selection = [holder]` instead of deselect source + select result | A/B on 4+4 runs, interleaved. Cold select: once 166–568 ms vs pair 124–836 ms. Warm: once 106–428 vs pair 109–322. No difference beyond paging noise. | No: reverted to the simple form |
| Release the capture layer right after the last strip (before median/stitch), and free strip buffers after the join | Embedded Illustrator RSS peak growth 8–85 MB over 7 runs (R13: 60–128 MB) | **Yes** (6d7b3ac) |
| Separate `note` lap in VP_commit | `note` takes 0–1 ms, so the `select` lap is the selection itself | Yes |
| Skip selection | Not retried (it stalled Illustrator >30 s in R13) | – |

## Apply: cold vs warm (internal VP_commit laps; warm = the exact same commit replayed immediately after Undo)

| Run | Cold total (import / select) | Warm total (import / select) | Swap used |
|---|---|---|---|
| embedded ×6 | 301–1277 ms (164–520 / 124–568) | 147–984 ms (33–429 / 106–524) | 10.3–11.4 GB |
| linked ×6 | 379–3443 ms (214–1750 / 145–836) | 158–265 ms (34–101 / 120–182) | 10.5–11.45 GB |

- **Warm import** is 33–49 ms in most runs, so the SVG itself is cheap to parse.
- **Cold import** is 5–40× slower for the same file, and the 3443 ms outlier happened while swap jumped from 10.5 to 11.3 GB.
- **Warm runs can also exceed 500 ms.** The 535 ms and 984 ms warm runs came right after swap grew.
- Selection costs 100–180 ms even warm.
- **Conclusion:** what is left of Apply cost is Illustrator paging plus its own selection bookkeeping. Single Undo rules out splitting it, so there is no code lever left in the commit step.

## R14 vs main 417e71b and 3887e81

| Metric | main 417e71b | 3887e81 (R13) | **6d7b3ac (R14)** |
|---|---|---|---|
| Embedded preview | 5.5 s+ | 3.66–3.98 s | 3.45–3.97 s |
| Illustrator busy, embedded (sum / max call) | one-shot capture | 2.18–2.27 s / 105 ms | ~2.3 s / 103 ms |
| Linked preview | – | 1.66 s | 1.41–1.66 s |
| Panel stall | – | 140–192 ms | 132–183 ms |
| Apply cold → warm (median) | modal risk | 1174 → 333–429 ms | cold ~620 ms, warm ~200 ms (ranges above) |
| Hangs / modals | 4-min freeze, modal | 0 / 0 | 0 / 0 (11 runs) |
| Illustrator ΔRSS, embedded (peak) | – | 60–128 MB | **8–85 MB** |
| Illustrator ΔRSS, linked (peak) | – | 14 MB | ≤36 MB |
| vtracer peak | – | ≤63 MB | ≤63 MB |
| Embedded SSIM / F1 / PSNR / gaps / nodes | – | 0.869 / 0.9739 / 24.24 / 0 % / 510 | same |
| Linked SSIM / F1 / gaps / nodes | – | 0.865 / 0.964 / 0 % / 1360 | same |
| AI-render SSIM / F1 (registration) | – | emb 0.865 / 0.968; linked 0.862 / 0.957 | same |
| Single Undo | ✗ | ✓ | ✓ (every run) |

The early R14 "linked" A/B runs actually traced the clipped duplicate, which had inherited the name VPBENCH; their AI-render F1 of 0 is a test-doc artefact. Renaming it to VPBENCH_CLIP_INNER fixed this, and the final runs read 0.862 / 0.957.

## Tools

`tools/live.py` has a working warm-Apply step. It records the panel's own VP_commit call, replays it against a kept SVG copy right after Undo (60 s bound), and then undoes again. Every AppleEvent is capped at 90 s, and the run aborts if a ping takes 5 s or more.

## Score

| Item | R13 | **R14** | Note |
|---|---|---|---|
| S1 | 0.5 | 0.5 | Preview max call 103 ms and 0 hangs. Apply holds Illustrator 0.3–3.4 s cold, from paging. |
| S2 | 1 | 1 | |
| P1 | 1 | 1 | |
| P2 | 0.5 | **1** | Embedded ΔRSS ≤85 MB in all 7 runs; helper ≤63 MB. Caveat: RSS under heavy swap undercounts. |
| P3 | 0.5 | 0.5 | Paths, 1 Undo and registration all pass. Warm commit is usually ≤265 ms (2 of 12 runs reached 535–984 ms, after swap grew); cold exceeds 500 ms under swap. |
| Q1–Q3, R1 | 4 | 4 | |
| X1 | 0 | 0 | |
| **Total** | 7.5 | **8.0** | Swap-normalised (warm Apply): 9.0 |

## Stopping the loop

The remaining gaps are:
- **S1 and P3:** Apply under paging, which needs a Mac that isn't 11+ GB into swap to verify, or a non-undoable split that the single-Undo requirement forbids.
- **X1:** needs Peerawat.

Per instructions, the loop stops here.

Screenshots:
- ~/Desktop/vp-debug-out/r14_panel_embedded_preview.png
- ~/Desktop/vp-debug-out/r14_panel_embedded_preview_bottom.png

#!/usr/bin/env python3
"""Pareto front and Fast/Balanced/Detail selection from measured runs.

Rules were fixed before reading the sweep:
- A run is eligible against the legacy-photo result on the same fixture when
  structure SSIM stays within 0.01, edge F1 within 0.02, gap ratio within
  0.002, and source SSIM within 0.03. If legacy-photo failed, the absolute
  floors are structure SSIM >= 0.75, edge F1 >= 0.35, gap ratio <= 0.01.
- Speed that misses those floors is discarded.
- Detail: best structure SSIM among eligible runs at or under 30s.
- Fast: lowest pipeline time among eligible runs within 0.02 structure SSIM
  and 0.03 edge F1 of Detail, with gap ratio <= 0.01.
- Balanced: fewest nodes among eligible runs at or under 15s and within
  0.015 structure SSIM of Detail. Ties break toward 16 fills, then time.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNS = ROOT / "out" / "runs.jsonl"


def load() -> list[dict]:
    rows = []
    if not RUNS.exists():
        return rows
    for line in RUNS.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def metric(row: dict) -> dict | None:
    if not row.get("ok"):
        return None
    trace = row["trace"]
    quality = row["quality"]
    return {
        "name": row["name"],
        "fixture": row["fixture"],
        "timeS": trace["pipelineMs"] / 1000,
        "rssMb": trace["peakRssKb"] / 1024,
        "nodes": trace["nodes"],
        "paths": trace["paths"],
        "corners": trace["corners45"],
        "fills": trace["fills"],
        "svgKb": trace["svgBytes"] / 1024,
        "ssimSource": quality["ssimSource"],
        "psnrSource": quality["psnrSource"],
        "ssimStructure": quality["ssimStructure"],
        "edgeF1": quality["edgeF1"],
        "gapRatio": quality["gapRatio"],
        "seamRatio": quality["seamRatio"],
        "resolved": trace.get("resolved"),
        "row": row,
    }


def eligible(row: dict, legacy: dict | None) -> bool:
    if legacy is None:
        return row["ssimStructure"] >= 0.75 and row["edgeF1"] >= 0.35 and row["gapRatio"] <= 0.01
    return (
        row["ssimStructure"] >= legacy["ssimStructure"] - 0.01
        and row["edgeF1"] >= legacy["edgeF1"] - 0.02
        and row["gapRatio"] <= legacy["gapRatio"] + 0.002
        and row["ssimSource"] >= legacy["ssimSource"] - 0.03
    )


def dominates(a: dict, b: dict) -> bool:
    keys_min = ("timeS", "rssMb", "nodes", "gapRatio")
    better = False
    for key in keys_min:
        if a[key] > b[key] + 1e-12:
            return False
        if a[key] < b[key] - 1e-12:
            better = True
    if a["ssimStructure"] < b["ssimStructure"] - 1e-12:
        return False
    if a["ssimStructure"] > b["ssimStructure"] + 1e-12:
        better = True
    return better


def pareto(rows: list[dict]) -> list[dict]:
    front = []
    for row in rows:
        if any(dominates(other, row) for other in rows if other is not row):
            continue
        front.append(row)
    return sorted(front, key=lambda row: row["timeS"])


def pick(rows: list[dict]) -> dict[str, dict]:
    under_detail = [row for row in rows if row["timeS"] <= 30] or rows
    detail = max(under_detail, key=lambda row: (row["ssimStructure"], row["edgeF1"], -row["nodes"]))
    fast_pool = [
        row for row in rows
        if row["ssimStructure"] >= detail["ssimStructure"] - 0.02
        and row["edgeF1"] >= detail["edgeF1"] - 0.03
        and row["gapRatio"] <= 0.01
    ] or rows
    fast = min(fast_pool, key=lambda row: (row["timeS"], row["nodes"]))
    balanced_pool = [
        row for row in rows
        if row["timeS"] <= 15 and row["ssimStructure"] >= detail["ssimStructure"] - 0.015
    ]
    if not balanced_pool:
        balanced_pool = [row for row in rows if row["ssimStructure"] >= detail["ssimStructure"] - 0.015] or rows
    balanced = min(balanced_pool, key=lambda row: (row["nodes"], abs(row["fills"] - 16), row["timeS"]))
    return {"fast": fast, "balanced": balanced, "detail": detail}


def main() -> None:
    grouped: dict[str, list[dict]] = {}
    for raw in load():
        item = metric(raw)
        if item is None:
            print(f"FAILED {raw.get('name')}: {raw.get('error') or raw.get('trace', {}).get('error')}")
            continue
        grouped.setdefault(item["fixture"], []).append(item)
    for fixture, rows in grouped.items():
        legacy = next((row for row in rows if row["name"].startswith("before-photo")), None)
        good = [row for row in rows if eligible(row, legacy)]
        print(f"\n== {fixture} eligible {len(good)}/{len(rows)} ==")
        front = pareto(good)
        print(f"pareto {len(front)}")
        for row in front:
            print(
                f"  {row['name']}: {row['timeS']:.3f}s rss {row['rssMb']:.1f}MB nodes {row['nodes']} "
                f"paths {row['paths']} corners {row['corners']} fills {row['fills']} "
                f"ssim {row['ssimSource']:.4f}/{row['ssimStructure']:.4f} f1 {row['edgeF1']:.4f} gap {row['gapRatio']:.6f}"
            )
        if good:
            chosen = pick(good)
            print("chosen")
            for name, row in chosen.items():
                print(f"  {name}: {row['name']}")


if __name__ == "__main__":
    main()

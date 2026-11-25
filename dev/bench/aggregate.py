"""Medians over reps, one markdown table per phase.

    python3 dev/bench/aggregate.py <results dir> > summary.md

Reads every runner.mjs result in the directory, skips (and names on stderr) the runs that did not
finish, and writes <results dir>-summary.json beside it. Variants sort by runtime, base first.
"""

import glob
import json
import os
import statistics
import sys

PHASES = [
    "home-idle",
    "home-paused",
    "home-scroll",
    "library-scroll",
    "detail-cycle",
    "search-type",
    "player-controls",
    "player-watching",
    "player-scrub",
]


def median(xs):
    return statistics.median(xs) if xs else None


def fmt(x, digits=0):
    return "-" if x is None else f"{x:.{digits}f}"


def load(directory):
    runs = {}
    for path in sorted(glob.glob(os.path.join(directory, "*.json"))):
        with open(path) as f:
            result = json.load(f)
        if result.get("end") != "done":
            print("incomplete:", os.path.basename(path), result.get("end"), file=sys.stderr)
            continue
        for phase in result["phases"]:
            runs.setdefault((result["name"], phase["phase"]), []).append(phase)
    return runs


def row(phases):
    cpu = [p["cpu_pct"] for p in phases]
    return {
        "n": len(phases),
        "cpu": median(cpu),
        "cpu_min": min(cpu),
        "cpu_max": max(cpu),
        "display": median([p["x_pct"] for p in phases]),
        "fps": median([p["fps"] for p in phases if p.get("fps") is not None]),
        "long": median([p["long"] for p in phases if p.get("long") is not None]),
        "pss": median([p["pss_mb"] for p in phases]),
    }


def main():
    directory = sys.argv[1]
    runs = load(directory)
    variants = sorted({name for name, _ in runs}, key=lambda v: (v.split("-")[0], "-" in v, v))
    summary = {}
    for phase in PHASES:
        print(f"\n### {phase}\n")
        print("| variant | n | CPU % (min–max) | display % | fps | long frames | PSS MB |")
        print("|---|---|---|---|---|---|---|")
        for variant in variants:
            phases = runs.get((variant, phase))
            if not phases:
                continue
            r = row(phases)
            summary.setdefault(phase, {})[variant] = r
            print(
                f"| {variant} | {r['n']} | {fmt(r['cpu'])} ({fmt(r['cpu_min'])}–{fmt(r['cpu_max'])})"
                f" | {fmt(r['display'])} | {fmt(r['fps'], 1)} | {fmt(r['long'])} | {fmt(r['pss'])} |"
            )
    with open(directory.rstrip("/") + "-summary.json", "w") as f:
        json.dump(summary, f, indent=1)


if __name__ == "__main__":
    main()

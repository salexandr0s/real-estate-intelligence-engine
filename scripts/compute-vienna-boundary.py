#!/usr/bin/env python3
"""
Compute the Vienna city boundary by unioning all 23 district polygons.

Reads:  apps/macos/RealEstateIntel/Resources/vienna-districts.geojson
Writes: apps/macos/RealEstateIntel/Resources/vienna-boundary.geojson
"""

import json
import os
import sys

from shapely.geometry import shape, mapping
from shapely.ops import unary_union

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

INPUT_PATH = os.path.join(
    PROJECT_ROOT,
    "apps", "macos", "RealEstateIntel", "Resources", "vienna-districts.geojson",
)
OUTPUT_PATH = os.path.join(
    PROJECT_ROOT,
    "apps", "macos", "RealEstateIntel", "Resources", "vienna-boundary.geojson",
)


def main() -> None:
    if not os.path.isfile(INPUT_PATH):
        print(f"ERROR: Input file not found: {INPUT_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        districts = json.load(f)

    features = districts.get("features", [])
    if not features:
        print("ERROR: No features found in the input GeoJSON.", file=sys.stderr)
        sys.exit(1)

    print(f"Loaded {len(features)} district polygons.")

    polygons = [shape(feat["geometry"]) for feat in features]

    invalid = [i for i, p in enumerate(polygons) if not p.is_valid]
    if invalid:
        print(f"Warning: {len(invalid)} invalid geometries detected, attempting buffer(0) repair.")
        polygons = [p.buffer(0) if not p.is_valid else p for p in polygons]

    boundary = unary_union(polygons)
    print(f"Union result geometry type: {boundary.geom_type}")

    output = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "Vienna",
                    "name_de": "Wien",
                },
                "geometry": mapping(boundary),
            }
        ],
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    file_size = os.path.getsize(OUTPUT_PATH)
    print(f"Wrote {OUTPUT_PATH} ({file_size:,} bytes)")


if __name__ == "__main__":
    main()

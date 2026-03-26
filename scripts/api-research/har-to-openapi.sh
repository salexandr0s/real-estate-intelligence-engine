#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <har-or-flow-file> [output-prefix]" >&2
  exit 1
fi

INPUT="$1"
OUTPUT_PREFIX="${2:-api-research}"

python3 -m mitmproxy2swagger \
  -i "$INPUT" \
  -o "${OUTPUT_PREFIX}.yaml" \
  -p https://example.invalid

echo "Wrote ${OUTPUT_PREFIX}.yaml"

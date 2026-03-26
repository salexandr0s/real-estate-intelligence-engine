#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

build_log="$(mktemp -t immoradar-lint-staged-swift.XXXXXX.log)"
trap 'rm -f "$build_log"' EXIT

if ! xcodebuild \
  -project apps/macos/ImmoRadar.xcodeproj \
  -scheme ImmoRadar \
  -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  build >"$build_log" 2>&1; then
  cat "$build_log"
  exit 1
fi

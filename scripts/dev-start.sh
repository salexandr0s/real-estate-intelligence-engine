#!/usr/bin/env bash
set -euo pipefail

echo "Starting API server..."
npx tsx apps/api/src/main.ts

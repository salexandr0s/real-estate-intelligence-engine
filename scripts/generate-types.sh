#!/usr/bin/env bash
# Generate TypeScript and Swift types from the OpenAPI spec.
# Requires: the API server to be running (for spec extraction),
# or a static openapi.json file.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Generating TypeScript types ==="
# If openapi-typescript is installed:
# npx openapi-typescript http://localhost:8080/docs/json -o "$PROJECT_ROOT/packages/contracts/src/generated/api-types.ts"
echo "TODO: Install openapi-typescript and run against /docs/json endpoint"
echo "  npm install -D openapi-typescript"
echo "  npx openapi-typescript http://localhost:8080/docs/json -o packages/contracts/src/generated/api-types.ts"

echo ""
echo "=== Generating Swift types ==="
# If swift-openapi-generator is installed:
# swift package plugin generate-code-from-openapi --config openapi-generator-config.yaml
echo "TODO: Add swift-openapi-generator to the Xcode project"
echo "  See: https://github.com/apple/swift-openapi-generator"

echo ""
echo "Type generation is a manual step until the OpenAPI spec is finalized."
echo "Run the API server first, then use the URLs above."

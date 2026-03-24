#!/usr/bin/env bash
# Apply lifecycle policy to MinIO bucket.
# Requires: mc (MinIO client) configured with alias 'immoradar'
set -euo pipefail

BUCKET="${S3_BUCKET:-immoradar}"
ALIAS="${MINIO_ALIAS:-immoradar}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Applying lifecycle policy to ${ALIAS}/${BUCKET}..."
mc ilm import "${ALIAS}/${BUCKET}" < "$SCRIPT_DIR/lifecycle-policy.json"
echo "Done. Current lifecycle rules:"
mc ilm ls "${ALIAS}/${BUCKET}"

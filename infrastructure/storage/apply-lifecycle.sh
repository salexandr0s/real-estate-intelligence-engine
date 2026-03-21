#!/usr/bin/env bash
# Apply lifecycle policy to MinIO bucket.
# Requires: mc (MinIO client) configured with alias 'rei'
set -euo pipefail

BUCKET="${S3_BUCKET:-real-estate-intel}"
ALIAS="${MINIO_ALIAS:-rei}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Applying lifecycle policy to ${ALIAS}/${BUCKET}..."
mc ilm import "${ALIAS}/${BUCKET}" < "$SCRIPT_DIR/lifecycle-policy.json"
echo "Done. Current lifecycle rules:"
mc ilm ls "${ALIAS}/${BUCKET}"

#!/usr/bin/env bash
set -euo pipefail

: "${IMMORADAR_RUNTIME_HOME:?IMMORADAR_RUNTIME_HOME is required}"
: "${IMMORADAR_REDIS_PORT:?IMMORADAR_REDIS_PORT is required}"

RUNTIME_ROOT="${IMMORADAR_RUNTIME_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BIN_DIR="${IMMORADAR_REDIS_BIN_DIR:-$RUNTIME_ROOT/infra/redis/bin}"

if [[ ! -x "$BIN_DIR/redis-server" ]]; then
  echo "Redis not found in $BIN_DIR. Install it with: brew install redis" >&2
  exit 1
fi

# An older Redis can refuse to load a file written by a newer one, and Debug and Release may run
# different versions. Queue data can always be rebuilt, so each version keeps its own folder.
REDIS_VERSION="$("$BIN_DIR/redis-server" --version | sed -E 's/.* v=([0-9]+\.[0-9]+).*/\1/')"
DATA_DIR="$IMMORADAR_RUNTIME_HOME/redis/$REDIS_VERSION"

mkdir -p "$DATA_DIR"

exec "$BIN_DIR/redis-server" \
  --bind 127.0.0.1 \
  --port "$IMMORADAR_REDIS_PORT" \
  --dir "$DATA_DIR" \
  --dbfilename dump.rdb \
  --appendonly yes \
  --appenddirname appendonly

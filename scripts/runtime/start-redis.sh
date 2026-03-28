#!/usr/bin/env bash
set -euo pipefail

: "${IMMORADAR_RUNTIME_HOME:?IMMORADAR_RUNTIME_HOME is required}"
: "${IMMORADAR_REDIS_PORT:?IMMORADAR_REDIS_PORT is required}"

RUNTIME_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$RUNTIME_ROOT/infra/redis/bin"
DATA_DIR="$IMMORADAR_RUNTIME_HOME/redis"

mkdir -p "$DATA_DIR"

exec "$BIN_DIR/redis-server" \
  --bind 127.0.0.1 \
  --port "$IMMORADAR_REDIS_PORT" \
  --dir "$DATA_DIR" \
  --dbfilename dump.rdb \
  --appendonly yes \
  --appenddirname appendonly

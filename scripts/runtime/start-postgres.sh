#!/usr/bin/env bash
set -euo pipefail

: "${IMMORADAR_RUNTIME_HOME:?IMMORADAR_RUNTIME_HOME is required}"
: "${IMMORADAR_POSTGRES_PORT:?IMMORADAR_POSTGRES_PORT is required}"

RUNTIME_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$RUNTIME_ROOT/infra/postgres/bin"
PKG_LIB_DIR="$RUNTIME_ROOT/infra/postgres/lib/postgresql"
SHARE_DIR="$RUNTIME_ROOT/infra/postgres/share/postgresql"
DATA_DIR="$IMMORADAR_RUNTIME_HOME/postgres/data"
LOG_DIR="$IMMORADAR_RUNTIME_HOME/logs"

mkdir -p "$DATA_DIR" "$LOG_DIR"

if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
  "$BIN_DIR/initdb" \
    --username=postgres \
    --auth=trust \
    --encoding=UTF8 \
    --locale=C \
    -L "$SHARE_DIR" \
    --pgdata="$DATA_DIR"
fi

exec "$BIN_DIR/postgres" \
  -D "$DATA_DIR" \
  -h 127.0.0.1 \
  -p "$IMMORADAR_POSTGRES_PORT" \
  -c "dynamic_library_path=$PKG_LIB_DIR"

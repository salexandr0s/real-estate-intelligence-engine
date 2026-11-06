#!/usr/bin/env bash
set -euo pipefail

: "${IMMORADAR_RUNTIME_HOME:?IMMORADAR_RUNTIME_HOME is required}"
: "${IMMORADAR_POSTGRES_PORT:?IMMORADAR_POSTGRES_PORT is required}"

# Postgres stops at startup when LC_ALL names a locale macOS can't load. C always loads.
export LC_ALL=C
export LANG=C
export LC_CTYPE=C

RUNTIME_ROOT="${IMMORADAR_RUNTIME_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BIN_DIR="${IMMORADAR_POSTGRES_BIN_DIR:-$RUNTIME_ROOT/infra/postgres/bin}"
DATA_DIR="$IMMORADAR_RUNTIME_HOME/postgres/data"
LOG_DIR="$IMMORADAR_RUNTIME_HOME/logs"

if [[ ! -x "$BIN_DIR/postgres" ]]; then
  echo "Postgres not found in $BIN_DIR. Install it with: brew install postgresql@17" >&2
  exit 1
fi

# The bundle carries its own share and library folders. An installed Postgres finds its own.
if [[ -n "${IMMORADAR_POSTGRES_BIN_DIR:-}" ]]; then
  INITDB_SHARE_ARGS=()
  POSTGRES_LIBRARY_ARGS=()
else
  INITDB_SHARE_ARGS=(-L "$RUNTIME_ROOT/infra/postgres/share/postgresql")
  POSTGRES_LIBRARY_ARGS=(-c "dynamic_library_path=$RUNTIME_ROOT/infra/postgres/lib/postgresql")
fi

mkdir -p "$DATA_DIR" "$LOG_DIR"

if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
  "$BIN_DIR/initdb" \
    --username=postgres \
    --auth=trust \
    --encoding=UTF8 \
    --locale=C \
    ${INITDB_SHARE_ARGS[@]+"${INITDB_SHARE_ARGS[@]}"} \
    --pgdata="$DATA_DIR"
fi

# Every client connects over TCP. Without a socket there is no lock file in /tmp that a stale PID
# can turn into a startup failure.
exec "$BIN_DIR/postgres" \
  -D "$DATA_DIR" \
  -h 127.0.0.1 \
  -p "$IMMORADAR_POSTGRES_PORT" \
  -c unix_socket_directories= \
  ${POSTGRES_LIBRARY_ARGS[@]+"${POSTGRES_LIBRARY_ARGS[@]}"}

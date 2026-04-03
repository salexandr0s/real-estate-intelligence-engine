#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DMG_PATH="${1:-${IMMORADAR_SMOKE_DMG_PATH:-$REPO_ROOT/.build/macos-release/ImmoRadar-macOS.dmg}}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_command hdiutil
require_command curl
require_command python3
require_command lsof

if [[ ! -f "$DMG_PATH" ]]; then
  echo "DMG not found at $DMG_PATH" >&2
  exit 1
fi

pick_free_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

wait_for_health() {
  local url="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))

  while [[ $SECONDS -lt $deadline ]]; do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  return 1
}

wait_for_port_release() {
  local port="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))

  while [[ $SECONDS -lt $deadline ]]; do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

wait_for_process_exit() {
  local pid="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))

  while [[ $SECONDS -lt $deadline ]]; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

request_app_quit() {
  if command -v osascript >/dev/null 2>&1; then
    osascript -e 'tell application id "com.immoradar.app" to quit' >/dev/null 2>&1 || true
  fi
}

wait_for_diagnostics_status() {
  local file_path="$1"
  local expected_status="$2"
  local timeout_seconds="$3"
  local deadline=$((SECONDS + timeout_seconds))

  while [[ $SECONDS -lt $deadline ]]; do
    if python3 - "$file_path" "$expected_status" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
expected = sys.argv[2]
if not path.exists():
    raise SystemExit(1)
try:
    payload = json.loads(path.read_text())
except json.JSONDecodeError:
    raise SystemExit(1)
raise SystemExit(0 if payload.get("status") == expected else 1)
PY
    then
      return 0
    fi
    sleep 1
  done

  return 1
}

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/immoradar-smoke.XXXXXX")"
MOUNT_POINT="$TMP_ROOT/mount"
INSTALL_ROOT="$TMP_ROOT/install"
RUNTIME_HOME="$TMP_ROOT/runtime-home"
LOGS_DIR="$TMP_ROOT/logs"
APP_STDOUT="$TMP_ROOT/app-stdout.log"
APP_PID=""
DEVICE=""
MOUNTED="0"

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill -TERM "$APP_PID" >/dev/null 2>&1 || true
    sleep 2
    kill -KILL "$APP_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$MOUNTED" == "1" ]]; then
    if [[ -n "$DEVICE" ]]; then
      hdiutil detach "$DEVICE" -quiet || true
    else
      hdiutil detach "$MOUNT_POINT" -quiet || true
    fi
  fi

  if [[ -d "$TMP_ROOT" ]]; then
    chmod -R u+w "$TMP_ROOT" >/dev/null 2>&1 || true
    find "$TMP_ROOT" -mindepth 1 -maxdepth 1 -name 'mount' -prune -o -exec rm -rf {} + >/dev/null 2>&1 || true
  fi

  if [[ -d "$MOUNT_POINT" ]] && mount | grep -F " on $MOUNT_POINT " >/dev/null 2>&1; then
    hdiutil detach "$DEVICE" -quiet || true
  fi

  rm -rf "$TMP_ROOT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$MOUNT_POINT" "$INSTALL_ROOT" "$RUNTIME_HOME" "$LOGS_DIR"
mkdir -p "$TMP_ROOT/home"

ATTACH_OUTPUT="$(hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -nobrowse)"
MOUNTED="1"
DEVICE="$(printf '%s\n' "$ATTACH_OUTPUT" | awk '/^\/dev\// { device=$1 } END { print device }')"

if [[ -z "$DEVICE" ]]; then
  echo "Failed to resolve DMG device for $DMG_PATH" >&2
  echo "$ATTACH_OUTPUT" >&2
  exit 1
fi

APP_SOURCE="$MOUNT_POINT/ImmoRadar.app"
APP_TARGET="$INSTALL_ROOT/ImmoRadar.app"

if [[ ! -d "$APP_SOURCE" ]]; then
  echo "Mounted DMG does not contain ImmoRadar.app" >&2
  exit 1
fi

cp -R "$APP_SOURCE" "$APP_TARGET"

API_PORT="$(pick_free_port)"
POSTGRES_PORT="$(pick_free_port)"
REDIS_PORT="$(pick_free_port)"
TOKEN="smoke-$(uuidgen | tr '[:upper:]' '[:lower:]')"
API_BASE_URL="http://127.0.0.1:${API_PORT}"

env \
  HOME="$TMP_ROOT/home" \
  IMMORADAR_SMOKE_TEST=1 \
  IMMORADAR_API_BASE_URL_OVERRIDE="$API_BASE_URL" \
  IMMORADAR_RUNTIME_HOME_OVERRIDE="$RUNTIME_HOME" \
  IMMORADAR_LOGS_DIRECTORY_OVERRIDE="$LOGS_DIR" \
  IMMORADAR_LOCAL_RUNTIME_API_TOKEN="$TOKEN" \
  IMMORADAR_POSTGRES_PORT_OVERRIDE="$POSTGRES_PORT" \
  IMMORADAR_REDIS_PORT_OVERRIDE="$REDIS_PORT" \
  "$APP_TARGET/Contents/MacOS/ImmoRadar" >"$APP_STDOUT" 2>&1 &
APP_PID=$!

if ! wait_for_health "$API_BASE_URL/health" 75; then
  echo "Smoke test failed: /health did not become ready in time." >&2
  echo "===== app stdout =====" >&2
  tail -n 200 "$APP_STDOUT" >&2 || true
  for file in "$LOGS_DIR"/*.log "$LOGS_DIR"/startup-diagnostics.json; do
    [[ -f "$file" ]] || continue
    echo "===== $file =====" >&2
    tail -n 200 "$file" >&2 || cat "$file" >&2
  done
  exit 1
fi

curl -fsS --max-time 5 "$API_BASE_URL/health" >/dev/null
curl -fsS --max-time 5 \
  -H "Authorization: Bearer $TOKEN" \
  "$API_BASE_URL/v1/alerts/unread-count" >/dev/null

if ! wait_for_diagnostics_status "$LOGS_DIR/startup-diagnostics.json" running 20; then
  echo "Smoke test failed: startup diagnostics did not reach running state." >&2
  for file in "$LOGS_DIR"/*.log "$LOGS_DIR"/startup-diagnostics.json; do
    [[ -f "$file" ]] || continue
    echo "===== $file =====" >&2
    tail -n 200 "$file" >&2 || cat "$file" >&2
  done
  exit 1
fi

for port in "$API_PORT" "$POSTGRES_PORT" "$REDIS_PORT"; do
  if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Smoke test failed: expected listener on port $port" >&2
    exit 1
  fi
done

request_app_quit "$APP_TARGET"
if ! wait_for_process_exit "$APP_PID" 20; then
  kill -TERM "$APP_PID" >/dev/null 2>&1 || true
fi
if ! wait_for_process_exit "$APP_PID" 10; then
  kill -KILL "$APP_PID" >/dev/null 2>&1 || true
  wait_for_process_exit "$APP_PID" 5 || true
fi
wait "$APP_PID" || true
APP_PID=""

for port in "$API_PORT" "$POSTGRES_PORT" "$REDIS_PORT"; do
  if ! wait_for_port_release "$port" 30; then
    echo "Smoke test failed: port $port did not close after app shutdown." >&2
    for file in "$LOGS_DIR"/*.log "$LOGS_DIR"/startup-diagnostics.json; do
      [[ -f "$file" ]] || continue
      echo "===== $file =====" >&2
      tail -n 200 "$file" >&2 || cat "$file" >&2
    done
    exit 1
  fi
done

echo "Smoke test passed for $DMG_PATH"

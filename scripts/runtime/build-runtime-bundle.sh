#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="${1:-$REPO_ROOT/.build/immoradar-runtime}"

STRICT_MODE="${IMMORADAR_RUNTIME_BUNDLE_STRICT:-0}"
PLAYWRIGHT_CACHE_DIR="${PLAYWRIGHT_CACHE_DIR:-$HOME/Library/Caches/ms-playwright}"
POSTGRES_VERSION="${IMMORADAR_POSTGRES_VERSION:-17}"

warn() {
  echo "[runtime-bundle] warning: $*" >&2
}

fail() {
  echo "[runtime-bundle] error: $*" >&2
  exit 1
}

require_or_warn() {
  local path="$1"
  local label="$2"
  if [[ ! -e "$path" ]]; then
    if [[ "$STRICT_MODE" == "1" ]]; then
      fail "$label not found at $path"
    fi
    warn "$label not found at $path; skipping runtime bundle"
    exit 0
  fi
}

find_postgres_bin() {
  if [[ -n "${IMMORADAR_POSTGRES_BIN_DIR:-}" && -x "${IMMORADAR_POSTGRES_BIN_DIR}/postgres" ]]; then
    echo "${IMMORADAR_POSTGRES_BIN_DIR}"
    return
  fi

  local candidates=(
    "/opt/homebrew/opt/postgresql@${POSTGRES_VERSION}/bin"
    "/opt/homebrew/Cellar/postgresql@${POSTGRES_VERSION}"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate/postgres" ]]; then
      echo "$candidate"
      return
    fi
    local nested
    nested="$(find "$candidate" -type f -name postgres 2>/dev/null | head -n 1 || true)"
    if [[ -n "$nested" ]]; then
      dirname "$nested"
      return
    fi
  done
}

list_macho_dependencies() {
  otool -L "$1" | tail -n +2 | awk '{print $1}'
}

is_macho_file() {
  file "$1" | grep -q 'Mach-O'
}

is_system_dependency() {
  local dependency="$1"
  [[ "$dependency" == /usr/lib/* || "$dependency" == /System/Library/* ]]
}

resolve_dependency_path() {
  local dependency="$1"
  local source_file="$2"
  local source_dir
  source_dir="$(cd "$(dirname "$source_file")" && pwd)"

  if [[ -f "$dependency" ]]; then
    echo "$dependency"
    return 0
  fi

  if [[ "$dependency" == @loader_path/* ]]; then
    local relative_loader_path="${dependency#@loader_path/}"
    local loader_candidate="$source_dir/$relative_loader_path"
    if [[ -f "$loader_candidate" ]]; then
      echo "$loader_candidate"
      return 0
    fi
  fi

  if [[ "$dependency" == @executable_path/* ]]; then
    local relative_executable_path="${dependency#@executable_path/}"
    local executable_candidate="$source_dir/$relative_executable_path"
    if [[ -f "$executable_candidate" ]]; then
      echo "$executable_candidate"
      return 0
    fi
  fi

  if [[ "$dependency" == @rpath/* ]]; then
    local basename_dependency="${dependency##*/}"
    local candidates=(
      "$source_dir/$basename_dependency"
      "$source_dir/../lib/$basename_dependency"
      "$source_dir/../../lib/$basename_dependency"
      "/opt/homebrew/lib/$basename_dependency"
    )

    local candidate
    for candidate in "${candidates[@]}"; do
      if [[ -f "$candidate" ]]; then
        echo "$candidate"
        return 0
      fi
    done
  fi

  local dependency_basename="${dependency##*/}"
  local searched_candidate
  searched_candidate="$(find /opt/homebrew /usr/local -name "$dependency_basename" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$searched_candidate" && -f "$searched_candidate" ]]; then
    echo "$searched_candidate"
    return 0
  fi

  return 1
}

copy_dependency_into_runtime_lib() {
  local dependency="$1"
  local source_file="$2"
  local resolved

  if ! resolved="$(resolve_dependency_path "$dependency" "$source_file")"; then
    warn "could not resolve dependency $dependency for $source_file"
    return 1
  fi

  local destination="$OUTPUT_DIR/lib/$(basename "$resolved")"
  if [[ ! -f "$destination" ]]; then
    cp "$resolved" "$destination"
    chmod +w "$destination"
    echo "$destination"
    return 0
  fi

  return 1
}

bundle_runtime_dependencies() {
  local changed=1
  mkdir -p "$OUTPUT_DIR/lib"

  while [[ "$changed" -eq 1 ]]; do
    changed=0

    while IFS= read -r -d '' candidate_file; do
      is_macho_file "$candidate_file" || continue
      local macho_file="$candidate_file"
      while IFS= read -r dependency; do
        [[ -z "$dependency" ]] && continue
        is_system_dependency "$dependency" && continue

        if copy_dependency_into_runtime_lib "$dependency" "$macho_file" >/dev/null; then
          changed=1
        fi
      done < <(list_macho_dependencies "$macho_file")
    done < <(find "$OUTPUT_DIR" \( -perm -111 -o -name '*.dylib' \) -type f -print0)
  done
}

rewrite_macho_paths() {
  while IFS= read -r -d '' candidate_file; do
    is_macho_file "$candidate_file" || continue
    local file_path="$candidate_file"
    local file_dir file_name install_base
    file_dir="$(dirname "$file_path")"
    file_name="$(basename "$file_path")"

    case "$file_path" in
      "$OUTPUT_DIR"/lib/*)
        if [[ "$file_name" == *.dylib ]]; then
          install_name_tool -id "@loader_path/$file_name" "$file_path" || true
        fi
        install_base="@loader_path"
        ;;
      "$OUTPUT_DIR"/bin/*)
        install_base="@executable_path/../lib"
        ;;
      "$OUTPUT_DIR"/infra/postgres/bin/*|"$OUTPUT_DIR"/infra/redis/bin/*)
        install_base="@executable_path/../../../lib"
        ;;
      "$OUTPUT_DIR"/infra/postgres/lib/postgresql/*)
        if [[ "$file_name" == *.dylib ]]; then
          install_name_tool -id "@loader_path/$file_name" "$file_path" || true
        fi
        install_base="@loader_path/../../../lib"
        ;;
      *)
        continue
        ;;
    esac

    while IFS= read -r dependency; do
      [[ -z "$dependency" ]] && continue
      is_system_dependency "$dependency" && continue
      [[ "$dependency" == @executable_path/* || "$dependency" == @loader_path/* ]] && continue

      local resolved
      if ! resolved="$(resolve_dependency_path "$dependency" "$file_path")"; then
        continue
      fi

      local bundled_name
      bundled_name="$(basename "$resolved")"
      local bundled_path="$OUTPUT_DIR/lib/$bundled_name"
      if [[ -f "$bundled_path" ]]; then
        install_name_tool -change "$dependency" "$install_base/$bundled_name" "$file_path" || true
      fi
    done < <(list_macho_dependencies "$file_path")
  done < <(find "$OUTPUT_DIR" \( -perm -111 -o -name '*.dylib' \) -type f -print0)
}

adhoc_sign_runtime() {
  while IFS= read -r -d '' candidate_file; do
    is_macho_file "$candidate_file" || continue
    codesign --force --sign - --timestamp=none "$candidate_file" >/dev/null 2>&1 || true
  done < <(find "$OUTPUT_DIR" \( -perm -111 -o -name '*.dylib' \) -type f -print0)
}

prune_runtime_payload() {
  rm -rf \
    "$OUTPUT_DIR/apps/api/src" \
    "$OUTPUT_DIR/apps/worker-processing/src" \
    "$OUTPUT_DIR/apps/worker-scraper/src" \
    "$OUTPUT_DIR/infra/postgres/lib/postgresql/pgxs"

  find "$OUTPUT_DIR/node_modules" -type d \( \
    -name test -o \
    -name tests -o \
    -name __tests__ -o \
    -name docs -o \
    -name doc -o \
    -name example -o \
    -name examples \
  \) -prune -exec rm -rf {} + 2>/dev/null || true

  find "$OUTPUT_DIR" -type f \( \
    -name '*.md' -o \
    -name '*.markdown' -o \
    -name '*.map' -o \
    -name '*.tsbuildinfo' \
  \) -delete 2>/dev/null || true

  rm -f \
    "$OUTPUT_DIR/apps/api/Dockerfile" \
    "$OUTPUT_DIR/apps/worker-processing/Dockerfile" \
    "$OUTPUT_DIR/apps/worker-scraper/Dockerfile"
}

NODE_BIN="${IMMORADAR_NODE_BINARY:-$(command -v node || true)}"
REDIS_SERVER_BIN="${IMMORADAR_REDIS_SERVER_BINARY:-$(command -v redis-server || true)}"
REDIS_CLI_BIN="${IMMORADAR_REDIS_CLI_BINARY:-$(command -v redis-cli || true)}"
POSTGRES_BIN_DIR="$(find_postgres_bin)"
POSTGRES_PKG_LIB_DIR="$("$POSTGRES_BIN_DIR/pg_config" --pkglibdir)"
POSTGRES_SHARE_DIR="$("$POSTGRES_BIN_DIR/pg_config" --sharedir)"

require_or_warn "$NODE_BIN" "Node binary"
require_or_warn "$REDIS_SERVER_BIN" "redis-server binary"
require_or_warn "$POSTGRES_BIN_DIR/postgres" "Postgres binary"
require_or_warn "$POSTGRES_BIN_DIR/initdb" "initdb binary"
require_or_warn "$POSTGRES_PKG_LIB_DIR" "Postgres extension library directory"
require_or_warn "$POSTGRES_SHARE_DIR" "Postgres shared directory"

mkdir -p "$OUTPUT_DIR"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"/{apps,packages,node_modules,bin,lib,infra/postgres/bin,infra/postgres/lib/postgresql,infra/postgres/share/postgresql,infra/redis/bin,scripts}

rsync -a "$REPO_ROOT/apps/api/" "$OUTPUT_DIR/apps/api/"
rsync -a "$REPO_ROOT/apps/worker-processing/" "$OUTPUT_DIR/apps/worker-processing/"
rsync -a "$REPO_ROOT/apps/worker-scraper/" "$OUTPUT_DIR/apps/worker-scraper/"
rsync -a "$REPO_ROOT/packages/" "$OUTPUT_DIR/packages/"
rsync -a "$REPO_ROOT/node_modules/" "$OUTPUT_DIR/node_modules/"
cp "$REPO_ROOT/package.json" "$OUTPUT_DIR/package.json"

cp "$NODE_BIN" "$OUTPUT_DIR/bin/node"
cp "$POSTGRES_BIN_DIR/postgres" "$OUTPUT_DIR/infra/postgres/bin/postgres"
cp "$POSTGRES_BIN_DIR/initdb" "$OUTPUT_DIR/infra/postgres/bin/initdb"
rsync -aL "$POSTGRES_PKG_LIB_DIR/" "$OUTPUT_DIR/infra/postgres/lib/postgresql/"
rsync -aL "$POSTGRES_SHARE_DIR/" "$OUTPUT_DIR/infra/postgres/share/postgresql/"

if [[ -x "$POSTGRES_BIN_DIR/pg_isready" ]]; then
  cp "$POSTGRES_BIN_DIR/pg_isready" "$OUTPUT_DIR/infra/postgres/bin/pg_isready"
fi
if [[ -x "$POSTGRES_BIN_DIR/pg_ctl" ]]; then
  cp "$POSTGRES_BIN_DIR/pg_ctl" "$OUTPUT_DIR/infra/postgres/bin/pg_ctl"
fi
if [[ -x "$POSTGRES_BIN_DIR/psql" ]]; then
  cp "$POSTGRES_BIN_DIR/psql" "$OUTPUT_DIR/infra/postgres/bin/psql"
fi
if [[ -x "$POSTGRES_BIN_DIR/createdb" ]]; then
  cp "$POSTGRES_BIN_DIR/createdb" "$OUTPUT_DIR/infra/postgres/bin/createdb"
fi

cp "$REDIS_SERVER_BIN" "$OUTPUT_DIR/infra/redis/bin/redis-server"
if [[ -n "$REDIS_CLI_BIN" && -x "$REDIS_CLI_BIN" ]]; then
  cp "$REDIS_CLI_BIN" "$OUTPUT_DIR/infra/redis/bin/redis-cli"
fi

cp "$REPO_ROOT/scripts/runtime/start-postgres.sh" "$OUTPUT_DIR/scripts/start-postgres.sh"
cp "$REPO_ROOT/scripts/runtime/start-redis.sh" "$OUTPUT_DIR/scripts/start-redis.sh"
cp "$REPO_ROOT/scripts/runtime/run-migrations.sh" "$OUTPUT_DIR/scripts/run-migrations.sh"

prune_runtime_payload

chmod +x \
  "$OUTPUT_DIR/bin/node" \
  "$OUTPUT_DIR/infra/postgres/bin/postgres" \
  "$OUTPUT_DIR/infra/postgres/bin/initdb" \
  "$OUTPUT_DIR/infra/redis/bin/redis-server" \
  "$OUTPUT_DIR/scripts/start-postgres.sh" \
  "$OUTPUT_DIR/scripts/start-redis.sh" \
  "$OUTPUT_DIR/scripts/run-migrations.sh"

find "$OUTPUT_DIR/infra/postgres/lib/postgresql" -type f -name '*.dylib' -exec chmod +w {} +

bundle_runtime_dependencies
rewrite_macho_paths
adhoc_sign_runtime

if [[ -d "$PLAYWRIGHT_CACHE_DIR" ]]; then
  rsync -a "$PLAYWRIGHT_CACHE_DIR/" "$OUTPUT_DIR/playwright-browsers/"
fi

cat > "$OUTPUT_DIR/manifest.json" <<'JSON'
{
  "version": 1,
  "defaultApiBaseURL": "http://127.0.0.1:8080",
  "nodeExecutable": "bin/node",
  "scripts": {
    "postgres": "scripts/start-postgres.sh",
    "redis": "scripts/start-redis.sh",
    "migrate": "scripts/run-migrations.sh"
  },
  "ports": {
    "postgres": 55432,
    "redis": 56379,
    "api": 8080
  },
  "artifactsDirectory": "artifacts",
  "playwrightBrowsersPath": "playwright-browsers"
}
JSON

echo "[runtime-bundle] bundled runtime at $OUTPUT_DIR"

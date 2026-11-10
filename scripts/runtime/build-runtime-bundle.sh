#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="${1:-$REPO_ROOT/.build/immoradar-runtime}"

STRICT_MODE="${IMMORADAR_RUNTIME_BUNDLE_STRICT:-0}"
PLAYWRIGHT_CACHE_DIR="${PLAYWRIGHT_CACHE_DIR:-$HOME/Library/Caches/ms-playwright}"
POSTGRES_VERSION="${IMMORADAR_POSTGRES_VERSION:-17}"
# The engine runs on the Node major that .nvmrc names.
REQUIRED_NODE_MAJOR="$(cut -d. -f1 "$REPO_ROOT/.nvmrc" | tr -d 'v')"

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

# The first node on PATH can be a newer major than the engine runs on, so Homebrew's node@<major>
# comes first.
find_node_bin() {
  if [[ -n "${IMMORADAR_NODE_BINARY:-}" ]]; then
    echo "$IMMORADAR_NODE_BINARY"
    return
  fi

  local candidate
  for candidate in \
    "/opt/homebrew/opt/node@${REQUIRED_NODE_MAJOR}/bin/node" \
    "/usr/local/opt/node@${REQUIRED_NODE_MAJOR}/bin/node" \
    "$(command -v node || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
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

# Prints $1 without the leading folders it shares with $2.
path_after_shared_folders() {
  local path_parts other_parts
  IFS=/ read -r -a path_parts <<<"$1"
  IFS=/ read -r -a other_parts <<<"$2"
  local index=0
  while [[ $index -lt ${#path_parts[@]} && $index -lt ${#other_parts[@]} && "${path_parts[$index]}" == "${other_parts[$index]}" ]]; do
    index=$((index + 1))
  done
  local IFS=/
  echo "${path_parts[*]:$index}"
}

# Prints one "../" for each folder in a relative path.
path_to_parent_of() {
  local parts
  IFS=/ read -r -a parts <<<"$1"
  printf '../%.0s' "${parts[@]}"
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
      "$OUTPUT_DIR"/infra/redis/bin/*)
        install_base="@executable_path/../../../lib"
        ;;
      "$POSTGRES_BIN_OUTPUT"/*)
        install_base="@executable_path/$(path_to_parent_of "infra/postgres/$POSTGRES_BIN_TAIL")lib"
        ;;
      "$POSTGRES_LIB_OUTPUT"/*)
        if [[ "$file_name" == *.dylib ]]; then
          install_name_tool -id "@loader_path/$file_name" "$file_path" || true
        fi
        install_base="@loader_path/$(path_to_parent_of "infra/postgres/$POSTGRES_LIB_TAIL")lib"
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
    "$POSTGRES_LIB_OUTPUT/pgxs"

  find "$OUTPUT_DIR/apps" "$OUTPUT_DIR/packages" -type d \( \
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

  # Compiled tests aren't runtime code, and they import test tools the bundle leaves out.
  find "$OUTPUT_DIR/apps" "$OUTPUT_DIR/packages" -path '*/dist/*' -not -path '*/node_modules/*' -type f \( \
    -name '*.test.*' -o \
    -name '*.spec.*' \
  \) -delete 2>/dev/null || true

  rm -f \
    "$OUTPUT_DIR/apps/api/Dockerfile" \
    "$OUTPUT_DIR/apps/worker-processing/Dockerfile" \
    "$OUTPUT_DIR/apps/worker-scraper/Dockerfile"
}

# The bundle ships compiled output, so it compiles the current source first, into empty dist
# folders. tsc never deletes the output of a removed source file, and turbo's cache can hold such
# files too, so the build skips the cache.
build_workspaces() {
  local turbo="$REPO_ROOT/node_modules/turbo/bin/turbo"
  [[ -f "$turbo" ]] || fail "turbo isn't installed in $REPO_ROOT; run npm ci"
  (
    cd "$REPO_ROOT" &&
      PATH="$(dirname "$NODE_BIN"):$PATH" &&
      "$NODE_BIN" "$turbo" run clean --output-logs=errors-only &&
      "$NODE_BIN" "$turbo" run build --force --output-logs=errors-only
  ) || fail "compiling the TypeScript workspaces failed"
}

# Leaves out the packages only devDependencies need, as `npm ci --omit=dev` would. npm marks them
# "dev" in node_modules/.package-lock.json, which describes the installed tree the bundle copies.
# package-lock.json can describe a newer tree, after a pull without npm ci. A package that
# production code needs too carries no mark and stays.
prune_dev_dependencies() {
  local lockfile="$REPO_ROOT/node_modules/.package-lock.json"
  [[ -f "$lockfile" ]] || fail "$lockfile is missing; run npm ci"
  LOCKFILE="$lockfile" BUNDLE_ROOT="$OUTPUT_DIR" "$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.resolve(process.env.BUNDLE_ROOT);
    const { packages } = JSON.parse(fs.readFileSync(process.env.LOCKFILE, "utf8"));
    let removed = 0;
    for (const [key, entry] of Object.entries(packages)) {
      if (!entry.dev || !key.includes("node_modules/")) continue;
      const target = path.resolve(root, key);
      if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
      removed += 1;
    }
    console.log(`[runtime-bundle] left out ${removed} packages that only devDependencies need`);
  '
  # Links in .bin folders that pointed into those packages.
  find "$OUTPUT_DIR" -path '*/node_modules/.bin/*' -type l ! -exec test -e {} \; -delete
}

verify_postgres_uses_its_own_folders() {
  local own_root share_dir pkg_lib_dir
  own_root="$(cd "$OUTPUT_DIR/infra/postgres" && pwd -P)"
  share_dir="$("$OUTPUT_DIR/infra/postgres/bin/pg_config" --sharedir)"
  pkg_lib_dir="$("$OUTPUT_DIR/infra/postgres/bin/pg_config" --pkglibdir)"
  if [[ "$share_dir" != "$own_root"/* || "$pkg_lib_dir" != "$own_root"/* ]]; then
    fail "the bundled Postgres would read $share_dir and $pkg_lib_dir instead of its own folders"
  fi
}

verify_runtime_modules() {
  (
    cd "$OUTPUT_DIR"
    ./bin/node -e "require('./node_modules/yaml/dist/index.js')"
  ) >/dev/null
  "$OUTPUT_DIR/bin/node" "$SCRIPT_DIR/check-bundle-imports.mjs" "$OUTPUT_DIR" ||
    fail "the bundle lacks packages its code imports"
}

# Only the headless shell this Playwright version launches. The whole cache holds every revision and
# browser ever installed on this machine.
copy_playwright_browser() {
  local revision
  revision="$(BROWSERS_JSON="$REPO_ROOT/node_modules/playwright-core/browsers.json" "$NODE_BIN" -p \
    "require(process.env.BROWSERS_JSON).browsers.find((browser) => browser.name === 'chromium-headless-shell').revision")"
  local browser_dir="$PLAYWRIGHT_CACHE_DIR/chromium_headless_shell-$revision"

  if [[ ! -d "$browser_dir" ]]; then
    if [[ "$STRICT_MODE" == "1" ]]; then
      fail "Chromium headless shell not found at $browser_dir; run: npx playwright install chromium-headless-shell"
    fi
    warn "Chromium headless shell not found at $browser_dir; the scraper will not start a browser"
    return 0
  fi

  mkdir -p "$OUTPUT_DIR/playwright-browsers"
  rsync -a "$browser_dir" "$OUTPUT_DIR/playwright-browsers/"
}

NODE_BIN="$(find_node_bin)"
REDIS_SERVER_BIN="${IMMORADAR_REDIS_SERVER_BINARY:-$(command -v redis-server || true)}"
REDIS_CLI_BIN="${IMMORADAR_REDIS_CLI_BINARY:-$(command -v redis-cli || true)}"
POSTGRES_BIN_DIR="$(find_postgres_bin)"
POSTGRES_PKG_LIB_DIR="$("$POSTGRES_BIN_DIR/pg_config" --pkglibdir)"
POSTGRES_SHARE_DIR="$("$POSTGRES_BIN_DIR/pg_config" --sharedir)"
POSTGRES_BUILD_BIN_DIR="$("$POSTGRES_BIN_DIR/pg_config" --bindir)"

# Postgres finds its share and library folders relative to its own binary only when the binary's
# folder ends in the same path it was built for. Anywhere else it falls back to the build's absolute
# paths, which exist only while Homebrew's copy is installed. So below the folders those paths share,
# the bundle repeats the build's layout, and `bin` links to wherever the binaries ended up.
POSTGRES_BIN_TAIL="$(path_after_shared_folders "$POSTGRES_BUILD_BIN_DIR" "$POSTGRES_SHARE_DIR")"
POSTGRES_LIB_TAIL="$(path_after_shared_folders "$POSTGRES_PKG_LIB_DIR" "$POSTGRES_BUILD_BIN_DIR")"
POSTGRES_SHARE_TAIL="$(path_after_shared_folders "$POSTGRES_SHARE_DIR" "$POSTGRES_BUILD_BIN_DIR")"
POSTGRES_BIN_OUTPUT="$OUTPUT_DIR/infra/postgres/$POSTGRES_BIN_TAIL"
POSTGRES_LIB_OUTPUT="$OUTPUT_DIR/infra/postgres/$POSTGRES_LIB_TAIL"
POSTGRES_SHARE_OUTPUT="$OUTPUT_DIR/infra/postgres/$POSTGRES_SHARE_TAIL"

require_or_warn "$NODE_BIN" "Node binary"
require_or_warn "$REDIS_SERVER_BIN" "redis-server binary"
require_or_warn "$POSTGRES_BIN_DIR/postgres" "Postgres binary"
require_or_warn "$POSTGRES_BIN_DIR/initdb" "initdb binary"
require_or_warn "$POSTGRES_PKG_LIB_DIR" "Postgres extension library directory"
require_or_warn "$POSTGRES_SHARE_DIR" "Postgres shared directory"

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" != "$REQUIRED_NODE_MAJOR" ]]; then
  if [[ "$STRICT_MODE" == "1" ]]; then
    fail "$NODE_BIN is Node $NODE_MAJOR, and the engine runs on Node $REQUIRED_NODE_MAJOR. Install node@$REQUIRED_NODE_MAJOR with Homebrew, or set IMMORADAR_NODE_BINARY."
  fi
  warn "bundling Node $NODE_MAJOR from $NODE_BIN, although the engine runs on Node $REQUIRED_NODE_MAJOR"
fi

build_workspaces

mkdir -p "$OUTPUT_DIR"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"/{apps,packages,node_modules,bin,lib,infra/redis/bin,scripts}
mkdir -p "$POSTGRES_BIN_OUTPUT" "$POSTGRES_LIB_OUTPUT" "$POSTGRES_SHARE_OUTPUT"
if [[ "$POSTGRES_BIN_TAIL" != "bin" ]]; then
  ln -s "$POSTGRES_BIN_TAIL" "$OUTPUT_DIR/infra/postgres/bin"
fi

rsync -a "$REPO_ROOT/apps/api/" "$OUTPUT_DIR/apps/api/"
rsync -a "$REPO_ROOT/apps/worker-processing/" "$OUTPUT_DIR/apps/worker-processing/"
rsync -a "$REPO_ROOT/apps/worker-scraper/" "$OUTPUT_DIR/apps/worker-scraper/"
rsync -a "$REPO_ROOT/packages/" "$OUTPUT_DIR/packages/"
rsync -a "$REPO_ROOT/node_modules/" "$OUTPUT_DIR/node_modules/"
cp "$REPO_ROOT/package.json" "$OUTPUT_DIR/package.json"

cp "$NODE_BIN" "$OUTPUT_DIR/bin/node"
cp "$POSTGRES_BIN_DIR/postgres" "$POSTGRES_BIN_OUTPUT/postgres"
cp "$POSTGRES_BIN_DIR/initdb" "$POSTGRES_BIN_OUTPUT/initdb"
cp "$POSTGRES_BIN_DIR/pg_config" "$POSTGRES_BIN_OUTPUT/pg_config"
rsync -aL "$POSTGRES_PKG_LIB_DIR/" "$POSTGRES_LIB_OUTPUT/"
rsync -aL "$POSTGRES_SHARE_DIR/" "$POSTGRES_SHARE_OUTPUT/"

if [[ -x "$POSTGRES_BIN_DIR/pg_isready" ]]; then
  cp "$POSTGRES_BIN_DIR/pg_isready" "$POSTGRES_BIN_OUTPUT/pg_isready"
fi
if [[ -x "$POSTGRES_BIN_DIR/pg_ctl" ]]; then
  cp "$POSTGRES_BIN_DIR/pg_ctl" "$POSTGRES_BIN_OUTPUT/pg_ctl"
fi
if [[ -x "$POSTGRES_BIN_DIR/psql" ]]; then
  cp "$POSTGRES_BIN_DIR/psql" "$POSTGRES_BIN_OUTPUT/psql"
fi
if [[ -x "$POSTGRES_BIN_DIR/createdb" ]]; then
  cp "$POSTGRES_BIN_DIR/createdb" "$POSTGRES_BIN_OUTPUT/createdb"
fi

cp "$REDIS_SERVER_BIN" "$OUTPUT_DIR/infra/redis/bin/redis-server"
if [[ -n "$REDIS_CLI_BIN" && -x "$REDIS_CLI_BIN" ]]; then
  cp "$REDIS_CLI_BIN" "$OUTPUT_DIR/infra/redis/bin/redis-cli"
fi

cp "$REPO_ROOT/scripts/runtime/start-postgres.sh" "$OUTPUT_DIR/scripts/start-postgres.sh"
cp "$REPO_ROOT/scripts/runtime/start-redis.sh" "$OUTPUT_DIR/scripts/start-redis.sh"
cp "$REPO_ROOT/scripts/runtime/run-migrations.sh" "$OUTPUT_DIR/scripts/run-migrations.sh"
cp "$REPO_ROOT/scripts/runtime/engine-watchdog.sh" "$OUTPUT_DIR/scripts/engine-watchdog.sh"

prune_dev_dependencies
prune_runtime_payload

chmod +x \
  "$OUTPUT_DIR/bin/node" \
  "$POSTGRES_BIN_OUTPUT/postgres" \
  "$POSTGRES_BIN_OUTPUT/initdb" \
  "$POSTGRES_BIN_OUTPUT/pg_config" \
  "$OUTPUT_DIR/infra/redis/bin/redis-server" \
  "$OUTPUT_DIR/scripts/start-postgres.sh" \
  "$OUTPUT_DIR/scripts/start-redis.sh" \
  "$OUTPUT_DIR/scripts/run-migrations.sh" \
  "$OUTPUT_DIR/scripts/engine-watchdog.sh"

find "$POSTGRES_LIB_OUTPUT" -type f -name '*.dylib' -exec chmod +w {} +

bundle_runtime_dependencies
rewrite_macho_paths
adhoc_sign_runtime
verify_postgres_uses_its_own_folders
verify_runtime_modules

copy_playwright_browser

cat > "$OUTPUT_DIR/manifest.json" <<'JSON'
{
  "version": 1,
  "defaultApiBaseURL": "http://127.0.0.1:58080",
  "nodeExecutable": "bin/node",
  "scripts": {
    "postgres": "scripts/start-postgres.sh",
    "redis": "scripts/start-redis.sh",
    "migrate": "scripts/run-migrations.sh",
    "watchdog": "scripts/engine-watchdog.sh"
  },
  "ports": {
    "postgres": 55432,
    "redis": 56379,
    "api": 58080
  },
  "artifactsDirectory": "artifacts",
  "playwrightBrowsersPath": "playwright-browsers"
}
JSON

echo "[runtime-bundle] bundled runtime at $OUTPUT_DIR"

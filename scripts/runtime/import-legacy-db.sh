#!/bin/bash
#
# Copies the immoradar database from a Homebrew Postgres 17 cluster into the engine's Postgres.
#
#   scripts/runtime/import-legacy-db.sh [--runtime-home <path>] [--source-data-dir <path>]
#                                       [--accept-fewer-rows]
#
# ImmoRadar must be closed. The script holds engine.lock for the whole run, so the app can't start
# before it finishes. The source folder is never written. A running source server is dumped as it
# is. A stopped one is cloned, and the clone runs on a free loopback port while it is dumped.
#
# The dump is restored into a new, empty database, immoradar_import, and the migrations run on it.
# Bootstrap fills only empty tables, so it leaves the imported rows alone. When every source table
# has at least its source row count, one transaction renames the engine's immoradar to
# immoradar_pre_import_<UTC time> and immoradar_import to immoradar. Nothing is merged, and the
# previous database stays until someone drops it. A failure before that rename drops
# immoradar_import and leaves the engine's database as it was.
#
# Written for the bash 3.2 that ships with macOS. Tools come from IMMORADAR_POSTGRES_BIN_DIR,
# IMMORADAR_NODE_BIN and IMMORADAR_MIGRATE_SCRIPT when they are set, as in run-migrations.sh.

set -euo pipefail
umask 077

# Postgres stops at startup when LC_ALL names a locale macOS can't load. C always loads.
export LC_ALL=C LANG=C LC_CTYPE=C
# Under the C locale psql would send text as SQL_ASCII, and the ILIKE check sends UTF-8.
export PGCLIENTENCODING=UTF8 PGCONNECT_TIMEOUT=10 PGAPPNAME=immoradar-import
# Every connection below names its host, port, user and database. These would reroute it or add
# settings to it.
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGTARGETSESSIONATTRS

DEFAULT_RUNTIME_HOME="$HOME/Library/Application Support/ImmoRadar/runtime"
DEFAULT_SOURCE_DATA_DIR="/opt/homebrew/var/postgresql@17"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PG_BIN="${IMMORADAR_POSTGRES_BIN_DIR:-/opt/homebrew/opt/postgresql@17/bin}"
NODE_BIN="${IMMORADAR_NODE_BIN:-$(command -v node || true)}"
MIGRATE_SCRIPT="${IMMORADAR_MIGRATE_SCRIPT:-$REPO_ROOT/packages/db/dist/migrate.js}"
PYTHON=/usr/bin/python3
TAB=$'\t'

# Never used for a server this script starts: the default Postgres port, the engine's own ports,
# and the ports of the integration test services.
RESERVED_PORTS="5432 55432 55532 56379 56479 58080"

RUNTIME_HOME="$DEFAULT_RUNTIME_HOME"
SOURCE_DATA_DIR="$DEFAULT_SOURCE_DATA_DIR"
ACCEPT_FEWER_ROWS=""

# State the exit trap reads.
WORK_DIR=""
CLONE_DIR=""
SOURCE_SERVER_PID=""
RUNTIME_SERVER_PID=""
RUNTIME_PORT=""
RUNTIME_DATA_DIR=""
IMPORT_DB_CREATED=""
SWAPPED=""

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'import-legacy-db: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [--runtime-home <path>] [--source-data-dir <path>] [--accept-fewer-rows]

Copies the immoradar database from a Homebrew Postgres 17 cluster into the engine's Postgres.
Quit ImmoRadar before you run it.

  --runtime-home <path>     The engine's runtime home.
                            Default: $DEFAULT_RUNTIME_HOME
  --source-data-dir <path>  The data folder of the cluster to copy from.
                            Default: $DEFAULT_SOURCE_DATA_DIR
  --accept-fewer-rows       Import even when the engine's database has more listings than the
                            source. The engine's database is kept under another name either way.
EOF
}

is_number() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$PWD/$1" ;;
  esac
}

# True while the PID is alive. A child that exited but wasn't reaped yet shows as a zombie.
is_running() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null || true)"
  state="${state// /}"
  [[ -n "$state" && "$state" != Z* ]]
}

# Prints the PIDs of postgres processes that run in the given folder. The postmaster and every
# child it starts change into their data folder, so this finds a server whatever its postmaster.pid
# says. lsof shows only this user's processes, and only this user can run a server on its folders.
postgres_pids_in() {
  lsof -a -c postgres -d cwd -Fpn 2>/dev/null |
    FOLDER="$1" awk '/^p/ { pid = substr($0, 2) } /^n/ && substr($0, 2) == ENVIRON["FOLDER"] { print pid }' ||
    true
}

# Prints one line of postmaster.pid: 1 PID, 4 port, 5 socket folder.
pid_file_line() {
  sed -n "${2}p" "$1" 2>/dev/null || true
}

server_major_version() {
  "$PG_BIN/postgres" -V | sed -E 's/.*\(PostgreSQL\) ([0-9]+).*/\1/'
}

free_port() {
  local port attempt=0
  while ((attempt < 20)); do
    attempt=$((attempt + 1))
    port="$("$PYTHON" -I -c 'import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()')" || return 1
    case " $RESERVED_PORTS " in
      *" $port "*) continue ;;
    esac
    printf '%s\n' "$port"
    return 0
  done
  return 1
}

# Starts each server as "$PYTHON" -I -c "$DETACH" <program> <arguments>, in a new process group, so
# a Ctrl-C in the terminal reaches this script and not the server, and the exit trap can still drop
# immoradar_import before it stops the server. Each step execs the next, so the server keeps the
# PID that $! reports. Start it as a plain command with &, not from a function: bash runs a function
# started with & in a subshell, and $! then names the subshell instead of the server.
DETACH='import os, signal, sys
os.setpgid(0, 0)
signal.signal(signal.SIGINT, signal.SIG_DFL)
signal.signal(signal.SIGQUIT, signal.SIG_DFL)
os.execv(sys.argv[1], sys.argv[1:])'

# Waits for as long as the server process lives, because crash recovery on a clone can take
# minutes. Then checks that the process is the postmaster. If it isn't, another server answered on
# this port, or a step no longer execs the next.
wait_until_ready() {
  local pid="$1" port="$2" role="$3" data_dir="$4" name="$5" log="$6" deadline=$((SECONDS + 900))
  until "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$port" -U "$role" -d template1 -t 1; do
    is_running "$pid" || fail "$name stopped while it started. See $log"
    ((SECONDS < deadline)) || fail "$name didn't accept connections within 15 minutes. See $log"
    sleep 1
  done
  [[ "$(pid_file_line "$data_dir/postmaster.pid" 1)" == "$pid" ]] ||
    fail "$name doesn't run as PID $pid, the process this script started. See $log"
}

# Signals a process until it is gone. SIGINT is Postgres's fast shutdown, and start-postgres.sh
# passes it on to initdb. SIGTERM, SIGQUIT and SIGKILL follow only if the process hangs.
end_process() {
  local pid="$1" step signal polls
  for step in "INT 60" "TERM 10" "QUIT 5" "KILL 5"; do
    is_running "$pid" || break
    signal="${step% *}"
    polls=$((${step#* } * 5))
    kill "-$signal" "$pid" 2>/dev/null || true
    while ((polls > 0)) && is_running "$pid"; do
      sleep 0.2
      polls=$((polls - 1))
    done
  done
  wait "$pid" 2>/dev/null || true
  ! is_running "$pid"
}

# Stops a server this script started, by the PID that $! reported. If Postgres still runs in the
# data folder after that, the postmaster named in its postmaster.pid is stopped too. The server
# counts as stopped once no postgres process is left in the folder.
stop_server() {
  local pid="$1" name="$2" data_dir="$3" folder="" left="" pm_pid="" polls=50
  [[ -n "$pid" ]] || return 0
  if ! end_process "$pid"; then
    say "Couldn't stop $name (PID $pid)." >&2
    return 1
  fi
  if [[ -n "$data_dir" && -d "$data_dir" ]]; then
    folder="$(cd "$data_dir" 2>/dev/null && pwd -P || true)"
  fi
  if [[ -n "$folder" ]]; then
    left="$(postgres_pids_in "$folder")"
    pm_pid="$(pid_file_line "$folder/postmaster.pid" 1)"
    if [[ -n "$left" ]] && is_number "$pm_pid"; then
      case $'\n'"$left"$'\n' in
        *$'\n'"$pm_pid"$'\n'*) end_process "$pm_pid" || true ;;
      esac
    fi
    # A postmaster's children leave within seconds of it.
    while [[ -n "$left" ]] && ((polls > 0)); do
      sleep 0.2
      polls=$((polls - 1))
      left="$(postgres_pids_in "$folder")"
    done
  fi
  if [[ -n "$left" ]]; then
    say "Couldn't stop $name. Postgres still runs in $folder (PID ${left%%$'\n'*})." >&2
    return 1
  fi
  say "Stopped $name."
}

# Deletes the clone this run made, and nothing else, once no server runs on it.
remove_clone() {
  local folder="" left=""
  [[ -n "$CLONE_DIR" ]] || return 0
  if [[ -d "$CLONE_DIR" ]]; then
    folder="$(cd "$CLONE_DIR" 2>/dev/null && pwd -P || true)"
  fi
  if [[ -n "$folder" ]]; then
    left="$(postgres_pids_in "$folder")"
  fi
  if [[ -n "$left" ]] || { [[ -n "$SOURCE_SERVER_PID" ]] && is_running "$SOURCE_SERVER_PID"; }; then
    say "Left the clone at $CLONE_DIR, because a server still runs on it." >&2
    return 1
  fi
  if [[ "$CLONE_DIR" == "$WORK_DIR/source-data" && -d "$CLONE_DIR" ]]; then
    rm -rf -- "$CLONE_DIR"
    say "Deleted the clone."
  fi
  CLONE_DIR=""
}

source_psql() {
  "$PG_BIN/psql" -X -w -q -v ON_ERROR_STOP=1 -h "$SOURCE_HOST" -p "$SOURCE_PORT" -U "$SOURCE_ROLE" "$@"
}

runtime_psql() {
  "$PG_BIN/psql" -X -w -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$RUNTIME_PORT" -U postgres "$@"
}

runtime_database_exists() {
  [[ "$(runtime_psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$1'")" == 1 ]]
}

# The first role that can connect. Homebrew names the superuser after the macOS account.
pick_role() {
  local host="$1" port="$2" role
  shift 2
  for role in "$@"; do
    if "$PG_BIN/psql" -X -w -q -h "$host" -p "$port" -U "$role" -d template1 -tAc 'SELECT 1' >/dev/null 2>&1; then
      printf '%s\n' "$role"
      return 0
    fi
  done
  return 1
}

# Writes "<table><TAB><exact row count>" for every table in schema public, sorted by name.
count_rows() {
  "$1" -d "$2" -tA -F "$TAB" >"$3" <<'SQL'
SELECT format('SELECT %L, count(*) FROM public.%I', c.relname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname
\gexec
SQL
}

print_counts() {
  local table source imported status
  printf '  %-40s %12s %12s\n' "Table" "Source" "Imported"
  while IFS="$TAB" read -r table source imported status; do
    if [[ "$status" == ok ]]; then status=""; fi
    printf '  %-40s %12s %12s  %s\n' "$table" "$source" "$imported" "$status"
  done <"$1"
}

cleanup() {
  local status=$?
  set +e
  trap '' INT TERM HUP
  if [[ -n "$IMPORT_DB_CREATED" && -z "$SWAPPED" && -n "$RUNTIME_SERVER_PID" ]] && is_running "$RUNTIME_SERVER_PID"; then
    if runtime_psql -d postgres -c 'DROP DATABASE IF EXISTS immoradar_import WITH (FORCE)' >/dev/null 2>&1; then
      say "Dropped immoradar_import. The engine's immoradar database is as it was." >&2
    else
      say "Couldn't drop immoradar_import. The next run drops it. The engine's immoradar database is as it was." >&2
    fi
  fi
  stop_server "$RUNTIME_SERVER_PID" "the engine's Postgres" "$RUNTIME_DATA_DIR"
  stop_server "$SOURCE_SERVER_PID" "the clone's Postgres" "$CLONE_DIR"
  remove_clone
  exit "$status"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime-home | --source-data-dir)
      if [[ $# -lt 2 || -z "$2" ]]; then
        usage >&2
        fail "$1 needs a path."
      fi
      if [[ "$1" == --runtime-home ]]; then RUNTIME_HOME="$2"; else SOURCE_DATA_DIR="$2"; fi
      shift 2
      ;;
    --accept-fewer-rows)
      ACCEPT_FEWER_ROWS=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown option: $1"
      ;;
  esac
done

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# ── Checks ──────────────────────────────────────────────────────────────────────────────────────

for tool in postgres psql pg_dump pg_restore createdb pg_isready; do
  [[ -x "$PG_BIN/$tool" ]] || fail "$tool isn't in $PG_BIN. Install Postgres with: brew install postgresql@17"
done
[[ -x "$PYTHON" ]] || fail "$PYTHON is missing. Install the Xcode command line tools with: xcode-select --install"
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || fail "Node isn't installed. Install it, or set IMMORADAR_NODE_BIN."
[[ -f "$MIGRATE_SCRIPT" ]] || fail "The migration script is missing: $MIGRATE_SCRIPT. Build it with: npm run build"
[[ -x "$SCRIPT_DIR/start-postgres.sh" && -x "$SCRIPT_DIR/run-migrations.sh" ]] ||
  fail "start-postgres.sh and run-migrations.sh must sit next to this script in $SCRIPT_DIR."
PG_MAJOR="$(server_major_version)"

RUNTIME_HOME="${RUNTIME_HOME%/}"
[[ -n "$RUNTIME_HOME" ]] || fail "--runtime-home can't be /."
RUNTIME_HOME="$(absolute_path "$RUNTIME_HOME")"
RUNTIME_PARENT="$(dirname "$RUNTIME_HOME")"

SOURCE_DATA_DIR="$(absolute_path "$SOURCE_DATA_DIR")"
[[ -d "$SOURCE_DATA_DIR" ]] || fail "The source folder doesn't exist: $SOURCE_DATA_DIR"
[[ -f "$SOURCE_DATA_DIR/PG_VERSION" ]] || fail "$SOURCE_DATA_DIR isn't a Postgres data folder."
SOURCE_DATA_DIR="$(cd "$SOURCE_DATA_DIR" && pwd -P)"

mkdir -p "$RUNTIME_PARENT"
RUNTIME_PARENT_REAL="$(cd "$RUNTIME_PARENT" && pwd -P)"
RUNTIME_HOME_REAL="$RUNTIME_PARENT_REAL/$(basename "$RUNTIME_HOME")"
case "$RUNTIME_PARENT_REAL/" in
  "$SOURCE_DATA_DIR/"*) fail "The runtime home can't be inside the source folder." ;;
esac
case "$SOURCE_DATA_DIR/" in
  "$RUNTIME_HOME_REAL/"*) fail "The source folder can't be inside the runtime home." ;;
esac

# ── Lock ────────────────────────────────────────────────────────────────────────────────────────

# The app takes this lock with O_EXLOCK, which is flock on macOS. Bash can't take a flock itself,
# so python3 takes it on descriptor 9 of this shell. The lock belongs to the open file, so it stays
# held after python3 exits, until this script and every server it starts are gone. The PID written
# is this script's, which the app reports as a tool holding the lock. Opening with <> doesn't
# truncate, so the PID of another holder stays readable.
LOCK_FILE="$RUNTIME_PARENT/engine.lock"
if [[ -e "$LOCK_FILE" && ! -w "$LOCK_FILE" ]]; then
  fail "This account can't write to $LOCK_FILE."
fi
exec 9<>"$LOCK_FILE"
lock_status=0
"$PYTHON" -I -c 'import errno, fcntl, os, sys
try:
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError as error:
    if error.errno in (errno.EWOULDBLOCK, errno.EAGAIN):
        sys.exit(75)
    raise
os.ftruncate(9, 0)
os.pwrite(9, ("%s\n" % sys.argv[1]).encode(), 0)' "$$" || lock_status=$?
if [[ $lock_status -eq 75 ]]; then
  holder="$(tr -dc '0-9' <"$LOCK_FILE" 2>/dev/null || true)"
  holder_name=""
  if is_number "$holder" && is_running "$holder"; then
    holder_name="$(ps -o comm= -p "$holder" 2>/dev/null || true)"
    holder_name="${holder_name##*/}"
  fi
  if [[ -n "$holder_name" ]]; then
    fail "$holder_name (PID $holder) holds $LOCK_FILE. Quit ImmoRadar, or wait for the other import to finish, then run this again."
  fi
  fail "Another process holds $LOCK_FILE. Quit ImmoRadar, or wait for the other import to finish, then run this again."
elif [[ $lock_status -ne 0 ]]; then
  fail "Couldn't lock $LOCK_FILE."
fi

STAMP="$(date -u +%Y%m%d_%H%M%S)"
PRE_IMPORT_DB="immoradar_pre_import_$STAMP"
BACKUP_DIR="$RUNTIME_PARENT/backups"
DUMP_FILE="$BACKUP_DIR/immoradar-legacy-$STAMP.dump"
mkdir -p "$RUNTIME_PARENT/import-work" "$BACKUP_DIR"
WORK_DIR="$RUNTIME_PARENT/import-work/$STAMP-$$"
mkdir "$WORK_DIR"

# ── Engine data folder ──────────────────────────────────────────────────────────────────────────

RUNTIME_DATA_DIR="$RUNTIME_HOME/postgres/data"
if [[ -f "$RUNTIME_DATA_DIR/PG_VERSION" ]]; then
  [[ "$(cat "$RUNTIME_DATA_DIR/PG_VERSION")" == "$PG_MAJOR" ]] ||
    fail "The engine's cluster is Postgres $(cat "$RUNTIME_DATA_DIR/PG_VERSION"), and $PG_BIN holds Postgres $PG_MAJOR."
  running="$(postgres_pids_in "$(cd "$RUNTIME_DATA_DIR" && pwd -P)")"
  if [[ -n "$running" ]]; then
    fail "The engine's Postgres is still running (PID ${running%%$'\n'*}). Quit ImmoRadar, wait for it to stop, then run this again."
  fi
else
  say "The engine has no Postgres cluster yet. start-postgres.sh creates one in $RUNTIME_DATA_DIR."
fi

# ── 1. Source ───────────────────────────────────────────────────────────────────────────────────

running="$(postgres_pids_in "$SOURCE_DATA_DIR")"
if [[ -n "$running" ]]; then
  pm_pid="$(pid_file_line "$SOURCE_DATA_DIR/postmaster.pid" 1)"
  pm_port="$(pid_file_line "$SOURCE_DATA_DIR/postmaster.pid" 4)"
  pm_socket="$(pid_file_line "$SOURCE_DATA_DIR/postmaster.pid" 5)"
  is_number "$pm_pid" ||
    fail "Postgres runs in $SOURCE_DATA_DIR, but its postmaster.pid names no process. Stop that server, then run this again."
  case $'\n'"$running"$'\n' in
    *$'\n'"$pm_pid"$'\n'*) ;;
    *) fail "Postgres runs in $SOURCE_DATA_DIR, but its postmaster.pid names another process. Stop that server, then run this again." ;;
  esac
  is_number "$pm_port" || fail "$SOURCE_DATA_DIR/postmaster.pid has no port."
  SOURCE_PORT="$pm_port"
  SOURCE_HOST=127.0.0.1
  if [[ -n "$pm_socket" && -S "$pm_socket/.s.PGSQL.$pm_port" ]]; then
    SOURCE_HOST="$pm_socket"
  fi
  "$PG_BIN/pg_isready" -q -h "$SOURCE_HOST" -p "$SOURCE_PORT" -t 5 ||
    fail "Postgres (PID $pm_pid) runs in $SOURCE_DATA_DIR but doesn't accept connections on port $SOURCE_PORT. Wait until it does, or stop it, then run this again."
  say "The source server is running (PID $pm_pid, port $SOURCE_PORT). Dumping from it directly."
  expected_data_dir="$SOURCE_DATA_DIR"
else
  if [[ -f "$SOURCE_DATA_DIR/postmaster.pid" ]]; then
    say "No server runs in $SOURCE_DATA_DIR. Its postmaster.pid is left over from an earlier run."
  fi
  # A symlink means some of the data, such as a tablespace or pg_wal, lives outside the folder, and
  # the clone's server would write to it there.
  link="$(find "$SOURCE_DATA_DIR" -type l 2>/dev/null | head -n 1 || true)"
  [[ -z "$link" ]] ||
    fail "$link points outside the source folder, so a clone would write there. Start the source server and run this again to dump it directly."
  [[ "$(cat "$SOURCE_DATA_DIR/PG_VERSION")" == "$PG_MAJOR" ]] ||
    fail "The source cluster is Postgres $(cat "$SOURCE_DATA_DIR/PG_VERSION"), and $PG_BIN holds Postgres $PG_MAJOR."
  # clonefile only works within one volume. Elsewhere cp makes a full copy.
  if [[ "$(stat -f %d "$SOURCE_DATA_DIR")" != "$(stat -f %d "$WORK_DIR")" ]]; then
    need_kb="$(du -sk "$SOURCE_DATA_DIR" | awk '{ print $1 }')"
    free_kb="$(df -Pk "$WORK_DIR" | awk 'NR == 2 { print $4 }')"
    ((free_kb > need_kb)) ||
      fail "A copy of the source folder needs $((need_kb / 1024)) MB, and $((free_kb / 1024)) MB are free next to $WORK_DIR."
  fi

  say "Cloning $SOURCE_DATA_DIR into $WORK_DIR/source-data."
  CLONE_DIR="$WORK_DIR/source-data"
  cp -cRp "$SOURCE_DATA_DIR" "$CLONE_DIR"
  rm -f "$CLONE_DIR/postmaster.pid"

  SOURCE_PORT="$(free_port)" || fail "Couldn't find a free port."
  SOURCE_HOST=127.0.0.1
  SOURCE_LOG="$WORK_DIR/source-postgres.log"
  # data_directory on the command line wins over one in the clone's postgresql.conf, which could
  # name the source folder. external_pid_file and the socket would be written outside the clone.
  "$PYTHON" -I -c "$DETACH" "$PG_BIN/postgres" \
    -D "$CLONE_DIR" \
    -p "$SOURCE_PORT" \
    -c data_directory="$CLONE_DIR" \
    -c listen_addresses=127.0.0.1 \
    -c unix_socket_directories= \
    -c external_pid_file= \
    -c logging_collector=off \
    -c archive_mode=off \
    </dev/null >>"$SOURCE_LOG" 2>&1 &
  SOURCE_SERVER_PID=$!
  say "Starting the clone's Postgres on port $SOURCE_PORT."
  wait_until_ready "$SOURCE_SERVER_PID" "$SOURCE_PORT" "$(id -un)" "$CLONE_DIR" "The clone's Postgres" "$SOURCE_LOG"
  expected_data_dir="$(cd "$CLONE_DIR" && pwd -P)"
fi

SOURCE_ROLE="$(pick_role "$SOURCE_HOST" "$SOURCE_PORT" "$(id -un)" postgres)" ||
  fail "Couldn't connect to the source server as $(id -un) or postgres."
reported="$(source_psql -d template1 -tAc 'SHOW data_directory')"
reported="$(cd "$reported" 2>/dev/null && pwd -P || printf '%s' "$reported")"
[[ "$reported" == "$expected_data_dir" ]] ||
  fail "The server on port $SOURCE_PORT serves $reported, not $expected_data_dir."

# ── 2. Dump ─────────────────────────────────────────────────────────────────────────────────────

say "Databases in the source cluster:"
source_psql -d template1 -tA -F "$TAB" -c "
  SELECT datname,
         CASE WHEN has_database_privilege(datname, 'CONNECT')
              THEN pg_size_pretty(pg_database_size(datname)) ELSE 'no access' END
  FROM pg_database
  ORDER BY datname" |
  while IFS="$TAB" read -r name size; do
    printf '  %-40s %s\n' "$name" "$size"
  done

if [[ "$(source_psql -d template1 -tAc "SELECT 1 FROM pg_database WHERE datname = 'immoradar'")" != 1 ]]; then
  say "The source cluster has no immoradar database. Nothing to import."
  exit 0
fi

# Counted before the dump, so on a running server the dump holds at least these rows.
SOURCE_COUNTS="$WORK_DIR/source-counts.tsv"
count_rows source_psql immoradar "$SOURCE_COUNTS"
SOURCE_LISTINGS="$(awk -F "$TAB" '$1 == "listings" { print $2 }' "$SOURCE_COUNTS")"
SOURCE_LISTINGS="${SOURCE_LISTINGS:-0}"
say "The source immoradar database has $(wc -l <"$SOURCE_COUNTS" | tr -d ' ') tables and $SOURCE_LISTINGS listings."

RUNTIME_PORT="$(free_port)" || fail "Couldn't find a free port."
RUNTIME_LOG="$WORK_DIR/engine-postgres.log"
"$PYTHON" -I -c "$DETACH" /usr/bin/env \
  "IMMORADAR_RUNTIME_HOME=$RUNTIME_HOME" \
  "IMMORADAR_POSTGRES_PORT=$RUNTIME_PORT" \
  "IMMORADAR_POSTGRES_BIN_DIR=$PG_BIN" \
  "$SCRIPT_DIR/start-postgres.sh" \
  </dev/null >>"$RUNTIME_LOG" 2>&1 &
RUNTIME_SERVER_PID=$!
say "Starting the engine's Postgres on port $RUNTIME_PORT."
wait_until_ready "$RUNTIME_SERVER_PID" "$RUNTIME_PORT" postgres "$RUNTIME_DATA_DIR" "The engine's Postgres" "$RUNTIME_LOG"

# Checked before the dump so that a refusal comes early. The data counted is the same.
RUNTIME_HAS_IMMORADAR=""
RUNTIME_LISTINGS=0
if runtime_database_exists immoradar; then
  RUNTIME_HAS_IMMORADAR=1
  if [[ "$(runtime_psql -d immoradar -tAc "SELECT to_regclass('public.listings') IS NOT NULL")" == t ]]; then
    RUNTIME_LISTINGS="$(runtime_psql -d immoradar -tAc 'SELECT count(*) FROM public.listings')"
  fi
fi
if ((RUNTIME_LISTINGS > SOURCE_LISTINGS)); then
  if [[ -z "$ACCEPT_FEWER_ROWS" ]]; then
    fail "The engine's database has $RUNTIME_LISTINGS listings and the source has $SOURCE_LISTINGS. Nothing was changed. To import anyway, run this again with --accept-fewer-rows. The engine's database is then kept as immoradar_pre_import_<time>."
  fi
  say "The engine's database has $RUNTIME_LISTINGS listings and the source has $SOURCE_LISTINGS. Importing anyway because of --accept-fewer-rows."
fi

# The dump is at most about the size of the database, and so is the restored copy.
source_bytes="$(source_psql -d template1 -tAc "SELECT pg_database_size('immoradar')")"
need_kb=$((source_bytes * 2 / 1024))
free_kb="$(df -Pk "$RUNTIME_PARENT" | awk 'NR == 2 { print $4 }')"
((free_kb > need_kb)) ||
  fail "The dump and the restored copy need about $((need_kb / 1024)) MB, and $((free_kb / 1024)) MB are free next to $RUNTIME_PARENT."

say "Dumping immoradar as $SOURCE_ROLE into $DUMP_FILE."
DUMP_LOG="$WORK_DIR/pg_dump.log"
"$PG_BIN/pg_dump" -Fc -w -h "$SOURCE_HOST" -p "$SOURCE_PORT" -U "$SOURCE_ROLE" -d immoradar \
  -f "$DUMP_FILE.partial" >>"$DUMP_LOG" 2>&1 ||
  fail "pg_dump failed. See $DUMP_LOG"
chmod 600 "$DUMP_FILE.partial"
mv "$DUMP_FILE.partial" "$DUMP_FILE"

if [[ -n "$SOURCE_SERVER_PID" ]]; then
  stop_server "$SOURCE_SERVER_PID" "the clone's Postgres" "$CLONE_DIR" || fail "The clone's Postgres didn't stop."
  SOURCE_SERVER_PID=""
  remove_clone
fi

# ── 3. Restore ──────────────────────────────────────────────────────────────────────────────────

if runtime_database_exists immoradar_import; then
  say "Dropping immoradar_import, which an earlier run left behind."
  runtime_psql -d postgres -c 'DROP DATABASE immoradar_import WITH (FORCE)' >/dev/null
fi
IMPORT_DB_CREATED=1
"$PG_BIN/createdb" -w -h 127.0.0.1 -p "$RUNTIME_PORT" -U postgres \
  --template=template0 --encoding=UTF8 --lc-collate=C --lc-ctype=en_US.UTF-8 immoradar_import

say "Restoring the dump into immoradar_import."
RESTORE_LOG="$WORK_DIR/pg_restore.log"
"$PG_BIN/pg_restore" -w -h 127.0.0.1 -p "$RUNTIME_PORT" -U postgres -d immoradar_import \
  --no-owner --no-privileges --exit-on-error "$DUMP_FILE" >>"$RESTORE_LOG" 2>&1 ||
  fail "pg_restore failed. See $RESTORE_LOG"

say "Running the migrations on immoradar_import."
MIGRATIONS_LOG="$WORK_DIR/migrations.log"
/usr/bin/env \
  "IMMORADAR_RUNTIME_ROOT=${IMMORADAR_RUNTIME_ROOT:-$REPO_ROOT}" \
  "IMMORADAR_RUNTIME_HOME=$RUNTIME_HOME" \
  "IMMORADAR_POSTGRES_BIN_DIR=$PG_BIN" \
  "IMMORADAR_NODE_BIN=$NODE_BIN" \
  "IMMORADAR_MIGRATE_SCRIPT=$MIGRATE_SCRIPT" \
  "DATABASE_URL=postgres://postgres@127.0.0.1:$RUNTIME_PORT/immoradar_import" \
  "REDIS_URL=redis://127.0.0.1:1" \
  NODE_ENV=development \
  "$SCRIPT_DIR/run-migrations.sh" \
  </dev/null >>"$MIGRATIONS_LOG" 2>&1 ||
  fail "The migrations failed on immoradar_import. See $MIGRATIONS_LOG"
applied="$(sed -n 's/.*Applying migration: \([^" ]*\).*/\1/p' "$MIGRATIONS_LOG" | tr '\n' ' ')"
if [[ -n "$applied" ]]; then
  say "Applied migrations: $applied"
else
  say "No migrations were pending."
fi

# ── 4. Verify ───────────────────────────────────────────────────────────────────────────────────

IMPORT_COUNTS="$WORK_DIR/import-counts.tsv"
VERIFY_FILE="$WORK_DIR/verify.tsv"
count_rows runtime_psql immoradar_import "$IMPORT_COUNTS"
if ! awk -F "$TAB" -v OFS="$TAB" '
  FILENAME == ARGV[1] { imported[$1] = $2; next }
  {
    if (!($1 in imported)) { print $1, $2, "-", "missing"; bad = 1 }
    else if (imported[$1] + 0 < $2 + 0) { print $1, $2, imported[$1], "fewer rows"; bad = 1 }
    else { print $1, $2, imported[$1], "ok" }
  }
  END { exit bad }' "$IMPORT_COUNTS" "$SOURCE_COUNTS" >"$VERIFY_FILE"; then
  print_counts "$VERIFY_FILE"
  fail "immoradar_import is missing tables or rows."
fi

ilike="$(runtime_psql -d immoradar_import -tAc "SELECT 'KÜCHE' ILIKE '%küche%'")"
[[ "$ilike" == t ]] || fail "ILIKE doesn't fold umlauts in immoradar_import, so keyword search would miss German words."

# ── 5. Swap ─────────────────────────────────────────────────────────────────────────────────────

if [[ -n "$RUNTIME_HAS_IMMORADAR" ]]; then
  swap_sql="ALTER DATABASE immoradar RENAME TO $PRE_IMPORT_DB; ALTER DATABASE immoradar_import RENAME TO immoradar;"
else
  swap_sql="ALTER DATABASE immoradar_import RENAME TO immoradar;"
fi
runtime_psql -1 -d postgres -c "$swap_sql" >/dev/null || fail "Couldn't rename the databases."
SWAPPED=1

if stop_server "$RUNTIME_SERVER_PID" "the engine's Postgres" "$RUNTIME_DATA_DIR"; then
  RUNTIME_SERVER_PID=""
fi

say ""
say "Import finished."
print_counts "$VERIFY_FILE"
say "  Tables:  $(wc -l <"$VERIFY_FILE" | tr -d ' '), each with at least its source row count"
say "  Backup:  $DUMP_FILE"
if [[ -n "$RUNTIME_HAS_IMMORADAR" ]]; then
  say "  Kept:    the engine's previous database, as $PRE_IMPORT_DB"
else
  say "  Kept:    nothing, because the engine had no immoradar database"
fi
say "  Logs:    $WORK_DIR"

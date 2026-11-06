#!/usr/bin/env bash
# Installs the app from a DMG into a private folder, runs it from there, and checks that the engine
# starts and that it stops however the app dies.
#
#   P1  Cold start without workers, then SIGTERM, which takes the same path as Quit.
#   P2  Workers and Chromium. A second instance, a scraper crash, then kill -9 with an alert stream open.
#   P3  The watchdog killed, then the app, watchdog and postmaster killed together, then a relaunch.
#
# Every path the app writes sits under that folder, schedules are off, and only processes running
# from that folder ever get a signal.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DMG_PATH="${1:-${IMMORADAR_SMOKE_DMG_PATH:-$REPO_ROOT/.build/macos-release/ImmoRadar-macOS.dmg}}"

[[ -f "$DMG_PATH" ]] || { echo "DMG not found: $DMG_PATH" >&2; exit 1; }

# Short, because Chromium keeps sockets under <root>/t and macOS limits socket paths to 104 bytes.
TMP_ROOT="$(mktemp -d /private/tmp/immoradar-smoke.XXXXXX)"
TMP_ROOT="$(cd "$TMP_ROOT" && pwd -P)"
MOUNT_POINT="$TMP_ROOT/mount"
INSTALLED_APP="$TMP_ROOT/install/ImmoRadar.app"
MOUNTED=0

detach_image() {
  if [[ "$MOUNTED" == 1 ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet || hdiutil detach "$MOUNT_POINT" -force -quiet || true
    MOUNTED=0
  fi
}

cleanup() {
  local status=$?
  detach_image
  if [[ "$status" == 0 ]]; then
    rm -rf "$TMP_ROOT"
  else
    echo "Smoke diagnostics kept at $TMP_ROOT" >&2
  fi
}
trap cleanup EXIT

mkdir -p "$MOUNT_POINT" "$TMP_ROOT/install" "$TMP_ROOT/home" "$TMP_ROOT/t" "$TMP_ROOT/runtime-home" "$TMP_ROOT/logs"
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -nobrowse -quiet
MOUNTED=1
[[ -d "$MOUNT_POINT/ImmoRadar.app" ]] || { echo "DMG has no ImmoRadar.app" >&2; exit 1; }
cp -R "$MOUNT_POINT/ImmoRadar.app" "$INSTALLED_APP"
detach_image

SIGNATURE="$(/usr/bin/codesign -dvv "$INSTALLED_APP" 2>&1 || true)"
if [[ "$SIGNATURE" == *"Authority=Developer ID Application"* ]]; then
  /usr/bin/codesign --verify --deep --strict "$INSTALLED_APP"
fi

# In the background, so a signal reaches this shell's trap right away and Python gets to clean up.
SMOKE_PID=""
STOP_REQUESTED=""
stop_smoke() {
  STOP_REQUESTED=1
  [[ -z "$SMOKE_PID" ]] || kill -TERM "$SMOKE_PID" 2>/dev/null || true
}
trap stop_smoke TERM INT HUP QUIT

env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /usr/bin/python3 - "$TMP_ROOT" <<'PY' &
import collections
import ctypes
import json
import os
import plistlib
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

root = sys.argv[1]
if os.path.realpath(root) != root:
    raise RuntimeError('The smoke root must be a canonical path')

# macOS strips /private from some paths the app derives, so scripts can appear under either form.
root_in_arguments = root[len('/private'):] + '/'
app_path = root + '/install/ImmoRadar.app/Contents/MacOS/ImmoRadar'
bundled_pg_config = root + '/install/ImmoRadar.app/Contents/Resources/runtime/infra/postgres/bin/pg_config'
logs = Path(root, 'logs')
diagnostics_file = logs / 'startup-diagnostics.json'
api_log = logs / 'api.log'
postmaster_pid_file = Path(root, 'runtime-home/postgres/data/postmaster.pid')
run_record = Path(root, 'runtime-home/engine-run.json')
tool_environment = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C'}
stop_signals = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT)

CORE_ROLES = ['app', 'watchdog', 'postmaster', 'redis', 'api']
ACTIVE_ROLES = CORE_ROLES + ['processing', 'scraper', 'chromium']
# These come and go during normal work, so counts and comparisons skip them.
TRANSIENT_ROLES = ('pg-child', 'chromium-helper')
ACTIVE_ENVIRONMENT = {'IMMORADAR_SMOKE_BOOT_MODE': 'active', 'IMMORADAR_SMOKE_LAUNCH_BROWSER': '1'}
DISABLED_FEATURES = [
    'SCHEDULER_ENABLED', 'SCRAPER_CANARY_ENABLED', 'FEATURE_GEOCODING_ENABLED',
    'FEATURE_CROSS_SOURCE_CLUSTERING_ENABLED', 'ALERTS_EMAIL_ENABLED', 'ALERTS_WEBHOOK_ENABLED',
    'ALERTS_PUSH_ENABLED', 'OUTREACH_ENABLED', 'PROMETHEUS_ENABLED',
]

PROC_PIDTBSDINFO = 3
SZOMB = 5


class SmokeFailure(Exception):
    pass


def log(message):
    print(f'{time.strftime("%H:%M:%S")} {message}', flush=True)


def require(passed, message):
    if not passed:
        raise SmokeFailure(message)


class BsdInfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint32) for name in (
        'flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid', 'ruid', 'rgid',
        'svuid', 'svgid', 'reserved')]
    _fields_ += [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)]
    _fields_ += [(name, ctypes.c_uint32) for name in ('nfiles', 'pgid', 'pjobc', 'tdev', 'tpgid')]
    _fields_ += [('nice', ctypes.c_int32), ('start_sec', ctypes.c_uint64), ('start_usec', ctypes.c_uint64)]


assert ctypes.sizeof(BsdInfo) == 136
libproc = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
libproc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
libproc.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
libproc.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]

Process = collections.namedtuple('Process', 'pid ppid start path arguments role')


def all_pids():
    count = libproc.proc_listallpids(None, 0)
    buffer = (ctypes.c_int * (count + 256))()
    count = libproc.proc_listallpids(buffer, ctypes.sizeof(buffer))
    return list(buffer[:max(count, 0)])


def live_info(pid):
    """This user's process, or None when it has exited, belongs to someone else, or is a zombie."""
    info = BsdInfo()
    size = libproc.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, ctypes.byref(info), ctypes.sizeof(info))
    if size != ctypes.sizeof(info) or info.pid != pid or info.uid != os.getuid() or info.status == SZOMB:
        return None
    return info


def executable_path(pid):
    buffer = ctypes.create_string_buffer(4096)
    size = libproc.proc_pidpath(pid, buffer, len(buffer))
    return os.fsdecode(buffer.value) if size > 0 else None


def argument_table():
    output = subprocess.run(['/bin/ps', '-axww', '-o', 'pid=,args='], env=tool_environment, capture_output=True,
                            text=True, errors='replace', check=True).stdout
    table = {}
    for line in output.splitlines():
        fields = line.split(None, 1)
        if fields:
            table[int(fields[0])] = fields[1] if len(fields) > 1 else ''
    return table


def role_of(path, arguments, parent_path):
    parent_name = os.path.basename(parent_path) if parent_path else None
    if path == app_path:
        return 'app'
    if path == '/bin/bash':
        return 'watchdog' if 'scripts/engine-watchdog.sh' in arguments else 'shell'
    name = os.path.basename(path)
    if name == 'postgres':
        return 'pg-child' if parent_name == 'postgres' else 'postmaster'
    if name == 'redis-server':
        return 'redis'
    if '/playwright-browsers/' in path:
        return 'chromium-helper' if parent_name == name else 'chromium'
    if name == 'node':
        for entry, role in (('apps/api/dist/main.js', 'api'),
                            ('apps/worker-processing/dist/main.js', 'processing'),
                            ('apps/worker-scraper/dist/main.js', 'scraper')):
            if entry in arguments:
                return role
    return 'other'


def runs_script_from_root(arguments):
    words = arguments.split()
    return len(words) > 1 and words[1].startswith((root + '/', root_in_arguments))


def engine_processes():
    """Every process running from the root, or a shell running a script from the root."""
    arguments = argument_table()
    found = {}
    for pid in all_pids():
        info = live_info(pid)
        path = executable_path(pid) if info else None
        if path and (path.startswith(root + '/')
                     or (path == '/bin/bash' and runs_script_from_root(arguments.get(pid, '')))):
            found[pid] = (info, path, arguments.get(pid, ''))
    return {
        pid: Process(pid, info.ppid, (info.start_sec, info.start_usec), path, args,
                     role_of(path, args, found[info.ppid][1] if info.ppid in found else None))
        for pid, (info, path, args) in found.items()
    }


def of_role(role):
    return [process for process in engine_processes().values() if process.role == role]


def is_alive(process):
    info = live_info(process.pid)
    return (info is not None and (info.start_sec, info.start_usec) == process.start
            and executable_path(process.pid) == process.path)


def send(process, signal_number):
    """A PID can be reused, so this signals only the exact process that was observed earlier."""
    require(is_alive(process), f'{process.role} ({process.pid}) was gone before it could be signaled')
    os.kill(process.pid, signal_number)


def identities(exclude=()):
    return {(p.pid, p.start): p.role for p in engine_processes().values()
            if p.role not in TRANSIENT_ROLES and p.role not in exclude}


def require_unchanged(before, exclude, cause):
    after = identities(exclude)
    if after != before:
        gone = sorted(role for key, role in before.items() if key not in after)
        new = sorted(role for key, role in after.items() if key not in before)
        raise SmokeFailure(f'{cause} changed other processes: gone {gone}, new {new}')


def immoradar_outside_root():
    """The app and databases of a running copy. Its workers and Chromium start and end on their own."""
    found = set()
    for pid in all_pids():
        info = live_info(pid)
        path = executable_path(pid) if info else None
        if (path and 'ImmoRadar' in path and not path.startswith(root + '/')
                and os.path.basename(path) in ('ImmoRadar', 'postgres', 'redis-server')
                and executable_path(info.ppid) != path):
            found.add((pid, info.start_sec, info.start_usec, path))
    return found


def real_preferences():
    output = subprocess.run(['/usr/bin/defaults', 'export', 'com.immoradar.app', '-'], env=tool_environment,
                            capture_output=True).stdout
    return plistlib.loads(output) if output else {}


def wait_until(predicate, timeout, interval=0.2):
    """Seconds taken, or None on timeout."""
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        if predicate():
            return time.monotonic() - started
        time.sleep(interval)
    return None


reservations = [socket.socket() for _ in range(3)]
for reservation in reservations:
    reservation.bind(('127.0.0.1', 0))
api_port, postgres_port, redis_port = [reservation.getsockname()[1] for reservation in reservations]
for reservation in reservations:
    reservation.close()
ports = [api_port, postgres_port, redis_port]
api = f'http://127.0.0.1:{api_port}'
token = 'smoke-' + str(uuid.uuid4())

base_environment = {
    'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C', 'LC_ALL': 'C', 'LC_CTYPE': 'C',
    'HOME': root + '/home', 'CFFIXED_USER_HOME': root + '/home', 'TMPDIR': root + '/t',
    'IMMORADAR_SMOKE_TEST': '1', 'IMMORADAR_SMOKE_ROOT': root,
    'IMMORADAR_API_BASE_URL_OVERRIDE': api,
    'IMMORADAR_RUNTIME_HOME_OVERRIDE': root + '/runtime-home',
    'IMMORADAR_LOGS_DIRECTORY_OVERRIDE': str(logs),
    'IMMORADAR_LOCAL_RUNTIME_API_TOKEN': token,
    'IMMORADAR_POSTGRES_PORT_OVERRIDE': str(postgres_port),
    'IMMORADAR_REDIS_PORT_OVERRIDE': str(redis_port),
}
base_environment.update((key, 'false') for key in DISABLED_FEATURES)

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api_answers(path, with_token=False):
    request = urllib.request.Request(api + path)
    if with_token:
        request.add_header('Authorization', 'Bearer ' + token)
    try:
        with opener.open(request, timeout=3) as response:
            return response.status == 200
    except OSError:
        return False


def port_refuses(port):
    with socket.socket() as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(('127.0.0.1', port)) != 0


def diagnostics():
    try:
        return json.loads(diagnostics_file.read_text())
    except (OSError, ValueError):
        return {}


def app_output():
    return Path(root, 'app-stdout.log').read_text(errors='replace')[-2000:]


def start_app(extra_environment):
    with open(Path(root, 'app-stdout.log'), 'ab') as output:
        return subprocess.Popen([app_path], cwd=root, env={**base_environment, **extra_environment},
                                stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                start_new_session=True)


def launch_and_wait(extra_environment, boot_mode):
    # A killed app leaves its last status behind, and an orphaned API can still answer /health.
    diagnostics_file.unlink(missing_ok=True)
    app = start_app(extra_environment)

    def running():
        if app.poll() is not None:
            raise SmokeFailure(f'The app exited with status {app.returncode}: {app_output()}')
        current = diagnostics()
        if current.get('status') == 'failed':
            raise SmokeFailure(f'The engine failed to start: {current.get("failureMessage")}')
        return current.get('status') == 'running'

    elapsed = wait_until(running, 180)
    require(elapsed is not None, f'The engine never reached running: {diagnostics()}')
    log(f'Engine running after {elapsed:.1f}s')
    require(diagnostics().get('bootMode') == boot_mode, f'Expected boot mode {boot_mode}: {diagnostics()}')
    require(api_answers('/health'), 'The API does not answer /health')
    require(api_answers('/v1/alerts/unread-count', with_token=True), 'The API does not answer with the smoke token')
    return app


def expect_roles(expected, timeout=30):
    """One process per role in `expected` and nothing else that lasts."""
    def matches():
        return sorted(identities().values()) == sorted(expected)

    if wait_until(matches, timeout) is None:
        raise SmokeFailure(f'Expected {sorted(expected)}, found {sorted(identities().values())}')


def expect_all_gone(name):
    def gone():
        return not engine_processes() and all(port_refuses(port) for port in ports)

    elapsed = wait_until(gone, 40)
    if elapsed is None:
        left = sorted((p.role, p.pid) for p in engine_processes().values())
        open_ports = [port for port in ports if not port_refuses(port)]
        raise SmokeFailure(f'{name}: still running after 40s: {left}, open ports {open_ports}')
    require(not postmaster_pid_file.exists(), f'{name}: postmaster.pid is still there')
    require(not run_record.exists(), f'{name}: engine-run.json is still there')
    log(f'{name}: everything stopped in {elapsed:.1f}s')


def log_size(path):
    return path.stat().st_size if path.exists() else 0


def log_since(path, offset):
    with open(path, 'rb') as stream:
        stream.seek(offset)
        return stream.read().decode(errors='replace')


def open_alert_stream():
    stream = socket.create_connection(('127.0.0.1', api_port), timeout=5)
    stream.sendall((f'GET /v1/stream/alerts HTTP/1.1\r\nHost: 127.0.0.1:{api_port}\r\n'
                    f'Authorization: Bearer {token}\r\nAccept: text/event-stream\r\n\r\n').encode())
    headers = stream.recv(4096).decode('latin-1')
    require(headers.startswith('HTTP/1.1 200') and 'text/event-stream' in headers.lower(),
            f'The alert stream did not open: {headers[:200]}')
    return stream


def stream_ended(stream, timeout):
    stream.settimeout(timeout)
    try:
        while stream.recv(4096):
            pass
        return True
    except socket.timeout:
        return False
    except OSError:
        return True


def check_bundled_postgres_folders():
    """Outside the bundle would mean it only works on a Mac with Homebrew's Postgres."""
    result = subprocess.run([bundled_pg_config, '--sharedir', '--pkglibdir'], env=tool_environment,
                            capture_output=True, text=True)
    require(result.returncode == 0, f'pg_config failed: {result.stderr}')
    for folder in result.stdout.splitlines():
        require(folder.startswith((root + '/', root_in_arguments)),
                f'The bundled Postgres reads from outside the bundle: {folder}')


def phase_cold_start():
    log('P1: cold start without workers')
    app = launch_and_wait({}, 'setup')
    expect_roles(CORE_ROLES)
    send(of_role('app')[0], signal.SIGTERM)
    expect_all_gone('P1 SIGTERM')
    require(app.wait(timeout=5) == 0, f'The app exited with status {app.returncode} after SIGTERM')


def phase_crashes():
    log('P2: workers, Chromium and crashes')
    app = launch_and_wait(ACTIVE_ENVIRONMENT, 'active')
    expect_roles(ACTIVE_ROLES)

    before = identities()
    second = start_app(ACTIVE_ENVIRONMENT)
    require(second.wait(timeout=20) == 0, f'A second instance exited with status {second.returncode}')
    require_unchanged(before, (), 'A second instance')
    log('A second instance exited without touching the engine')

    scraper = of_role('scraper')[0]
    chromium = of_role('chromium') + of_role('chromium-helper')
    scraper_group = ('scraper', 'chromium')
    untouched = identities(scraper_group)
    send(scraper, signal.SIGKILL)
    gone = wait_until(lambda: not any(is_alive(process) for process in chromium), 5)
    require(gone is not None, 'Chromium outlived the scraper by more than 5s')
    replaced = wait_until(lambda: any((p.pid, p.start) != (scraper.pid, scraper.start) for p in of_role('scraper')), 15)
    require(replaced is not None, 'No new scraper within 15s of the crash')
    log(f'Scraper crash: Chromium gone in {gone:.1f}s, new scraper in {replaced:.1f}s')
    expect_roles(ACTIVE_ROLES)
    require_unchanged(untouched, scraper_group, 'A scraper crash')

    stream = open_alert_stream()
    api_offset = log_size(api_log)
    send(of_role('app')[0], signal.SIGKILL)
    expect_all_gone('P2 kill -9')
    app.wait(timeout=5)
    require(stream_ended(stream, 5), 'The alert stream stayed open after the engine stopped')
    stream.close()
    require('API server closed' in log_since(api_log, api_offset), 'The API did not shut down cleanly')


def phase_double_failure():
    log('P3: app, watchdog and postmaster killed together')
    app = launch_and_wait(ACTIVE_ENVIRONMENT, 'active')
    expect_roles(ACTIVE_ROLES)

    watchdog = of_role('watchdog')[0]
    untouched = identities(('watchdog',))
    send(watchdog, signal.SIGKILL)
    replaced = wait_until(lambda: any(p.pid != watchdog.pid for p in of_role('watchdog')), 5)
    require(replaced is not None, 'No new watchdog within 5s')
    require_unchanged(untouched, ('watchdog',), 'A watchdog death')
    log(f'Watchdog replaced in {replaced:.1f}s')

    before = set(identities())
    running_app = of_role('app')[0]
    running_watchdog = of_role('watchdog')[0]
    postmaster = of_role('postmaster')[0]
    # Stopped first, or the app replaces the watchdog before it dies.
    send(running_app, signal.SIGSTOP)
    send(running_watchdog, signal.SIGKILL)
    send(running_app, signal.SIGKILL)
    send(postmaster, signal.SIGKILL)
    app.wait(timeout=5)
    survivors = {p.role for p in engine_processes().values()}
    require({'api', 'processing', 'scraper', 'redis'} <= survivors, f'Too few survivors to test with: {survivors}')

    app = launch_and_wait(ACTIVE_ENVIRONMENT, 'active')
    expect_roles(ACTIVE_ROLES)
    reused = before & set(identities())
    require(not reused, f'Processes from the killed run are still in use: {reused}')
    log('Relaunch stopped the leftovers and Postgres recovered')

    send(of_role('app')[0], signal.SIGTERM)
    expect_all_gone('P3 SIGTERM')
    require(app.wait(timeout=5) == 0, f'The app exited with status {app.returncode} after SIGTERM')


def ignore_stop_signals():
    for number in stop_signals:
        signal.signal(number, signal.SIG_IGN)


def signal_if_alive(process, signal_number):
    """Cleanup carries on when a process exits between the check and the signal."""
    try:
        if is_alive(process):
            os.kill(process.pid, signal_number)
    except ProcessLookupError:
        pass


def stop_whatever_is_left():
    """True when nothing from the root is still running."""
    apps = of_role('app')
    for process in apps:
        signal_if_alive(process, signal.SIGTERM)
    if apps:
        wait_until(lambda: not engine_processes(), 40)
    for process in engine_processes().values():
        signal_if_alive(process, signal.SIGKILL)
    if wait_until(lambda: not engine_processes(), 5) is None:
        log(f'Could not stop: {sorted((p.role, p.pid) for p in engine_processes().values())}')
        return False
    return True


def interrupt(number, _frame):
    # Only the first signal counts, so a second Ctrl-C can't cut the cleanup short.
    ignore_stop_signals()
    raise SmokeFailure(f'Interrupted by {signal.Signals(number).name}')


for stop_signal in stop_signals:
    signal.signal(stop_signal, interrupt)

outside_before = immoradar_outside_root()
# A running copy of the real app writes its own preferences, which says nothing about this test.
preferences_before = None if outside_before else real_preferences()
if preferences_before is None:
    log('Not comparing preferences, because ImmoRadar is running outside the smoke root')

passed = False
try:
    try:
        check_bundled_postgres_folders()
        phase_cold_start()
        phase_crashes()
        phase_double_failure()
        require(not engine_processes(), 'Something from the smoke root is still running')
        require(immoradar_outside_root() == outside_before, 'An ImmoRadar process outside the smoke root changed')
        if preferences_before is not None:
            require(real_preferences() == preferences_before, 'The smoke run changed the real preferences')
        passed = True
    except SmokeFailure as failure:
        log(f'FAILED: {failure}')
    finally:
        # A signal that lands before this line still reaches the cleanup below, and none can after it.
        ignore_stop_signals()
finally:
    stopped = stop_whatever_is_left()

if not (passed and stopped):
    sys.exit(1)
log('Smoke test passed')
PY
SMOKE_PID=$!
[[ -z "$STOP_REQUESTED" ]] || kill -TERM "$SMOKE_PID" 2>/dev/null || true

# A trapped signal ends `wait` early, so this repeats until Python is gone. The script's exit status
# comes from the last `wait`.
set +e
while kill -0 "$SMOKE_PID" 2>/dev/null; do
  wait "$SMOKE_PID"
done
wait "$SMOKE_PID"

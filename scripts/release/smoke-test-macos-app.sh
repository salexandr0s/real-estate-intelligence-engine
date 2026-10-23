#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DMG_PATH="${1:-${IMMORADAR_SMOKE_DMG_PATH:-$REPO_ROOT/.build/macos-release/ImmoRadar-macOS.dmg}}"
RECEIPT_PATH="${2:?Pass the external reviewed artifact receipt as argument 2}"
RECEIPT_SHA256="${3:?Pass its independently reviewed SHA256 as argument 3}"
for command in hdiutil python3; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
[[ -f "$DMG_PATH" ]] || { echo "DMG not found: $DMG_PATH" >&2; exit 1; }

# Verify the caller-pinned receipt and disk image before mounting. The build
# owner supplies this receipt separately; this script never invents expected
# hashes from the candidate bundle. Existing callers need that integration.
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /usr/bin/python3 - "$DMG_PATH" "$RECEIPT_PATH" "$RECEIPT_SHA256" <<'RECEIPT'
import hashlib, json, os, pathlib, re, stat, sys
dmg, receipt = map(pathlib.Path, sys.argv[1:3])
pinned = sys.argv[3]
if not re.fullmatch('[0-9a-f]{64}', pinned) or not receipt.is_absolute() or receipt.resolve(strict=True) != receipt:
    raise RuntimeError('Expected an absolute external receipt and pinned SHA256')
metadata = receipt.stat()
if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o022 or metadata.st_size > 8 * 1024 * 1024:
    raise RuntimeError('Receipt must be a private task-owned regular file')
raw = receipt.read_bytes()
if hashlib.sha256(raw).hexdigest() != pinned:
    raise RuntimeError('Artifact receipt differs from the reviewed hash')
expected = json.loads(raw)['artifact']['sha256']
digest = hashlib.sha256()
with dmg.open('rb') as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
if digest.hexdigest() != expected:
    raise RuntimeError('Disk image differs from the reviewed artifact')
RECEIPT

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/immoradar-smoke.XXXXXX")"
TMP_ROOT="$(cd "$TMP_ROOT" && pwd -P)"
MOUNT_POINT="$TMP_ROOT/mount"
MOUNTED=0
LAUNCHED=0
cleanup() {
  local status=$?
  if [[ "$MOUNTED" == 1 ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
  fi
  if [[ "$LAUNCHED" == 0 || ( "$status" == 0 && -f "$TMP_ROOT/shutdown-complete" ) ]]; then
    rm -rf "$TMP_ROOT"
  else
    echo "Smoke diagnostics retained at $TMP_ROOT; no unverified process was signaled." >&2
  fi
}
trap cleanup EXIT
mkdir -p "$MOUNT_POINT" "$TMP_ROOT/install" "$TMP_ROOT/home" "$TMP_ROOT/tmp" "$TMP_ROOT/runtime-home" "$TMP_ROOT/logs"
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -nobrowse -quiet
MOUNTED=1
[[ -d "$MOUNT_POINT/ImmoRadar.app" ]] || { echo "DMG has no ImmoRadar.app" >&2; exit 1; }
cp -R "$MOUNT_POINT/ImmoRadar.app" "$TMP_ROOT/install/ImmoRadar.app"

# The supervisor owns a new process session. It never selects by bundle ID,
# executable name, a global process list, or a listening port.
LAUNCHED=1
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /usr/bin/python3 - "$TMP_ROOT" "$DMG_PATH" "$RECEIPT_PATH" "$RECEIPT_SHA256" <<'PY'
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.request
import uuid

root = Path(sys.argv[1]).resolve(strict=True)
app = root / 'install/ImmoRadar.app/Contents/MacOS/ImmoRadar'
runtime = root / 'install/ImmoRadar.app/Contents/Resources/runtime'
logs = root / 'logs'
records = {}
process = None
app_identity = None
success = False
shutting_down = False
supervisor_parent = os.getppid()
unverified = {}

def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RuntimeError('Duplicate JSON key in artifact receipt')
        result[key] = value
    return result

def valid_sha256(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None

def inventory_path(value):
    if not isinstance(value, str) or not value or '\x00' in value:
        raise RuntimeError('Malformed inventory path')
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or str(path) != value or value == '.':
        raise RuntimeError('Inventory path escapes or is not canonical')
    return value

def trusted_receipt(raw, pinned):
    if not valid_sha256(pinned) or sha256_bytes(raw) != pinned:
        raise RuntimeError('Artifact receipt differs from the independently reviewed hash')
    receipt = json.loads(raw, object_pairs_hook=unique_object)
    if not isinstance(receipt, dict) or type(receipt.get('schemaVersion')) is not int or receipt['schemaVersion'] != 1:
        raise RuntimeError('Unsupported artifact receipt')
    source = receipt.get('source', {})
    if (source.get('repository') != 'salexandr0s/real-estate-intelligence-engine'
            or not isinstance(source.get('revision'), str) or re.fullmatch('[0-9a-f]{40}', source['revision']) is None
            or not valid_sha256(source.get('treeSha256')) or not valid_sha256(receipt.get('artifact', {}).get('sha256'))):
        raise RuntimeError('Receipt lacks source revision or artifact provenance')
    inventory = receipt.get('inventory')
    if not isinstance(inventory, dict) or not inventory:
        raise RuntimeError('Receipt must bind the complete app inventory')
    for path, entry in inventory.items():
        inventory_path(path)
        if not isinstance(entry, dict) or entry.get('type') not in ('file', 'directory', 'symlink'):
            raise RuntimeError('Malformed inventory entry')
        if entry['type'] == 'file' and not valid_sha256(entry.get('sha256')):
            raise RuntimeError('Missing expected file hash')
        if entry['type'] == 'symlink' and (not isinstance(entry.get('target'), str) or not entry['target']):
            raise RuntimeError('Missing expected symbolic-link target')
    required = ['Contents/MacOS/ImmoRadar'] + ['Contents/Resources/runtime/' + path for path in (
        'manifest.json', 'bin/node', 'infra/postgres/bin/postgres', 'infra/redis/bin/redis-server',
        'infra/postgres/bin/initdb', 'infra/postgres/bin/pg_isready', 'infra/postgres/bin/psql', 'infra/postgres/bin/createdb',
        'scripts/start-postgres.sh', 'scripts/start-redis.sh', 'scripts/run-migrations.sh',
        'apps/api/dist/main.js', 'apps/worker-processing/dist/main.js', 'apps/worker-scraper/dist/main.js')]
    if any(inventory.get(path, {}).get('type') != 'file' for path in required):
        raise RuntimeError('Receipt must bind app and runtime manifest bytes')
    provenance = receipt.get('provenance')
    if not isinstance(provenance, list) or any(not isinstance(item, dict) for item in provenance):
        raise RuntimeError('Missing verified tool/runtime provenance')
    names = [item.get('name') for item in provenance]
    if not all(isinstance(name, str) for name in names) or len(set(names)) != len(names) or not {'build-toolchain', 'node', 'postgres', 'redis'}.issubset(names):
        raise RuntimeError('Incomplete tool/runtime provenance')
    for item in provenance:
        if (not isinstance(item.get('version'), str) or not item['version']
                or not isinstance(item.get('sourceUrl'), str) or not item['sourceUrl'].startswith('https://')
                or not valid_sha256(item.get('sourceSha256'))
                or item.get('verification') not in ('official-release-checksum', 'publisher-signature', 'package-manager-receipt', 'local-toolchain-inventory')):
            raise RuntimeError('Unverified tool/runtime provenance')
        if item['name'] != 'build-toolchain':
            if item['verification'] == 'local-toolchain-inventory':
                raise RuntimeError('Runtime requires verified publisher or package provenance')
            installed = inventory_path(item.get('installedPath'))
            runtime_paths = {'node': 'Contents/Resources/runtime/bin/node', 'postgres': 'Contents/Resources/runtime/infra/postgres/bin/postgres', 'redis': 'Contents/Resources/runtime/infra/redis/bin/redis-server'}
            if item['name'] in runtime_paths and installed != runtime_paths[item['name']]:
                raise RuntimeError('Runtime provenance names the wrong installed executable')
            if inventory.get(installed, {}).get('type') != 'file' or inventory[installed]['sha256'] != item.get('installedSha256'):
                raise RuntimeError('Runtime provenance is not bound to the installed bytes')
    if any(path.startswith('Contents/Resources/runtime/playwright-browsers/') for path in inventory) and not any(name.startswith('browser') for name in names):
        raise RuntimeError('Bundled browsers require verified provenance')
    return receipt

def verify_inventory(expected, actual):
    if expected != actual:
        raise RuntimeError('App inventory has missing, extra, changed or escaped files')

def collect_inventory(bundle):
    if bundle.resolve(strict=True) != bundle or not bundle.is_dir():
        raise RuntimeError('App bundle is not a canonical task directory')
    result = {}
    def walk_error(failure):
        raise failure
    for directory, directories, files in os.walk(bundle, followlinks=False, onerror=walk_error):
        for name in directories + files:
            path = Path(directory) / name
            relative = inventory_path(path.relative_to(bundle).as_posix())
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                resolved = path.resolve(strict=True)
                if bundle not in resolved.parents:
                    raise RuntimeError('App symbolic link escapes the task bundle')
                result[relative] = {'type': 'symlink', 'target': os.readlink(path)}
            elif path.resolve(strict=True) != path:
                raise RuntimeError('App path is not canonical')
            elif stat.S_ISDIR(mode):
                result[relative] = {'type': 'directory'}
            elif stat.S_ISREG(mode):
                digest = hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(chunk)
                result[relative] = {'type': 'file', 'sha256': digest.hexdigest()}
            else:
                raise RuntimeError('Unexpected app file type')
    return result

def verify_runtime_manifest(manifest):
    if (not isinstance(manifest, dict) or type(manifest.get('version')) is not int or manifest['version'] != 1
            or manifest.get('defaultApiBaseURL') != 'http://127.0.0.1:8080'
            or manifest.get('nodeExecutable') != 'bin/node' or manifest.get('artifactsDirectory') != 'artifacts'
            or manifest.get('scripts') != {'postgres': 'scripts/start-postgres.sh', 'redis': 'scripts/start-redis.sh', 'migrate': 'scripts/run-migrations.sh'}
            or manifest.get('playwrightBrowsersPath') not in (None, 'playwright-browsers')):
        raise RuntimeError('Runtime manifest content does not match the supported task layout')
    ports = manifest.get('ports')
    if not isinstance(ports, dict) or set(ports) != {'postgres', 'redis', 'api'} or any(type(value) is not int or not 1 <= value <= 65535 for value in ports.values()):
        raise RuntimeError('Malformed runtime manifest ports')

def identity_read_outcome(size, error, expected_size, requested_pid, reported_pid, status):
    if size == 0 and error == errno.ESRCH:
        return 'gone'
    if size != expected_size or error != 0 or reported_pid != requested_pid or status not in (1, 2, 3, 4, 5):
        raise RuntimeError('Process inspection is unverified; retaining diagnostics')
    return 'gone' if status == 5 else 'live'

def group_read_outcome(size, error, capacity, pids, all_recorded_gone, absence_error):
    if size == 0 and error in (0, errno.ESRCH):
        if all_recorded_gone and absence_error == errno.ESRCH:
            return []
        raise RuntimeError('Empty process-group read is unverified')
    if error != 0 or size <= 0 or size >= capacity or size % ctypes.sizeof(ctypes.c_int) != 0:
        raise RuntimeError('Process-group inspection failed or returned a short read')
    if len(pids) != size // ctypes.sizeof(ctypes.c_int) or any(pid <= 0 for pid in pids):
        raise RuntimeError('Process-group payload is malformed')
    return pids

def signal_decision(record, current, current_is_owned):
    if current is None:  # identity() returns None only after a verified exit.
        return False
    if record.get('pid', 0) <= 0 or not stable(record, current) or not current_is_owned:
        raise RuntimeError('Process ownership changed; refusing to signal')
    return True

def cleanup_decision(known_states, unknown_states):
    if not known_states:
        raise RuntimeError('Cleanup has no verified ownership history')
    if any(state not in ('gone', 'live') for state in known_states + unknown_states):
        raise RuntimeError('Cleanup inspection is unverified; retaining diagnostics')
    return all(state == 'gone' for state in known_states + unknown_states)

def unverified_outcome(record, current):
    if current is None:  # Only a verified exit reaches this branch.
        return 'gone'
    if current.get('pid') != record.get('pid') or not current.get('start') or not record.get('start'):
        return 'unknown'
    if current['start'] != record['start']:
        return 'gone'  # The original exited; never signal the replacement.
    return 'live' if stable(record, current) else 'unknown'

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
libproc.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int]

def identity(pid):
    info = BsdInfo()
    ctypes.set_errno(0)
    size = libproc.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
    error = ctypes.get_errno()
    if identity_read_outcome(size, error, ctypes.sizeof(info), pid, info.pid, info.status) == 'gone':
        return None
    path = ctypes.create_string_buffer(4096)
    ctypes.set_errno(0)
    path_size = libproc.proc_pidpath(pid, path, len(path))
    error = ctypes.get_errno()
    if path_size == 0 and error == errno.ESRCH:
        return None
    if error != 0 or path_size <= 0 or path_size >= len(path) or not path.value:
        raise RuntimeError('Cannot verify process executable')
    executable = str(Path(os.fsdecode(path.value)).resolve(strict=True))
    result = dict(pid=pid, ppid=info.ppid, pgid=info.pgid, uid=info.uid, ruid=info.ruid,
                  start=[info.start_sec, info.start_usec], executable=executable)
    if executable == '/bin/bash':
        output = subprocess.check_output(['/bin/ps', '-ww', '-p', str(pid), '-o', 'args='],
                                         env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, text=True)
        result['arguments'] = shlex.split(output.strip())
    return result

def owned(candidate):
    if candidate is None or app_identity is None:
        return False
    if candidate['pgid'] != app_identity['pid'] or candidate['uid'] != os.getuid() or candidate['ruid'] != os.getuid():
        return False
    if candidate['start'] < app_identity['start']:
        return False
    executable = Path(candidate['executable'])
    if candidate['pid'] == app_identity['pid']:
        return candidate == app_identity
    if runtime in executable.parents:
        return True
    if executable == Path('/bin/bash'):
        args = candidate.get('arguments', [])
        return len(args) == 2 and args[0] == '/bin/bash' and args[1] in {
            str(runtime / 'scripts' / name) for name in ('start-postgres.sh', 'start-redis.sh', 'run-migrations.sh')}
    return False

def stable(record, current):
    # Parent PID may change when the owned app exits. Creation, owner, executable
    # and session group must still match immediately before every signal.
    return current is not None and all(record.get(key) == current.get(key) for key in (
        'pid', 'pgid', 'uid', 'ruid', 'start', 'executable', 'arguments'))

def capture_group():
    if app_identity is None:
        return
    if app_identity['pid'] <= 0 or app_identity['pgid'] != app_identity['pid']:
        raise RuntimeError('Missing positive task session identity')
    buffer = (ctypes.c_int * 4096)()
    ctypes.set_errno(0)
    count = libproc.proc_listpids(2, app_identity['pid'], buffer, ctypes.sizeof(buffer))
    error = ctypes.get_errno()
    all_gone = False
    absence_error = None
    if count == 0 and error in (0, errno.ESRCH):
        all_gone = bool(records) and all(identity(pid) is None for pid in records)
        if all_gone:
            # Signal 0 is an independent existence query for the recorded task
            # session only. No terminating signal is ever sent to a group.
            try:
                os.killpg(app_identity['pid'], 0)
            except OSError as failure:
                absence_error = failure.errno
    pids = list(buffer[:max(0, count) // ctypes.sizeof(ctypes.c_int)])
    pids = group_read_outcome(count, error, ctypes.sizeof(buffer), pids, all_gone, absence_error)
    for pid in pids:
        candidate = identity(pid)
        if candidate is None:
            continue
        if not owned(candidate):
            # Short-lived system helpers (for example ps) are not cleanup
            # targets. A persistent unverified process fails shutdown below.
            unverified[pid] = candidate
            continue
        previous = records.get(pid)
        if previous is not None and previous['start'] != candidate['start']:
            raise RuntimeError('Process identity changed; refusing PID reuse')
        records[pid] = candidate
    (root / 'process-identities.json').write_text(json.dumps(list(records.values()), indent=2))

def signal_record(record, requested_signal):
    current = identity(record['pid'])
    if signal_decision(record, current, owned(current)):
        os.kill(record['pid'], requested_signal)

def pump(seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not shutting_down and os.getppid() != supervisor_parent:
            raise InterruptedError('Smoke launcher exited')
        capture_group()
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))

def request(url, token=None):
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(urllib.request.Request(url, headers=headers), timeout=2) as response:
        return response.status == 200

def wait_until(predicate, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        capture_group()
        if process.poll() is not None:
            raise RuntimeError('Owned app exited during startup')
        try:
            if predicate():
                return
        except (OSError, ValueError):
            pass
        pump(0.1)
    raise RuntimeError('Smoke condition timed out')

def shutdown():
    global shutting_down
    shutting_down = True
    if app_identity is None:
        return process is None or process.poll() is not None
    capture_group()
    signal_record(app_identity, signal.SIGTERM)
    deadline = time.monotonic() + 20
    while process.poll() is None and time.monotonic() < deadline:
        pump(0.1)
    if process.poll() is None:
        signal_record(app_identity, signal.SIGKILL)
        process.wait(timeout=5)
    capture_group()
    children = [record for pid, record in records.items() if pid != app_identity['pid']]
    for record in reversed(children):
        signal_record(record, signal.SIGTERM)
    deadline = time.monotonic() + 10
    while any(identity(record['pid']) is not None for record in children) and time.monotonic() < deadline:
        pump(0.1)
    capture_group()
    for pid, record in records.items():
        if pid != app_identity['pid']:
            signal_record(record, signal.SIGKILL)
    pump(0.2)
    known_states = ['gone' if identity(pid) is None else 'live' for pid in records]
    unknown_states = [unverified_outcome(record, identity(pid)) for pid, record in unverified.items()]
    return cleanup_decision(known_states, unknown_states)

def interrupt(_signal, _frame):
    raise InterruptedError('Smoke supervisor interrupted')

signal.signal(signal.SIGTERM, interrupt)
signal.signal(signal.SIGINT, interrupt)

try:
    # Validate paths before opening the app or its bundled manifest. No source
    # checkout, installed app, inherited configuration or provider env is used.
    if root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o777 != 0o700:
        raise RuntimeError('Smoke root must be private and owned by this user')
    receipt_path = Path(sys.argv[3])
    if (not receipt_path.is_absolute() or receipt_path.resolve(strict=True) != receipt_path
            or root in receipt_path.parents or receipt_path.stat().st_uid != os.getuid()
            or receipt_path.stat().st_mode & 0o022 or not stat.S_ISREG(receipt_path.stat().st_mode)):
        raise RuntimeError('Expected an external task-owned reviewed artifact receipt')
    receipt = trusted_receipt(receipt_path.read_bytes(), sys.argv[4])
    verify_inventory(receipt['inventory'], collect_inventory(app.parents[2]))
    for item in [app, runtime / 'manifest.json']:
        if item.resolve(strict=True) != item:
            raise RuntimeError('Smoke path contains a symlink')
    manifest = json.loads((runtime / 'manifest.json').read_text(), object_pairs_hook=unique_object)
    verify_runtime_manifest(manifest)
    for relative in [manifest['nodeExecutable'], *manifest['scripts'].values()]:
        item = runtime / relative
        if not isinstance(relative, str) or item.resolve(strict=True) != item or runtime not in item.parents:
            raise RuntimeError('Runtime manifest escapes the task bundle')
    reservations = [socket.socket() for _ in range(3)]
    for reservation in reservations:
        reservation.bind(('127.0.0.1', 0))
    ports = [reservation.getsockname()[1] for reservation in reservations]
    api = 'http://127.0.0.1:' + str(ports[0])
    token = 'smoke-' + str(uuid.uuid4())
    environment = {
        'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C', 'LC_ALL': 'C', 'LC_CTYPE': 'C',
        'HOME': str(root / 'home'), 'TMPDIR': str(root / 'tmp'),
        'IMMORADAR_SMOKE_TEST': '1', 'IMMORADAR_SMOKE_ROOT': str(root),
        'IMMORADAR_API_BASE_URL_OVERRIDE': api,
        'IMMORADAR_RUNTIME_HOME_OVERRIDE': str(root / 'runtime-home'),
        'IMMORADAR_LOGS_DIRECTORY_OVERRIDE': str(logs),
        'IMMORADAR_LOCAL_RUNTIME_API_TOKEN': token,
        'IMMORADAR_POSTGRES_PORT_OVERRIDE': str(ports[1]),
        'IMMORADAR_REDIS_PORT_OVERRIDE': str(ports[2]),
    }
    for key in ('SCHEDULER_ENABLED', 'SCRAPER_CANARY_ENABLED', 'FEATURE_GEOCODING_ENABLED',
                'FEATURE_CROSS_SOURCE_CLUSTERING_ENABLED', 'ALERTS_EMAIL_ENABLED', 'ALERTS_WEBHOOK_ENABLED',
                'ALERTS_PUSH_ENABLED', 'OUTREACH_ENABLED', 'OTEL_ENABLED', 'PROMETHEUS_ENABLED'):
        environment[key] = 'false'
    for reservation in reservations:
        reservation.close()
    with (root / 'app-stdout.log').open('wb') as output:
        process = subprocess.Popen([str(app)], cwd=str(root), env=environment,
                                   stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    app_identity = identity(process.pid)
    if app_identity is None or app_identity['executable'] != str(app) or app_identity['ppid'] != os.getpid() or not owned(app_identity):
        raise RuntimeError('Could not prove the launched app identity')
    records[process.pid] = app_identity
    wait_until(lambda: request(api + '/health'), 75)
    wait_until(lambda: request(api + '/v1/alerts/unread-count', token), 5)
    diagnostics = logs / 'startup-diagnostics.json'
    wait_until(lambda: json.loads(diagnostics.read_text()).get('status') == 'running', 20)
    payload = json.loads(diagnostics.read_text())
    components = payload.get('components', [])
    if len(components) != 5 or any(c.get('ownership') != 'launched' or c.get('pid') not in records for c in components):
        raise RuntimeError('Smoke must not adopt external runtime services')
    if payload.get('bootMode') != 'setup':
        raise RuntimeError('Smoke must keep monitoring disabled')
    success = True
finally:
    clean = shutdown()
    if clean:
        (root / 'shutdown-complete').touch()
    if not clean:
        raise RuntimeError('Owned process cleanup incomplete; diagnostics retained')

# Each chosen port must close; never kill a process found by a port lookup.
for port in ports:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1', port)) != 0:
                break
        time.sleep(0.1)
    else:
        raise RuntimeError('Task port remained open after owned shutdown')
if success:
    print('Smoke test passed for the disposable task bundle')
PY

import { spawn } from 'node:child_process';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const WATCHDOG = fileURLToPath(
  new URL('../../scripts/runtime/engine-watchdog.sh', import.meta.url),
);
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

interface RecordingChild {
  process: ChildProcess;
  output: () => string;
}

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function waitForExit(child: ChildProcess): Promise<ExitResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

describe.skipIf(process.platform !== 'darwin')('engine watchdog', () => {
  let root: string;
  let runtimeHome: string;
  let spawned: ChildProcess[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'immoradar-watchdog-'));
    // The real home has a space in it, which every marker match has to survive.
    runtimeHome = join(root, 'Application Support', 'ImmoRadar');
    await mkdir(runtimeHome, { recursive: true });
    spawned = [];
  });

  afterEach(async () => {
    for (const child of spawned) {
      if (isRunning(child)) child.kill('SIGKILL');
    }
    await rm(root, { recursive: true, force: true });
  });

  function startWatchdog(
    path = SYSTEM_PATH,
  ): ChildProcessWithoutNullStreams & { log: () => string } {
    const watchdog = spawn('/bin/bash', [WATCHDOG], {
      env: {
        PATH: path,
        IMMORADAR_WATCHDOG_RUNTIME_HOME: runtimeHome,
        IMMORADAR_WATCHDOG_POLL_SECONDS: '0.01',
      },
      stdio: 'pipe',
    });
    spawned.push(watchdog);
    let log = '';
    watchdog.stdout.on('data', (chunk: Buffer) => {
      log += chunk.toString();
    });
    return Object.assign(watchdog, { log: () => log });
  }

  /**
   * Starts a process that prints each signal it receives. It prints "ready" once its traps are
   * set, and it waits for that so a signal can't arrive before the trap exists.
   */
  async function startChild(
    traps: string,
    env: Record<string, string> = {},
  ): Promise<RecordingChild> {
    const script = `${traps}\necho ready\nwhile :; do /bin/sleep 0.02; done`;
    const child = spawn('/bin/bash', ['-c', script], {
      env: { PATH: SYSTEM_PATH, ...env },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    spawned.push(child);
    let output = '';
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('ready')) resolve();
      });
    });
    return { process: child, output: () => output };
  }

  /** Node stands in for Chromium here, because ps hides the environment of Apple's binaries. */
  async function startMarkedProcess(env: Record<string, string>): Promise<ChildProcess> {
    const child = spawn(
      process.execPath,
      ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'],
      {
        env: { PATH: SYSTEM_PATH, ...env },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    spawned.push(child);
    await new Promise((resolve) => child.stdout.once('data', resolve));
    return child;
  }

  it('escalates Postgres through SIGINT and SIGQUIT to SIGKILL', async () => {
    const watchdog = startWatchdog();
    const postgres = await startChild(`trap 'echo INT' INT\ntrap 'echo QUIT' QUIT`);

    watchdog.stdin.write(`ADD postgres 1 ${postgres.process.pid}\n`);
    watchdog.stdin.end();

    expect(await waitForExit(watchdog)).toEqual({ code: 0, signal: null });
    expect(await waitForExit(postgres.process)).toEqual({ code: null, signal: 'SIGKILL' });
    expect(postgres.output().split('\n').filter(Boolean)).toEqual(['ready', 'INT', 'QUIT']);
  });

  it('stops the engine in ladder order, whatever order the processes were added', async () => {
    const watchdog = startWatchdog();
    const exitOnTerm = `trap 'exit 0' TERM`;
    const postgres = await startChild(`trap 'exit 0' INT`);
    const redis = await startChild(exitOnTerm);
    const api = await startChild(exitOnTerm);
    const scraper = await startChild(exitOnTerm);

    watchdog.stdin.write(`ADD postgres 1 ${postgres.process.pid}\n`);
    watchdog.stdin.write(`ADD redis 1 ${redis.process.pid}\n`);
    watchdog.stdin.write(`ADD api 1 ${api.process.pid}\n`);
    watchdog.stdin.write(`ADD worker-scraper 1 ${scraper.process.pid}\n`);
    watchdog.stdin.end();

    await waitForExit(watchdog);

    const signals = watchdog
      .log()
      .split('\n')
      .flatMap(
        (line) => /watchdog: (\S+) pid=\d+ (SIG\w+)$/.exec(line)?.slice(1, 3).join(' ') ?? [],
      );
    expect(signals).toEqual([
      'worker-scraper SIGTERM',
      'api SIGTERM',
      'redis SIGTERM',
      'postgres SIGINT',
    ]);
  });

  it('never signals a PID whose start time changed after ADD', async () => {
    // Stands in for PID reuse: from the moment the flag exists, ps reports another start year.
    const stubDir = join(root, 'stub');
    const reused = join(root, 'pid-reused');
    await mkdir(stubDir);
    const stub = join(stubDir, 'ps');
    await writeFile(
      stub,
      `#!/bin/bash\nif [[ -f '${reused}' ]]; then /bin/ps "$@" | /usr/bin/sed 's/20[0-9][0-9]/1999/'; else exec /bin/ps "$@"; fi\n`,
    );
    await chmod(stub, 0o755);

    const watchdog = startWatchdog(`${stubDir}:${SYSTEM_PATH}`);
    const unrelated = await startChild(`trap 'echo TERM' TERM`);

    watchdog.stdin.write(`ADD api 1 ${unrelated.process.pid}\nRUN marker\n`);
    await new Promise<void>((resolve) => {
      watchdog.stdout.on('data', () => {
        if (watchdog.log().includes('run marker')) resolve();
      });
    });
    await writeFile(reused, '');
    watchdog.stdin.end();
    await waitForExit(watchdog);

    expect(isRunning(unrelated.process)).toBe(true);
    expect(unrelated.output()).not.toContain('TERM');
  });

  it('still stops a process after the time zone changes', async () => {
    // From the moment the flag exists, a ps run with no zone of its own reports local time in Tokyo.
    const stubDir = join(root, 'stub');
    const moved = join(root, 'time-zone-changed');
    await mkdir(stubDir);
    const stub = join(stubDir, 'ps');
    await writeFile(
      stub,
      `#!/bin/bash\nif [[ -f '${moved}' ]]; then export TZ="\${TZ:-Asia/Tokyo}"; fi\nexec /bin/ps "$@"\n`,
    );
    await chmod(stub, 0o755);

    const watchdog = startWatchdog(`${stubDir}:${SYSTEM_PATH}`);
    const api = await startChild(`trap 'exit 0' TERM`);

    watchdog.stdin.write(`ADD api 1 ${api.process.pid}\nRUN marker\n`);
    await new Promise<void>((resolve) => {
      watchdog.stdout.on('data', () => {
        if (watchdog.log().includes('run marker')) resolve();
      });
    });
    await writeFile(moved, '');
    watchdog.stdin.end();
    await waitForExit(watchdog);

    expect(await waitForExit(api.process)).toEqual({ code: 0, signal: null });
  });

  it('kills tagged processes on STOP and everything under the home when the pipe closes', async () => {
    const homeMarker = { IMMORADAR_ENGINE_HOME: `${runtimeHome}/` };
    await writeFile(join(runtimeHome, 'engine-run.json'), '{}');
    const watchdog = startWatchdog();
    const scraper = await startChild(`trap 'exit 0' TERM`);
    const oldBrowser = await startMarkedProcess({
      ...homeMarker,
      IMMORADAR_ENGINE_TAG: 'run-1.worker-scraper.1.',
    });
    const newBrowser = await startMarkedProcess({
      ...homeMarker,
      IMMORADAR_ENGINE_TAG: 'run-1.worker-scraper.2.',
    });
    const otherHome = await startMarkedProcess({
      IMMORADAR_ENGINE_HOME: `${runtimeHome}-other/`,
      IMMORADAR_ENGINE_TAG: 'run-1.worker-scraper.1.x',
    });

    watchdog.stdin.write('RUN run-1\n');
    watchdog.stdin.write(`ADD worker-scraper 1 ${scraper.process.pid}\n`);
    watchdog.stdin.write('STOP worker-scraper\n');

    expect(await waitForExit(oldBrowser)).toEqual({ code: null, signal: 'SIGKILL' });
    expect(await waitForExit(scraper.process)).toEqual({ code: 0, signal: null });
    expect(isRunning(newBrowser)).toBe(true);

    watchdog.stdin.end();

    expect(await waitForExit(watchdog)).toEqual({ code: 0, signal: null });
    expect(await waitForExit(newBrowser)).toEqual({ code: null, signal: 'SIGKILL' });
    expect(isRunning(otherHome)).toBe(true);
    await expect(stat(join(runtimeHome, 'engine-run.json'))).rejects.toThrow('ENOENT');
  });

  it('spares a process that only names the marker in its arguments', async () => {
    const homeMarker = `IMMORADAR_ENGINE_HOME=${runtimeHome}/`;
    const searching = spawn(
      process.execPath,
      ['-e', 'console.log("ready"); setInterval(() => {}, 1000)', homeMarker, 'engine.log'],
      { env: { PATH: SYSTEM_PATH }, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    spawned.push(searching);
    await new Promise((resolve) => searching.stdout.once('data', resolve));

    const watchdog = startWatchdog();
    watchdog.stdin.end();

    expect(await waitForExit(watchdog)).toEqual({ code: 0, signal: null });
    expect(isRunning(searching)).toBe(true);
  });
});

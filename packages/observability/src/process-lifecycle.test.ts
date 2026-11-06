import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { runMain } from './process-lifecycle.js';

const HARD_TIMEOUT_MS = 1_000;
const HANDLED_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection', 'uncaughtException'];

describe('runMain', () => {
  let exit: MockInstance<typeof process.exit>;
  let listenersBefore: Map<string, unknown[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit);
    listenersBefore = new Map(HANDLED_EVENTS.map((event) => [event, process.listeners(event)]));
  });

  afterEach(() => {
    for (const event of HANDLED_EVENTS) {
      for (const listener of process.listeners(event)) {
        if (!listenersBefore.get(event)?.includes(listener)) process.off(event, listener);
      }
    }
    exit.mockRestore();
    process.exitCode = undefined;
    vi.useRealTimers();
  });

  it('runs the steps once when a second signal arrives', async () => {
    const step = vi.fn(() => Promise.resolve());
    runMain('test', HARD_TIMEOUT_MS, async (lifecycle) => {
      lifecycle.onShutdown('step', step);
    });

    process.emit('SIGTERM');
    process.emit('SIGINT');
    await vi.advanceTimersByTimeAsync(0);

    expect(step).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('reaches the hard exit when a step hangs', async () => {
    runMain('test', HARD_TIMEOUT_MS, async (lifecycle) => {
      lifecycle.onShutdown('hung', () => new Promise<void>(() => {}));
    });

    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - 1);
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

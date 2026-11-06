import { describe, expect, it, vi } from 'vitest';
import { closePool, getPool } from './client.js';

const endPool = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock('pg', () => ({
  default: {
    Pool: class {
      on = vi.fn();
      end = endPool;
    },
  },
}));

vi.mock('@immoradar/config', () => ({
  loadConfig: () => ({
    database: { url: 'postgres://unused', poolMax: 1, statementTimeoutMs: 1_000 },
  }),
}));

describe('closePool', () => {
  it('ends the pool once when called concurrently', async () => {
    let finishEnd = (): void => {};
    endPool.mockReturnValue(
      new Promise<void>((resolve) => {
        finishEnd = resolve;
      }),
    );
    getPool();

    const closing = Promise.all([closePool(), closePool()]);
    finishEnd();
    await closing;

    expect(endPool).toHaveBeenCalledTimes(1);
  });
});

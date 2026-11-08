import { describe, expect, it, vi } from 'vitest';

interface FakeJob {
  data: Record<string, unknown>;
  moveToDelayed: ReturnType<typeof vi.fn<(timestamp: number, token?: string) => Promise<void>>>;
  moveToWait: ReturnType<typeof vi.fn<(token?: string) => Promise<number>>>;
}
type Processor = (job: FakeJob, token?: string) => Promise<void>;

const hoisted = vi.hoisted(() => ({ processor: null as Processor | null }));

vi.mock('bullmq', async () => {
  const actual = await vi.importActual<typeof import('bullmq')>('bullmq');
  return {
    ...actual,
    Worker: class {
      constructor(_queueName: string, processor: Processor) {
        hoisted.processor = processor;
      }
      on(): this {
        return this;
      }
    },
  };
});

vi.mock('@immoradar/scraper-core', async () => {
  const actual =
    await vi.importActual<typeof import('@immoradar/scraper-core')>('@immoradar/scraper-core');
  return {
    ...actual,
    createQueue: () => ({ add: vi.fn() }),
    getRedisConnection: () => ({}),
    // Never settles, so only a shutdown ends the wait.
    pageNavigationDelay: () => new Promise<void>(() => {}),
  };
});

vi.mock('../source-guard.js', () => ({
  checkSourceRunnable: async () => ({ runnable: true, source: { rateLimitRpm: null } }),
}));
vi.mock('../browser-pool.js', () => ({ acquirePageSlot: vi.fn(), createScrapeContext: vi.fn() }));
vi.mock('../adapter-registry.js', () => ({ getAdapter: vi.fn() }));

import { DelayedError, WaitingError } from 'bullmq';
import { PerDomainRateLimiter, SourceCircuitBreaker } from '@immoradar/scraper-core';
import { createDetailWorker } from './detail-worker.js';

function setup() {
  const shutdown = new AbortController();
  const circuitBreaker = new SourceCircuitBreaker(5, 300_000);
  createDetailWorker({
    shutdownSignal: shutdown.signal,
    rateLimiter: new PerDomainRateLimiter(60),
    circuitBreaker,
  });
  const job: FakeJob = {
    data: {
      sourceCode: 'wohnnet',
      sourceId: 1,
      scrapeRunId: 7,
      detailUrl: 'https://www.wohnnet.at/immobilien/1',
      discoveryUrl: null,
      sourceListingKey: 'wohnnet:1',
    },
    moveToDelayed: vi.fn(async () => {}),
    moveToWait: vi.fn(async () => 0),
  };
  return { shutdown, circuitBreaker, job, run: () => hoisted.processor!(job, 'lock-token') };
}

describe('detail worker', () => {
  // Returning early would complete the job and drop the page.
  it('delays a job while the breaker is open instead of dropping it', async () => {
    const { circuitBreaker, job, run } = setup();
    for (let failure = 0; failure < 5; failure++) {
      circuitBreaker.recordFailure('wohnnet', 'soft_anti_bot');
    }
    const openUntil = circuitBreaker.openUntil('wohnnet');

    await expect(run()).rejects.toBeInstanceOf(DelayedError);
    expect(openUntil).not.toBeNull();
    const [until, token] = job.moveToDelayed.mock.calls[0]!;
    expect(until).toBeGreaterThanOrEqual(openUntil!);
    expect(token).toBe('lock-token');
  });

  // A failed attempt per quit would send a page to the dead-letter queue after two app quits.
  it('puts the job back on shutdown without counting a failure', async () => {
    const { shutdown, circuitBreaker, job, run } = setup();
    const pending = run();
    shutdown.abort();

    await expect(pending).rejects.toBeInstanceOf(WaitingError);
    expect(job.moveToWait).toHaveBeenCalledWith('lock-token');
    expect(circuitBreaker.getConsecutiveFailures('wohnnet')).toBe(0);
  });
});

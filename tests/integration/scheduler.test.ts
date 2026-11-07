import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfig } from '@immoradar/config';
import { closePool, query, runMigrations, sources } from '@immoradar/db';
import {
  QUEUE_NAMES,
  closeRedisConnection,
  createQueue,
  discoverySchedulerId,
  getRedisConnection,
  syncDiscoverySchedule,
} from '@immoradar/scraper-core';
import type { DiscoveryJobData, QueueName } from '@immoradar/scraper-core';
import { startScheduler } from '../../apps/worker-scraper/src/scheduler.js';
import { seed } from '../../packages/db/seeds/seed.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_scheduler',
  enabled: true,
});

const SCHEDULED_QUEUES: QueueName[] = [
  QUEUE_NAMES.SCRAPE_DISCOVERY,
  QUEUE_NAMES.BASELINE,
  QUEUE_NAMES.CLUSTER,
  QUEUE_NAMES.GEOCODE_ENQUEUE,
  QUEUE_NAMES.STALE_CHECK,
  QUEUE_NAMES.CANARY,
  QUEUE_NAMES.MAILBOX_SYNC,
];

const ORIGINAL_PREFIX = process.env['BULLMQ_PREFIX'];
const ORIGINAL_SCHEDULER = process.env['SCHEDULER_ENABLED'];

async function schedulersOf(name: QueueName) {
  const queue = createQueue(name);
  try {
    return await queue.getJobSchedulers();
  } finally {
    await queue.close();
  }
}

async function plant(name: QueueName, schedulerId: string): Promise<void> {
  const queue = createQueue(name);
  try {
    await queue.upsertJobScheduler(schedulerId, { pattern: '0 * * * *' });
  } finally {
    await queue.close();
  }
}

async function obliterateAll(): Promise<void> {
  for (const name of SCHEDULED_QUEUES) {
    const queue = createQueue(name);
    await queue.obliterate({ force: true });
    await queue.close();
  }
}

function setSchedulerEnabled(enabled: boolean): void {
  process.env['SCHEDULER_ENABLED'] = String(enabled);
  resetConfig();
}

describe('startScheduler', () => {
  beforeAll(async () => {
    process.env['BULLMQ_PREFIX'] = `immoradar-test-scheduler-${process.pid}`;
    resetConfig();
    await testDb.setup();
    await runMigrations();
    await seed();
  });

  beforeEach(async () => {
    await obliterateAll();
    setSchedulerEnabled(true);
  });

  afterAll(async () => {
    await obliterateAll();
    await closeRedisConnection();
    await closePool();
    await testDb.teardown();
    if (ORIGINAL_PREFIX === undefined) delete process.env['BULLMQ_PREFIX'];
    else process.env['BULLMQ_PREFIX'] = ORIGINAL_PREFIX;
    if (ORIGINAL_SCHEDULER === undefined) delete process.env['SCHEDULER_ENABLED'];
    else process.env['SCHEDULER_ENABLED'] = ORIGINAL_SCHEDULER;
    resetConfig();
  });

  it('registers what the config wants and removes what it no longer wants', async () => {
    await plant(QUEUE_NAMES.SCRAPE_DISCOVERY, discoverySchedulerId('source-that-left'));
    await plant(QUEUE_NAMES.BASELINE, 'baseline-hourly');
    await plant(QUEUE_NAMES.CANARY, 'canary-periodic');
    await plant(QUEUE_NAMES.GEOCODE_ENQUEUE, 'geocode-enqueue-periodic');

    await startScheduler();

    const active = (await sources.findActive()).map((source) => discoverySchedulerId(source.code));
    const discovery = await schedulersOf(QUEUE_NAMES.SCRAPE_DISCOVERY);
    expect(discovery.map((scheduler) => scheduler.key).sort()).toEqual([...active].sort());

    // Willhaben's 15-minute interval from the seed data stays under the 3-hour floor.
    const willhaben = discovery.find((s) => s.key === discoverySchedulerId('willhaben'));
    expect(willhaben?.pattern).toMatch(/^\d+ \*\/3 \* \* \*$/);
    expect(willhaben?.template?.data).toMatchObject({ maxPagesPerRun: expect.any(Number) });
    expect(
      (willhaben?.template?.data as unknown as DiscoveryJobData).maxPagesPerRun,
    ).toBeLessThanOrEqual(loadConfig().scraper.maxPagesPerRun);
    // Retention from the queue reaches the jobs the scheduler creates, along with the retries.
    expect(willhaben?.template?.opts).toMatchObject({
      attempts: 3,
      removeOnComplete: { age: 86_400, count: 100 },
      removeOnFail: { age: 604_800, count: 200 },
    });

    const baseline = await schedulersOf(QUEUE_NAMES.BASELINE);
    expect(baseline.map((scheduler) => scheduler.key)).toEqual(['baseline-periodic']);
    expect(baseline[0]?.pattern).toMatch(/^\d+ \*\/6 \* \* \*$/);

    const cluster = await schedulersOf(QUEUE_NAMES.CLUSTER);
    expect(cluster.map((scheduler) => scheduler.pattern)).toEqual(['20 3 * * *']);

    const staleCheck = await schedulersOf(QUEUE_NAMES.STALE_CHECK);
    expect(staleCheck[0]?.pattern).toMatch(/^\d+ \*\/6 \* \* \*$/);

    // Both features are off by default here, so their old schedules go.
    expect(await schedulersOf(QUEUE_NAMES.CANARY)).toEqual([]);
    expect(await schedulersOf(QUEUE_NAMES.GEOCODE_ENQUEUE)).toEqual([]);
  });

  it('leaves the same minute on a second start', async () => {
    await startScheduler();
    const first = await schedulersOf(QUEUE_NAMES.SCRAPE_DISCOVERY);

    await startScheduler();
    const second = await schedulersOf(QUEUE_NAMES.SCRAPE_DISCOVERY);

    const patterns = (list: typeof first) =>
      Object.fromEntries(list.map((scheduler) => [scheduler.key, scheduler.pattern]));
    expect(patterns(second)).toEqual(patterns(first));
  });

  it('keeps the shared Redis connection open for the workers after it finishes', async () => {
    await startScheduler();
    expect((getRedisConnection() as { status: string }).status).toBe('ready');
  });

  it('clears every schedule when the scheduler is off', async () => {
    await startScheduler();
    await plant(QUEUE_NAMES.MAILBOX_SYNC, 'mailbox-sync-repeat-1');

    setSchedulerEnabled(false);
    await startScheduler();

    for (const name of SCHEDULED_QUEUES) {
      expect(await schedulersOf(name), name).toEqual([]);
    }
  });

  it('closes abandoned scrape runs when the scheduler is off too', async () => {
    const [source] = await sources.findActive();
    await query(
      `INSERT INTO scrape_runs (source_id, trigger_type, scope, status, started_at)
       VALUES ($1, 'schedule', 'full', 'running', NOW() - INTERVAL '2 hours')`,
      [source!.id],
    );

    setSchedulerEnabled(false);
    await startScheduler();

    const rows = await query<{ status: string }>(
      `SELECT status FROM scrape_runs WHERE source_id = $1`,
      [source!.id],
    );
    expect(rows.map((row) => row.status)).not.toContain('running');
  });
});

describe('syncDiscoverySchedule', () => {
  beforeAll(() => {
    process.env['BULLMQ_PREFIX'] = `immoradar-test-scheduler-${process.pid}`;
    resetConfig();
  });

  const source = {
    id: 1,
    code: 'example',
    isActive: true,
    crawlIntervalMinutes: 1440,
    config: {},
  } as Parameters<typeof syncDiscoverySchedule>[1];
  const settings = {
    scheduler: { enabled: true },
    scraper: { minCrawlIntervalMinutes: 180, maxPagesPerRun: 60 },
  };

  async function withQueue(
    run: (queue: ReturnType<typeof createQueue<DiscoveryJobData>>) => Promise<void>,
  ): Promise<void> {
    const queue = createQueue<DiscoveryJobData>(QUEUE_NAMES.SCRAPE_DISCOVERY);
    try {
      await run(queue);
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }

  afterAll(async () => {
    await closeRedisConnection();
    resetConfig();
  });

  it('writes a daily cron that BullMQ accepts', async () => {
    await withQueue(async (queue) => {
      await syncDiscoverySchedule(queue, source, settings);
      const [scheduler] = await queue.getJobSchedulers();
      expect(scheduler?.pattern).toMatch(/^\d+ 0 \* \* \*$/);
    });
  });

  it('removes the schedule of a paused source and adds none while schedules are off', async () => {
    await withQueue(async (queue) => {
      await syncDiscoverySchedule(queue, source, settings);
      await syncDiscoverySchedule(queue, { ...source, isActive: false }, settings);
      expect(await queue.getJobSchedulers()).toEqual([]);

      await syncDiscoverySchedule(queue, source, { ...settings, scheduler: { enabled: false } });
      expect(await queue.getJobSchedulers()).toEqual([]);
    });
  });
});

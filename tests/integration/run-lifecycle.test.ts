import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ScraperRunMetrics } from '@immoradar/contracts';
import { query, runMigrations, scrapeRuns, sources } from '@immoradar/db';
import { seed } from '../../packages/db/seeds/seed.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_run_lifecycle',
  enabled: true,
});

const NO_PAGES: ScraperRunMetrics = {
  pagesFetched: 0,
  listingsDiscovered: 0,
  http2xx: 0,
  http4xx: 0,
  http5xx: 0,
  captchaCount: 0,
  retryCount: 0,
};

let sourceId: number;

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  await seed();
  const [source] = await query<{ id: string }>(`SELECT id FROM sources WHERE code = 'willhaben'`);
  sourceId = Number(source!.id);
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(async () => {
  await query('DELETE FROM scrape_runs');
  await query(
    `UPDATE sources SET is_active = TRUE, health_status = 'unknown', config = config - 'disabledReason'
     WHERE id = $1`,
    [sourceId],
  );
});

describe('run counters', () => {
  it('keeps the counts processing added when the scraper finishes the run', async () => {
    const run = await scrapeRuns.create({ sourceId, triggerType: 'manual', scope: 'full' });
    await scrapeRuns.incrementMetrics(run.id, { rawSnapshotsCreated: 1, normalizedCreated: 1 });
    await scrapeRuns.incrementMetrics(run.id, { rawSnapshotsCreated: 1, normalizedUpdated: 1 });

    const finished = await scrapeRuns.finish(run.id, 'succeeded', { ...NO_PAGES, pagesFetched: 3 });
    expect(finished).toMatchObject({
      pagesFetched: 3,
      rawSnapshotsCreated: 2,
      normalizedCreated: 1,
      normalizedUpdated: 1,
    });

    // Captures still waiting in the processing queue land after the run has finished.
    await scrapeRuns.incrementMetrics(run.id, { normalizedCreated: 1 });
    expect((await scrapeRuns.findById(run.id))?.normalizedCreated).toBe(2);
  });
});

describe('run status', () => {
  it('keeps a cancelled run cancelled', async () => {
    const run = await scrapeRuns.create({ sourceId, triggerType: 'manual', scope: 'full' });
    expect(await scrapeRuns.start(run.id)).toMatchObject({ status: 'running' });
    await scrapeRuns.cancel(run.id);

    // The scraper finishing its work later must not overwrite the user's cancel.
    expect(await scrapeRuns.finish(run.id, 'succeeded', NO_PAGES)).toBeNull();
    expect(await scrapeRuns.findById(run.id)).toMatchObject({
      status: 'cancelled',
      errorCode: 'user_cancelled',
    });
    expect(await scrapeRuns.start(run.id)).toBeNull();
  });

  it('closes the runs a stopped scraper left running and nothing else', async () => {
    async function runningRun(workerHost: string): Promise<number> {
      const run = await scrapeRuns.create({
        sourceId,
        triggerType: 'manual',
        scope: 'full',
        workerHost,
      });
      await scrapeRuns.start(run.id);
      return run.id;
    }
    const scheduled = await runningRun('discovery-worker');
    const fromApp = await runningRun('api');
    const fromScript = await runningRun('cli');
    const queued = await scrapeRuns.create({
      sourceId,
      triggerType: 'manual',
      scope: 'full',
      workerHost: 'api',
    });

    expect(await scrapeRuns.cancelInterruptedRuns()).toBe(2);
    expect(await scrapeRuns.findById(scheduled)).toMatchObject({
      status: 'cancelled',
      errorCode: 'interrupted',
    });
    expect((await scrapeRuns.findById(fromApp))?.status).toBe('cancelled');
    expect((await scrapeRuns.findById(fromScript))?.status).toBe('running');
    expect((await scrapeRuns.findById(queued.id))?.status).toBe('queued');
  });
});

describe('source health', () => {
  async function failedRun(daysAgo: number, errorCode: string | null): Promise<void> {
    await query(
      `INSERT INTO scrape_runs (
         source_id, trigger_type, scope, status, error_code, scheduled_at, started_at, finished_at
       ) VALUES (
         $1, 'schedule', 'full', 'failed', $3,
         NOW() - make_interval(days => $2), NOW() - make_interval(days => $2),
         NOW() - make_interval(days => $2)
       )`,
      [sourceId, daysAgo, errorCode],
    );
  }

  it('does not disable a source on its first failure after old, network or internal failures', async () => {
    for (let i = 0; i < 5; i++) await failedRun(30, null);
    for (let i = 0; i < 3; i++) await failedRun(1, 'transient_network');
    // A browser that won't launch or an adapter bug fails the run on our side.
    for (let i = 0; i < 3; i++) await failedRun(1, 'internal_error');
    await failedRun(0, 'soft_anti_bot');

    const outcome = await sources.applyRunOutcome(sourceId, 'failed');
    expect(outcome.newStatus).toBe('degraded');
  });
});

describe('source gating', () => {
  it('leaves legally disabled and failure-disabled sources out of the active list', async () => {
    await query(`UPDATE sources SET health_status = 'disabled' WHERE id = $1`, [sourceId]);

    const codes = (await sources.findActive()).map((source) => source.code);
    expect(codes).not.toContain('willhaben');
    // The seed marks openimmo legally disabled.
    expect(codes).not.toContain('openimmo');
  });

  it('never switches on a legally disabled source', async () => {
    const openimmo = await sources.findByCode('openimmo');
    const refused = await sources.updateSettings(openimmo!.id, {
      isActive: true,
      crawlIntervalMinutes: 240,
    });
    expect(refused).toMatchObject({ outcome: 'legally_disabled' });
    expect((await sources.findByCode('openimmo'))?.crawlIntervalMinutes).toBe(
      openimmo!.crawlIntervalMinutes,
    );

    await sources.updateAllActive(true);
    expect((await sources.findByCode('openimmo'))?.isActive).toBe(false);
  });

  it('keeps the disable reason until the owner switches the source back on', async () => {
    await sources.disableWithReason(sourceId, 'five failed runs');

    const retimed = await sources.updateSettings(sourceId, { crawlIntervalMinutes: 240 });
    expect(retimed).toMatchObject({
      outcome: 'updated',
      source: {
        isActive: false,
        crawlIntervalMinutes: 240,
        config: { disabledReason: 'five failed runs' },
      },
    });

    // Otherwise the source would stay out of findActive after the owner switched it on.
    const activated = await sources.updateSettings(sourceId, { isActive: true });
    expect(activated).toMatchObject({
      outcome: 'updated',
      source: { isActive: true, healthStatus: 'unknown' },
    });
    expect((await sources.findById(sourceId))?.config).not.toHaveProperty('disabledReason');
  });
});

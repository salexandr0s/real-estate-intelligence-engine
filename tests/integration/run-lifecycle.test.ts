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
  await query(`UPDATE sources SET health_status = 'unknown' WHERE id = $1`, [sourceId]);
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

  it('does not disable a source on its first failure after old or network failures', async () => {
    for (let i = 0; i < 5; i++) await failedRun(30, null);
    await failedRun(1, 'transient_network');
    await failedRun(0, 'soft_anti_bot');

    const outcome = await sources.applyRunOutcome(sourceId, 'failed');
    expect(outcome.newStatus).toBe('degraded');
  });
});

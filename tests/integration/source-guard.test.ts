import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetConfig } from '@immoradar/config';
import { closePool, query, runMigrations, sources } from '@immoradar/db';
import {
  applyRunToSource,
  checkSourceRunnable,
} from '../../apps/worker-scraper/src/source-guard.js';
import { seed } from '../../packages/db/seeds/seed.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_source_guard',
  enabled: true,
});

async function insertFailedRun(sourceId: number, errorCode: string, minutesAgo: number) {
  await query(
    `INSERT INTO scrape_runs (source_id, trigger_type, scope, status, started_at, finished_at, error_code)
     VALUES ($1, 'schedule', 'full', 'failed',
             NOW() - make_interval(mins => $2), NOW() - make_interval(mins => $2), $3)`,
    [sourceId, minutesAgo, errorCode],
  );
}

describe('source guard', () => {
  beforeAll(async () => {
    resetConfig();
    await testDb.setup();
    await runMigrations();
    await seed();
  });

  afterAll(async () => {
    await closePool();
    await testDb.teardown();
    resetConfig();
  });

  it('switches a source off and drops its schedule after five failed runs in a row', async () => {
    const source = await sources.findByCode('wohnnet');
    expect(source?.isActive).toBe(true);
    for (let run = 5; run >= 1; run--) {
      await insertFailedRun(source!.id, 'soft_anti_bot', run * 180);
    }
    const discoveryQueue = { removeJobScheduler: vi.fn(async () => true) };

    await applyRunToSource(
      { sourceId: source!.id, sourceCode: 'wohnnet', status: 'failed', errorCode: 'soft_anti_bot' },
      discoveryQueue,
      new Date('2026-11-07T12:00:00Z'),
    );

    const after = await sources.findByCode('wohnnet');
    expect(after?.isActive).toBe(false);
    expect(after?.healthStatus).toBe('disabled');
    expect(after?.config['disabledReason']).toBe(
      'soft_anti_bot: 5 failed runs in a row, last on 2026-11-07',
    );
    expect(discoveryQueue.removeJobScheduler).toHaveBeenCalledWith('discovery-wohnnet');
    expect(await checkSourceRunnable('wohnnet')).toEqual({ runnable: false, reason: 'inactive' });
  });
});

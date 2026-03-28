import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../packages/db/src/client.js', () => ({
  query: hoisted.query,
}));

import {
  findLifecycleSummaries,
  findListingCounts,
} from '../../packages/db/src/queries/sources.ts';

describe('source lifecycle summary queries', () => {
  beforeEach(() => {
    hoisted.query.mockReset();
  });

  it('maps lifecycle summary rows into typed counts and timestamps', async () => {
    const explicitAt = new Date('2026-03-28T10:00:00.000Z');
    const staleAt = new Date('2026-03-28T11:00:00.000Z');

    hoisted.query.mockResolvedValueOnce([
      {
        source_id: '7',
        explicit_dead_24h: '2',
        explicit_dead_7d: '5',
        stale_expired_24h: '1',
        stale_expired_7d: '9',
        last_explicit_dead_at: explicitAt,
        last_stale_expired_at: staleAt,
      },
    ]);

    const rows = await findLifecycleSummaries();

    expect(rows).toEqual([
      {
        sourceId: 7,
        explicitDead24h: 2,
        explicitDead7d: 5,
        staleExpired24h: 1,
        staleExpired7d: 9,
        lastExplicitDeadAt: explicitAt,
        lastStaleExpiredAt: staleAt,
      },
    ]);

    const sql = hoisted.query.mock.calls[0]?.[0];
    expect(sql).toContain("version_reason = 'status_change'");
    expect(sql).toContain("listing_status IN ('withdrawn', 'sold', 'rented')");
    expect(sql).toContain("listing_status = 'expired'");
    expect(sql).toContain("INTERVAL '24 hours'");
    expect(sql).toContain("INTERVAL '7 days'");
  });

  it('maps listing counts to numeric totals', async () => {
    hoisted.query.mockResolvedValueOnce([
      { source_id: '1', total_listings_ingested: '42' },
      { source_id: '2', total_listings_ingested: '7' },
    ]);

    await expect(findListingCounts()).resolves.toEqual([
      { sourceId: 1, totalListingsIngested: 42 },
      { sourceId: 2, totalListingsIngested: 7 },
    ]);
  });
});

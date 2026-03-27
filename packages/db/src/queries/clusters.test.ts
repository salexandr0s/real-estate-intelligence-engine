import { describe, expect, it } from 'vitest';
import { dedupeClusterMemberInputs } from './clusters.js';

describe('dedupeClusterMemberInputs', () => {
  it('keeps the first listing per source and preserves source order', () => {
    const members = dedupeClusterMemberInputs([
      { listingId: 101, sourceId: 1, listPriceEurCents: 299_000_00 },
      { listingId: 102, sourceId: 1, listPriceEurCents: 301_000_00 },
      { listingId: 201, sourceId: 2, listPriceEurCents: 298_000_00 },
      { listingId: 301, sourceId: 3, listPriceEurCents: null },
      { listingId: 302, sourceId: 3, listPriceEurCents: 297_000_00 },
    ]);

    expect(members).toEqual([
      { listingId: 101, sourceId: 1, listPriceEurCents: 299_000_00 },
      { listingId: 201, sourceId: 2, listPriceEurCents: 298_000_00 },
      { listingId: 301, sourceId: 3, listPriceEurCents: null },
    ]);
  });

  it('returns an empty list unchanged', () => {
    expect(dedupeClusterMemberInputs([])).toEqual([]);
  });
});

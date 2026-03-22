import { describe, it, expect } from 'vitest';
import { shouldCreateAlert, matchListingToFilters } from '../index.js';

// ── shouldCreateAlert ───────────────────────────────────────────────────────

describe('shouldCreateAlert', () => {
  const base = {
    previousScore: null as number | null,
    newScore: null as number | null,
    previousPriceCents: null as number | null,
    newPriceCents: null as number | null,
    onlyLastSeenChanged: false,
  };

  it('always returns false when only lastSeen changed', () => {
    const types = ['new_match', 'price_drop', 'score_upgrade', 'status_change', 'digest'] as const;
    for (const alertType of types) {
      expect(shouldCreateAlert({ ...base, alertType, onlyLastSeenChanged: true })).toBe(false);
    }
  });

  it('always creates alert for new_match', () => {
    expect(shouldCreateAlert({ ...base, alertType: 'new_match' })).toBe(true);
  });

  it('creates alert for price_drop when price decreased', () => {
    expect(
      shouldCreateAlert({
        ...base,
        alertType: 'price_drop',
        previousPriceCents: 30000000,
        newPriceCents: 28000000,
      }),
    ).toBe(true);
  });

  it('does not create price_drop when price increased', () => {
    expect(
      shouldCreateAlert({
        ...base,
        alertType: 'price_drop',
        previousPriceCents: 28000000,
        newPriceCents: 30000000,
      }),
    ).toBe(false);
  });

  it('does not create price_drop when price unchanged', () => {
    expect(
      shouldCreateAlert({
        ...base,
        alertType: 'price_drop',
        previousPriceCents: 30000000,
        newPriceCents: 30000000,
      }),
    ).toBe(false);
  });

  it('does not create price_drop when previous price is null', () => {
    expect(
      shouldCreateAlert({
        ...base,
        alertType: 'price_drop',
        previousPriceCents: null,
        newPriceCents: 28000000,
      }),
    ).toBe(false);
  });

  it('creates alert for score_upgrade with 5+ point gain', () => {
    expect(
      shouldCreateAlert({
        ...base,
        alertType: 'score_upgrade',
        previousScore: 70,
        newScore: 75,
      }),
    ).toBe(true);
  });

  it('does not create score_upgrade with <5 point gain', () => {
    expect(
      shouldCreateAlert({
        ...base,
        alertType: 'score_upgrade',
        previousScore: 70,
        newScore: 74,
      }),
    ).toBe(false);
  });

  it('does not create score_upgrade when score decreased', () => {
    expect(
      shouldCreateAlert({
        ...base,
        alertType: 'score_upgrade',
        previousScore: 80,
        newScore: 75,
      }),
    ).toBe(false);
  });

  it('always creates alert for status_change', () => {
    expect(shouldCreateAlert({ ...base, alertType: 'status_change' })).toBe(true);
  });

  it('always creates alert for digest', () => {
    expect(shouldCreateAlert({ ...base, alertType: 'digest' })).toBe(true);
  });
});

// ── matchListingToFilters ───────────────────────────────────────────────────

describe('matchListingToFilters', () => {
  const listing = {
    listingId: 42,
    listingVersionId: 100,
    title: '3-Zimmer Eigentumswohnung',
    listPriceEurCents: 29900000,
    livingAreaSqm: 58.4,
    city: 'Wien',
    canonicalUrl: 'https://www.willhaben.at/iad/immobilien/123',
  };

  it('generates one alert per matching filter', () => {
    const filters = [
      { filterId: 1, userId: 10 },
      { filterId: 2, userId: 10 },
    ];
    const alerts = matchListingToFilters(listing, filters, 'new_match', 1);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.userFilterId).toBe(1);
    expect(alerts[1]!.userFilterId).toBe(2);
  });

  it('produces correct dedupe key format', () => {
    const alerts = matchListingToFilters(listing, [{ filterId: 5, userId: 1 }], 'new_match', 1);
    expect(alerts[0]!.dedupeKey).toBe('filter:5:listing:42:type:new_match:sv:1');
  });

  it('generates German title for new_match', () => {
    const alerts = matchListingToFilters(listing, [{ filterId: 1, userId: 1 }], 'new_match', 1);
    expect(alerts[0]!.title).toContain('Neues Inserat');
  });

  it('generates German title for price_drop', () => {
    const alerts = matchListingToFilters(listing, [{ filterId: 1, userId: 1 }], 'price_drop', 1);
    expect(alerts[0]!.title).toContain('Preissenkung');
  });

  it('includes price and area in body', () => {
    const alerts = matchListingToFilters(listing, [{ filterId: 1, userId: 1 }], 'new_match', 1);
    expect(alerts[0]!.body).toContain('58.4 m²');
    expect(alerts[0]!.body).toContain('Wien');
  });

  it('returns empty array for no matching filters', () => {
    const alerts = matchListingToFilters(listing, [], 'new_match', 1);
    expect(alerts).toHaveLength(0);
  });

  it('sets channel to in_app', () => {
    const alerts = matchListingToFilters(listing, [{ filterId: 1, userId: 1 }], 'new_match', 1);
    expect(alerts[0]!.channel).toBe('in_app');
  });
});

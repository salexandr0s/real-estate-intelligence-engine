/**
 * Ingestion deduplication and upsert behavior tests.
 * Tests the core idempotency guarantees of the system.
 * Imports real implementations where available; keeps inline-only for
 * business-rule concepts not exported from packages.
 */
import { describe, it, expect } from 'vitest';
import { computeContentHash } from '@rei/scraper-core';
import { computeContentFingerprint } from '@rei/normalization';
import type { CanonicalListingInput } from '@rei/contracts';

// ── Business rule helpers (not exported from packages) ──────────────────────

type VersionReason = 'first_seen' | 'price_change' | 'content_change' | 'status_change' | null;

function detectVersionReason(
  existing: { contentFingerprint: string; listPriceEurCents: number | null; listingStatus: string } | null,
  incoming: { contentFingerprint: string; listPriceEurCents: number | null; listingStatus: string },
): VersionReason {
  if (!existing) return 'first_seen';
  if (existing.contentFingerprint === incoming.contentFingerprint) return null;
  if (existing.listPriceEurCents !== incoming.listPriceEurCents) return 'price_change';
  if (existing.listingStatus !== incoming.listingStatus) return 'status_change';
  return 'content_change';
}

function buildDedupeKey(filterId: number, listingId: number, alertType: string, scoreVersion?: number): string {
  const parts = [`filter:${filterId}`, `listing:${listingId}`, `type:${alertType}`];
  if (scoreVersion != null) parts.push(`sv:${scoreVersion}`);
  return parts.join(':');
}

// ── Helper: build listing data for fingerprinting ──────────────────────────

function makeListing(overrides: Partial<CanonicalListingInput> = {}): Partial<CanonicalListingInput> {
  return {
    title: '3-Zimmer Wohnung',
    description: 'Schöne Wohnung',
    listPriceEurCents: 29900000,
    livingAreaSqm: 58.4,
    rooms: 3,
    propertyType: 'apartment',
    districtNo: 2,
    postalCode: '1020',
    city: 'Wien',
    listingStatus: 'active',
    hasBalcony: true,
    hasTerrace: false,
    hasGarden: false,
    hasElevator: true,
    parkingAvailable: false,
    isFurnished: false,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('computeContentHash', () => {
  it('produces same hash for same content', () => {
    const payload = { title: 'Test', price: 100 };
    const hash1 = computeContentHash(payload);
    const hash2 = computeContentHash(payload);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different content', () => {
    const hash1 = computeContentHash({ title: 'A', price: 100 });
    const hash2 = computeContentHash({ title: 'B', price: 100 });
    expect(hash1).not.toBe(hash2);
  });

  it('is key-order independent', () => {
    const hash1 = computeContentHash({ b: 2, a: 1 });
    const hash2 = computeContentHash({ a: 1, b: 2 });
    expect(hash1).toBe(hash2);
  });

  it('is a valid 64-char hex string', () => {
    const hash = computeContentHash({ test: true });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('computeContentFingerprint', () => {
  it('is stable for same data', () => {
    const listing = makeListing();
    const fp1 = computeContentFingerprint(listing);
    const fp2 = computeContentFingerprint(listing);
    expect(fp1).toBe(fp2);
  });

  it('changes on price change', () => {
    const fp1 = computeContentFingerprint(makeListing());
    const fp2 = computeContentFingerprint(makeListing({ listPriceEurCents: 28000000 }));
    expect(fp1).not.toBe(fp2);
  });

  it('changes on status change', () => {
    const fp1 = computeContentFingerprint(makeListing());
    const fp2 = computeContentFingerprint(makeListing({ listingStatus: 'sold' }));
    expect(fp1).not.toBe(fp2);
  });

  it('changes on area change', () => {
    const fp1 = computeContentFingerprint(makeListing());
    const fp2 = computeContentFingerprint(makeListing({ livingAreaSqm: 62.0 }));
    expect(fp1).not.toBe(fp2);
  });

  it('produces a valid 64-char hex string', () => {
    const fp = computeContentFingerprint(makeListing());
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('detectVersionReason', () => {
  it('returns first_seen when no existing listing', () => {
    expect(detectVersionReason(null, {
      contentFingerprint: 'abc', listPriceEurCents: 100, listingStatus: 'active',
    })).toBe('first_seen');
  });

  it('returns null when fingerprint unchanged', () => {
    const existing = { contentFingerprint: 'abc', listPriceEurCents: 100, listingStatus: 'active' };
    expect(detectVersionReason(existing, existing)).toBe(null);
  });

  it('returns price_change when price changed', () => {
    expect(detectVersionReason(
      { contentFingerprint: 'abc', listPriceEurCents: 100, listingStatus: 'active' },
      { contentFingerprint: 'def', listPriceEurCents: 90, listingStatus: 'active' },
    )).toBe('price_change');
  });

  it('returns status_change when status changed', () => {
    expect(detectVersionReason(
      { contentFingerprint: 'abc', listPriceEurCents: 100, listingStatus: 'active' },
      { contentFingerprint: 'def', listPriceEurCents: 100, listingStatus: 'sold' },
    )).toBe('status_change');
  });

  it('returns content_change for other changes', () => {
    expect(detectVersionReason(
      { contentFingerprint: 'abc', listPriceEurCents: 100, listingStatus: 'active' },
      { contentFingerprint: 'def', listPriceEurCents: 100, listingStatus: 'active' },
    )).toBe('content_change');
  });
});

describe('buildDedupeKey', () => {
  it('builds deterministic key', () => {
    expect(buildDedupeKey(1, 42, 'new_match', 1)).toBe('filter:1:listing:42:type:new_match:sv:1');
  });

  it('omits score version when not provided', () => {
    expect(buildDedupeKey(1, 42, 'price_drop')).toBe('filter:1:listing:42:type:price_drop');
  });

  it('produces different keys for different inputs', () => {
    const key1 = buildDedupeKey(1, 42, 'new_match', 1);
    const key2 = buildDedupeKey(1, 43, 'new_match', 1);
    expect(key1).not.toBe(key2);
  });
});

describe('idempotency scenarios', () => {
  it('re-observation of identical raw payload should not create new version', () => {
    const payload1 = { title: 'Test', price: 299000 };
    const payload2 = { title: 'Test', price: 299000 };

    const hash1 = computeContentHash(payload1);
    const hash2 = computeContentHash(payload2);
    expect(hash1).toBe(hash2);

    const listing = makeListing();
    const fp1 = computeContentFingerprint(listing);
    const fp2 = computeContentFingerprint(listing);

    expect(fp1).toBe(fp2);
    expect(detectVersionReason(
      { contentFingerprint: fp1, listPriceEurCents: 29900000, listingStatus: 'active' },
      { contentFingerprint: fp2, listPriceEurCents: 29900000, listingStatus: 'active' },
    )).toBe(null);
  });

  it('price change creates new version and different hash', () => {
    const fp1 = computeContentFingerprint(makeListing());
    const fp2 = computeContentFingerprint(makeListing({ listPriceEurCents: 28000000 }));

    expect(fp1).not.toBe(fp2);
    expect(detectVersionReason(
      { contentFingerprint: fp1, listPriceEurCents: 29900000, listingStatus: 'active' },
      { contentFingerprint: fp2, listPriceEurCents: 28000000, listingStatus: 'active' },
    )).toBe('price_change');
  });

  it('alert dedupe prevents duplicate alerts for same event', () => {
    const key1 = buildDedupeKey(1, 42, 'new_match', 1);
    const key2 = buildDedupeKey(1, 42, 'new_match', 1);
    expect(key1).toBe(key2);
  });
});

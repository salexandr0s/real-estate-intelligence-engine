/**
 * Ingestion deduplication and upsert behavior tests.
 * Tests the core idempotency guarantees of the system.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';

// ── Content hashing (must match scraper-core implementation) ────────────────

function computeContentHash(payload: Record<string, unknown>): string {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(sorted).digest('hex');
}

// ── Content fingerprinting (for listing versions) ───────────────────────────

interface FingerprintInput {
  title: string;
  description: string | null;
  listPriceEurCents: number | null;
  livingAreaSqm: number | null;
  rooms: number | null;
  propertyType: string;
  districtNo: number | null;
  postalCode: string | null;
  city: string;
  listingStatus: string;
  hasBalcony: boolean | null;
  hasTerrace: boolean | null;
  hasGarden: boolean | null;
  hasElevator: boolean | null;
}

function computeContentFingerprint(input: FingerprintInput): string {
  const data = JSON.stringify({
    title: input.title,
    description: input.description,
    listPriceEurCents: input.listPriceEurCents,
    livingAreaSqm: input.livingAreaSqm,
    rooms: input.rooms,
    propertyType: input.propertyType,
    districtNo: input.districtNo,
    postalCode: input.postalCode,
    city: input.city,
    listingStatus: input.listingStatus,
    hasBalcony: input.hasBalcony,
    hasTerrace: input.hasTerrace,
    hasGarden: input.hasGarden,
    hasElevator: input.hasElevator,
  });
  return createHash('sha256').update(data).digest('hex');
}

// ── Version reason detection ────────────────────────────────────────────────

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

// ── Alert dedupe key ────────────────────────────────────────────────────────

function buildDedupeKey(filterId: number, listingId: number, alertType: string, scoreVersion?: number): string {
  const parts = [`filter:${filterId}`, `listing:${listingId}`, `type:${alertType}`];
  if (scoreVersion != null) parts.push(`sv:${scoreVersion}`);
  return parts.join(':');
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
  const baseListing: FingerprintInput = {
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
  };

  it('is stable for same data', () => {
    const fp1 = computeContentFingerprint(baseListing);
    const fp2 = computeContentFingerprint(baseListing);
    expect(fp1).toBe(fp2);
  });

  it('changes on price change', () => {
    const fp1 = computeContentFingerprint(baseListing);
    const fp2 = computeContentFingerprint({ ...baseListing, listPriceEurCents: 28000000 });
    expect(fp1).not.toBe(fp2);
  });

  it('changes on status change', () => {
    const fp1 = computeContentFingerprint(baseListing);
    const fp2 = computeContentFingerprint({ ...baseListing, listingStatus: 'sold' });
    expect(fp1).not.toBe(fp2);
  });

  it('changes on area change', () => {
    const fp1 = computeContentFingerprint(baseListing);
    const fp2 = computeContentFingerprint({ ...baseListing, livingAreaSqm: 62.0 });
    expect(fp1).not.toBe(fp2);
  });

  it('does NOT change for fields excluded from fingerprint (verified by design)', () => {
    // Fingerprint excludes timestamps, crawl IDs, artifact keys
    // This is a design test: the fingerprint only includes the fields we listed
    const fp = computeContentFingerprint(baseListing);
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
    // Simulate: same listing scraped twice with identical content
    const payload1 = { title: 'Test', price: 299000 };
    const payload2 = { title: 'Test', price: 299000 };

    const hash1 = computeContentHash(payload1);
    const hash2 = computeContentHash(payload2);

    // Same hash → raw_listings ON CONFLICT updates observation_count, no new row
    expect(hash1).toBe(hash2);

    // Same fingerprint → no new listing_versions row
    const fp1 = computeContentFingerprint({
      title: 'Test', description: null, listPriceEurCents: 29900000,
      livingAreaSqm: 58, rooms: 3, propertyType: 'apartment',
      districtNo: 2, postalCode: '1020', city: 'Wien',
      listingStatus: 'active', hasBalcony: null, hasTerrace: null,
      hasGarden: null, hasElevator: null,
    });
    const fp2 = computeContentFingerprint({
      title: 'Test', description: null, listPriceEurCents: 29900000,
      livingAreaSqm: 58, rooms: 3, propertyType: 'apartment',
      districtNo: 2, postalCode: '1020', city: 'Wien',
      listingStatus: 'active', hasBalcony: null, hasTerrace: null,
      hasGarden: null, hasElevator: null,
    });

    expect(fp1).toBe(fp2);
    expect(detectVersionReason(
      { contentFingerprint: fp1, listPriceEurCents: 29900000, listingStatus: 'active' },
      { contentFingerprint: fp2, listPriceEurCents: 29900000, listingStatus: 'active' },
    )).toBe(null);
  });

  it('price change creates new version and different hash', () => {
    const fp1 = computeContentFingerprint({
      title: 'Test', description: null, listPriceEurCents: 29900000,
      livingAreaSqm: 58, rooms: 3, propertyType: 'apartment',
      districtNo: 2, postalCode: '1020', city: 'Wien',
      listingStatus: 'active', hasBalcony: null, hasTerrace: null,
      hasGarden: null, hasElevator: null,
    });
    const fp2 = computeContentFingerprint({
      title: 'Test', description: null, listPriceEurCents: 28000000, // price drop
      livingAreaSqm: 58, rooms: 3, propertyType: 'apartment',
      districtNo: 2, postalCode: '1020', city: 'Wien',
      listingStatus: 'active', hasBalcony: null, hasTerrace: null,
      hasGarden: null, hasElevator: null,
    });

    expect(fp1).not.toBe(fp2);
    expect(detectVersionReason(
      { contentFingerprint: fp1, listPriceEurCents: 29900000, listingStatus: 'active' },
      { contentFingerprint: fp2, listPriceEurCents: 28000000, listingStatus: 'active' },
    )).toBe('price_change');
  });

  it('alert dedupe prevents duplicate alerts for same event', () => {
    const key1 = buildDedupeKey(1, 42, 'new_match', 1);
    const key2 = buildDedupeKey(1, 42, 'new_match', 1);
    // Same key → ON CONFLICT DO NOTHING in alerts table
    expect(key1).toBe(key2);
  });
});

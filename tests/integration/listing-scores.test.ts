import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScoreResult, VersionReason } from '@immoradar/contracts';
import { listingScores, listingVersions, query, runMigrations } from '@immoradar/db';
import { seed } from '../../packages/db/seeds/seed.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_scores',
  enabled: true,
});

let listingId: number;
let rawListingId: number;
let versionId: number;

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  await seed();
  const [source] = await query<{ id: string }>(`SELECT id FROM sources ORDER BY id LIMIT 1`);
  const [run] = await query<{ id: string }>(
    `INSERT INTO scrape_runs (source_id, trigger_type, scope)
     VALUES ($1, 'manual', 'full') RETURNING id`,
    [source!.id],
  );
  const [raw] = await query<{ id: string }>(
    `INSERT INTO raw_listings (
       source_id, source_listing_key, canonical_url, detail_url, content_sha256,
       first_scrape_run_id, last_scrape_run_id, extraction_status
     ) VALUES ($1, 'scored', 'https://example.com/scored', 'https://example.com/scored', $2,
       $3, $3, 'captured')
     RETURNING id`,
    [source!.id, 'a'.repeat(64), run!.id],
  );
  const [listing] = await query<{ id: string }>(
    `INSERT INTO listings (
       source_id, source_listing_key, current_raw_listing_id, latest_scrape_run_id,
       canonical_url, operation_type, property_type, title, city, content_fingerprint
     ) VALUES ($1, 'scored', $2, $3, 'https://example.com/scored', 'sale', 'apartment',
       'Fixture', 'Wien', $4)
     RETURNING id`,
    [source!.id, raw!.id, run!.id, 'b'.repeat(64)],
  );
  listingId = Number(listing!.id);
  rawListingId = Number(raw!.id);
  const version = await listingVersions.appendVersion({
    listingId,
    rawListingId,
    listingStatus: 'active',
    versionReason: 'first_seen',
    contentFingerprint: 'b'.repeat(64),
    normalizedSnapshot: {},
  });
  versionId = version.id;
});

afterAll(async () => {
  await testDb.teardown();
});

const firstScore: ScoreResult = {
  overallScore: 61.5,
  districtPriceScore: 55,
  undervaluationScore: 40.25,
  keywordSignalScore: 50,
  timeOnMarketScore: 70,
  confidenceScore: 80,
  locationScore: 75,
  districtBaselinePpsqmEur: 5200,
  bucketBaselinePpsqmEur: 5400.5,
  discountToDistrictPct: 0.0512,
  discountToBucketPct: 0.0875,
  matchedPositiveKeywords: ['balkon'],
  matchedNegativeKeywords: [],
  explanation: { summary: 'first' },
  scoreVersion: 1,
  baselineFallbackLevel: 'district_bucket',
  baselineSampleSize: 12,
  baselineFreshnessHours: 30,
};

const rescore: ScoreResult = {
  overallScore: 72,
  districtPriceScore: 68.75,
  undervaluationScore: 66,
  keywordSignalScore: 45.5,
  timeOnMarketScore: 64,
  confidenceScore: 85,
  locationScore: 60,
  districtBaselinePpsqmEur: 5600,
  bucketBaselinePpsqmEur: 5900,
  discountToDistrictPct: 0.1,
  discountToBucketPct: 0.15,
  matchedPositiveKeywords: ['lift', 'terrasse'],
  matchedNegativeKeywords: ['sanierungsbedürftig'],
  explanation: { summary: 'rescored', factors: ['district'] },
  scoreVersion: 1,
  baselineFallbackLevel: 'district',
  baselineSampleSize: 40,
  baselineFreshnessHours: 2,
};

describe('insertScore', () => {
  // A rescore that kept the old baselines and explanation would show new numbers with old reasons.
  it('replaces every field when the same version is scored again', async () => {
    await listingScores.insertScore(listingId, versionId, firstScore);
    expect(await listingScores.findLatestByListingId(listingId)).toEqual(firstScore);

    await listingScores.insertScore(listingId, versionId, rescore);
    expect(await listingScores.findLatestByListingId(listingId)).toEqual(rescore);
  });
});

describe('findPreviousPrice', () => {
  // Measured as a drop, a backfill that corrects a misread price would raise the listing's score.
  it('sees no price move into a backfill version, and measures the next one from its price', async () => {
    const append = (versionReason: VersionReason, listPriceEurCents: number) =>
      listingVersions.appendVersion({
        listingId,
        rawListingId,
        listingStatus: 'active',
        versionReason,
        contentFingerprint: 'b'.repeat(64),
        listPriceEurCents,
        normalizedSnapshot: {},
      });

    // A misread price, then the corrected one in a backfill version.
    await append('price_change', 389_000_500);
    await append('backfill', 38_900_050);
    expect(await listingVersions.findPreviousPrice(listingId)).toBeNull();

    await append('price_change', 37_000_000);
    expect(await listingVersions.findPreviousPrice(listingId)).toBe(38_900_050);
  });
});

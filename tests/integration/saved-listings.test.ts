import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query, runMigrations, savedListings } from '@immoradar/db';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_saved_listings',
  enabled: true,
});

let userId: number;
let listingId: number;

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  const source = await query<{ id: string }>(
    `INSERT INTO sources (code, name, base_url) VALUES ('saved', 'saved', 'https://saved.example.com')
     RETURNING id`,
  );
  const sourceId = Number(source[0]!.id);
  const run = await query<{ id: string }>(
    `INSERT INTO scrape_runs (source_id, trigger_type, scope) VALUES ($1, 'manual', 'full')
     RETURNING id`,
    [sourceId],
  );
  const runId = Number(run[0]!.id);
  const url = 'https://saved.example.com/1';
  const raw = await query<{ id: string }>(
    `INSERT INTO raw_listings (
       source_id, source_listing_key, canonical_url, detail_url, content_sha256,
       first_scrape_run_id, last_scrape_run_id, extraction_status
     ) VALUES ($1, 'saved-1', $2, $2, $3, $4, $4, 'captured')
     RETURNING id`,
    [sourceId, url, '0'.repeat(64), runId],
  );
  const listing = await query<{ id: string }>(
    `INSERT INTO listings (
       source_id, source_listing_key, current_raw_listing_id, latest_scrape_run_id,
       canonical_url, operation_type, property_type, listing_status, title, city,
       content_fingerprint
     ) VALUES ($1, 'saved-1', $2, $3, $4, 'sale', 'apartment', 'active', 'Fixture', 'Wien', $5)
     RETURNING id`,
    [sourceId, raw[0]!.id, runId, url, 'p'.repeat(64)],
  );
  listingId = Number(listing[0]!.id);
  const user = await query<{ id: string }>(
    `INSERT INTO app_users (display_name) VALUES ('Investor') RETURNING id`,
  );
  userId = Number(user[0]!.id);
});

afterAll(async () => {
  await testDb.teardown();
});

describe('savedListings.save', () => {
  // The listing screen's Save sends no note. Saving again used to replace the note with nothing,
  // erasing what the user wrote on the watchlist.
  it('keeps the note when a saved listing is saved again without one, and null clears it', async () => {
    await savedListings.save(userId, listingId, 'Ask about the parking space');

    expect((await savedListings.save(userId, listingId)).notes).toBe('Ask about the parking space');
    expect((await savedListings.save(userId, listingId, null)).notes).toBeNull();
  });
});

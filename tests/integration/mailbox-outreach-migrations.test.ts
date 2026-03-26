import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query, runMigrations } from '@immoradar/db';
import { seed } from '../../packages/db/seeds/seed.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  'packages',
  'db',
  'migrations',
  '020-mailbox-outreach.sql',
);
const hasDb = !!process.env.DATABASE_URL;
const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_outreach',
  enabled: hasDb,
});

async function insertFixtureListing() {
  const source = await query<{ id: string }>(`SELECT id FROM sources ORDER BY id LIMIT 1`);
  const sourceId = Number(source[0]!.id);

  const scrapeRun = await query<{ id: string }>(
    `INSERT INTO scrape_runs (source_id, trigger_type, scope)
     VALUES ($1, 'manual', 'full')
     RETURNING id`,
    [sourceId],
  );
  const scrapeRunId = Number(scrapeRun[0]!.id);

  const rawListing = await query<{ id: string }>(
    `INSERT INTO raw_listings (
       source_id, source_listing_key, canonical_url, detail_url, content_sha256,
       first_scrape_run_id, last_scrape_run_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING id`,
    [
      sourceId,
      `fixture-${Date.now()}`,
      'https://example.com/listing/fixture',
      'https://example.com/listing/fixture',
      'a'.repeat(64),
      scrapeRunId,
    ],
  );
  const rawListingId = Number(rawListing[0]!.id);

  const listing = await query<{ id: string }>(
    `INSERT INTO listings (
       source_id, source_listing_key, current_raw_listing_id, latest_scrape_run_id,
       canonical_url, operation_type, property_type, title, city, content_fingerprint
     ) VALUES ($1, $2, $3, $4, $5, 'sale', 'apartment', $6, 'Wien', $7)
     RETURNING id`,
    [
      sourceId,
      `listing-${Date.now()}`,
      rawListingId,
      scrapeRunId,
      'https://example.com/listing/fixture',
      'Fixture Listing',
      'b'.repeat(64),
    ],
  );

  return Number(listing[0]!.id);
}

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  await seed();
});

afterAll(async () => {
  await testDb.teardown();
});

describe('mailbox/outreach migration smoke', () => {
  it('defines the expected tables and indexes in migration 020', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mailbox_accounts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS outreach_threads');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS outreach_messages');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS outreach_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS outreach_message_documents');
    expect(sql).toContain('uq_outreach_threads_open_listing_contact');
    expect(sql).toContain('uq_outreach_messages_provider');
    expect(sql).toContain('idx_outreach_threads_due');
    expect(sql).toContain('idx_outreach_messages_mailbox_uid');
  });

  it.skipIf(!hasDb)('creates the expected outreach tables and indexes in postgres', async () => {
    const tables = await query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (tablename LIKE 'outreach_%' OR tablename = 'mailbox_accounts') ORDER BY tablename`,
    );
    expect(tables.map((row) => row.tablename)).toEqual([
      'mailbox_accounts',
      'outreach_events',
      'outreach_message_documents',
      'outreach_messages',
      'outreach_threads',
    ]);

    const indexes = await query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
        'uq_outreach_threads_open_listing_contact',
        'uq_outreach_messages_provider',
        'idx_outreach_threads_due',
        'idx_outreach_messages_mailbox_uid'
      ) ORDER BY indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      'idx_outreach_messages_mailbox_uid',
      'idx_outreach_threads_due',
      'uq_outreach_messages_provider',
      'uq_outreach_threads_open_listing_contact',
    ]);
  });

  it.skipIf(!hasDb)(
    'enforces open-thread dedupe while still allowing a closed replacement thread',
    async () => {
      const user = await query<{ id: string }>(`SELECT id FROM app_users ORDER BY id LIMIT 1`);
      const userId = Number(user[0]!.id);
      const listingId = await insertFixtureListing();

      const mailbox = await query<{ id: string }>(
        `INSERT INTO mailbox_accounts (user_id, email, display_name, secret_ref)
       VALUES ($1, 'mailbox@example.com', 'Mailbox', 'env:test')
       RETURNING id`,
        [userId],
      );
      const mailboxId = Number(mailbox[0]!.id);

      await query(
        `INSERT INTO outreach_threads (
         user_id, listing_id, mailbox_account_id, contact_email, workflow_state
       ) VALUES ($1, $2, $3, 'broker@example.com', 'queued_send')`,
        [userId, listingId, mailboxId],
      );

      await expect(
        query(
          `INSERT INTO outreach_threads (
           user_id, listing_id, mailbox_account_id, contact_email, workflow_state
         ) VALUES ($1, $2, $3, 'broker@example.com', 'draft')`,
          [userId, listingId, mailboxId],
        ),
      ).rejects.toMatchObject({ code: '23505' });

      await query(
        `UPDATE outreach_threads SET workflow_state = 'closed' WHERE contact_email = 'broker@example.com'`,
      );

      await expect(
        query(
          `INSERT INTO outreach_threads (
           user_id, listing_id, mailbox_account_id, contact_email, workflow_state
         ) VALUES ($1, $2, $3, 'broker@example.com', 'draft')`,
          [userId, listingId, mailboxId],
        ),
      ).resolves.toBeDefined();
    },
  );

  it.skipIf(!hasDb)('enforces inbound provider-message dedupe per mailbox', async () => {
    const user = await query<{ id: string }>(`SELECT id FROM app_users ORDER BY id LIMIT 1`);
    const userId = Number(user[0]!.id);
    const listingId = await insertFixtureListing();

    const mailbox = await query<{ id: string }>(
      `INSERT INTO mailbox_accounts (user_id, email, display_name, secret_ref)
       VALUES ($1, $2, 'Inbox', 'env:test')
       RETURNING id`,
      [userId, `mailbox-${Date.now()}@example.com`],
    );
    const mailboxId = Number(mailbox[0]!.id);

    const thread = await query<{ id: string }>(
      `INSERT INTO outreach_threads (
         user_id, listing_id, mailbox_account_id, contact_email, workflow_state
       ) VALUES ($1, $2, $3, 'broker2@example.com', 'sent_waiting_reply')
       RETURNING id`,
      [userId, listingId, mailboxId],
    );
    const threadId = Number(thread[0]!.id);

    await query(
      `INSERT INTO outreach_messages (
         thread_id, mailbox_account_id, direction, message_kind, delivery_status,
         provider_message_id, subject, match_strategy
       ) VALUES ($1, $2, 'inbound', 'reply', 'received', 'provider-1', 'Re: Test', 'headers')`,
      [threadId, mailboxId],
    );

    await expect(
      query(
        `INSERT INTO outreach_messages (
           thread_id, mailbox_account_id, direction, message_kind, delivery_status,
           provider_message_id, subject, match_strategy
         ) VALUES ($1, $2, 'inbound', 'reply', 'received', 'provider-1', 'Re: Test', 'headers')`,
        [threadId, mailboxId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

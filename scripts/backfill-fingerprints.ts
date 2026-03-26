#!/usr/bin/env npx tsx
/**
 * Backfill cross_source_fingerprint for listings that are missing it.
 *
 * Usage: npx tsx scripts/backfill-fingerprints.ts
 */

import { query, closePool } from '@immoradar/db';
import { computeCrossSourceFingerprint } from '@immoradar/normalization/src/canonical/fingerprint.js';

interface Row {
  id: string;
  street: string | null;
  house_number: string | null;
  postal_code: string | null;
  city: string;
  living_area_sqm: string | null;
  list_price_eur_cents: string | null;
}

async function main() {
  const rows = await query<Row>(`
    SELECT id, street, house_number, postal_code, city, living_area_sqm, list_price_eur_cents
    FROM listings WHERE cross_source_fingerprint IS NULL
  `);
  console.log(`Found ${rows.length} listings missing cross-source fingerprint`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const fp = computeCrossSourceFingerprint({
      street: row.street ?? undefined,
      houseNumber: row.house_number ?? undefined,
      postalCode: row.postal_code ?? undefined,
      city: row.city,
      livingAreaSqm: row.living_area_sqm ? parseFloat(row.living_area_sqm) : undefined,
      listPriceEurCents: row.list_price_eur_cents
        ? parseInt(row.list_price_eur_cents, 10)
        : undefined,
    });

    if (fp) {
      await query('UPDATE listings SET cross_source_fingerprint = $1 WHERE id = $2', [fp, row.id]);
      updated++;
    } else {
      skipped++;
    }

    if ((updated + skipped) % 200 === 0) {
      console.log(`  ${updated + skipped}/${rows.length} processed...`);
    }
  }

  console.log(`\nDone: ${updated} fingerprinted, ${skipped} skipped (insufficient data)`);
  await closePool();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

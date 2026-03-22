#!/usr/bin/env npx tsx
/**
 * Rescore all active listings against current baselines.
 * Usage: npx tsx scripts/rescore-listings.ts [--source <code>] [--limit N] [--dry-run]
 */

import { loadConfig } from '@rei/config';
import { createLogger } from '@rei/observability';
import {
  query,
  sources,
  listings,
  listingScores,
  listingVersions,
  marketBaselines,
  proximity,
  closePool,
} from '@rei/db';
import { scoreListing, SCORE_VERSION } from '@rei/scoring';
import { getAreaBucket, getRoomBucket } from '@rei/contracts';
import type { ScoreInput, BaselineLookup } from '@rei/contracts';

const log = createLogger('rescore');

interface CliArgs {
  sourceCode: string | null;
  limit: number | null;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let sourceCode: string | null = null;
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceCode = args[i + 1]!;
      i++;
    }
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]!, 10);
      i++;
    }
    if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { sourceCode, limit, dryRun };
}

interface ListingRow {
  id: number;
  title: string;
  description: string | null;
  operation_type: string;
  property_type: string;
  district_no: number | null;
  city: string;
  list_price_eur_cents: string | null;
  living_area_sqm: string | null;
  usable_area_sqm: string | null;
  rooms: string | null;
  completeness_score: string;
  first_seen_at: Date;
  last_price_change_at: Date | null;
  current_score: string | null;
  latitude: string | null;
  longitude: string | null;
}

async function main(): Promise<void> {
  const { sourceCode, limit, dryRun } = parseArgs();
  loadConfig();

  log.info('Starting rescore', { sourceCode, limit, dryRun, scoreVersion: SCORE_VERSION });

  // Resolve source filter
  let sourceId: number | null = null;
  if (sourceCode) {
    const source = await sources.findByCode(sourceCode);
    if (!source) {
      log.error(`Source "${sourceCode}" not found in sources table.`);
      await closePool();
      process.exit(1);
    }
    sourceId = source.id;
  }

  const conditions: string[] = ["listing_status = 'active'"];
  const params: unknown[] = [];

  if (sourceId != null) {
    params.push(sourceId);
    conditions.push(`source_id = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');
  const limitClause = limit != null ? `LIMIT $${params.length + 1}` : '';
  if (limit != null) params.push(limit);

  const rows = await query<ListingRow>(
    `SELECT id, title, description, operation_type, property_type,
            district_no, city, list_price_eur_cents, living_area_sqm,
            usable_area_sqm, rooms, completeness_score, first_seen_at,
            last_price_change_at, current_score, latitude, longitude
     FROM listings
     WHERE ${whereClause}
     ${limitClause}`,
    params,
  );

  log.info(`Found ${rows.length} active listings to rescore`);

  let rescored = 0;
  let unchanged = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const priceCents = row.list_price_eur_cents != null ? Number(row.list_price_eur_cents) : null;
      const livingArea = row.living_area_sqm != null ? Number(row.living_area_sqm) : null;
      const usableArea = row.usable_area_sqm != null ? Number(row.usable_area_sqm) : null;
      const effectiveArea = livingArea ?? usableArea;
      const rooms = row.rooms != null ? Number(row.rooms) : null;

      const pricePerSqmEur =
        priceCents != null && effectiveArea != null && effectiveArea > 0
          ? Math.round((priceCents / 100 / effectiveArea) * 100) / 100
          : null;

      const areaBucket = getAreaBucket(effectiveArea);
      const roomBucket = getRoomBucket(rooms);

      const baseline = await marketBaselines.findBaselineWithFallback({
        districtNo: row.district_no,
        operationType: row.operation_type,
        propertyType: row.property_type,
        areaBucket,
        roomBucket,
      });

      const bl: BaselineLookup = {
        districtBaselinePpsqmEur: baseline.baseline?.medianPpsqmEur ?? null,
        bucketBaselinePpsqmEur: baseline.baseline?.medianPpsqmEur ?? null,
        bucketSampleSize: baseline.baseline?.sampleSize ?? 0,
        fallbackLevel: baseline.fallbackLevel,
      };

      // Compute proximity data for location score
      const lat = row.latitude != null ? Number(row.latitude) : null;
      const lon = row.longitude != null ? Number(row.longitude) : null;
      let proximityData = null;
      if (lat != null && lon != null) {
        try {
          proximityData = await proximity.computeProximity(lat, lon);
        } catch {
          // Proximity failure is non-fatal — location score will default to 50
        }
      }

      const input: ScoreInput = {
        listingId: row.id,
        listingVersionId: 0,
        pricePerSqmEur,
        districtNo: row.district_no,
        operationType: row.operation_type,
        propertyType: row.property_type,
        livingAreaSqm: livingArea,
        rooms,
        city: row.city,
        title: row.title,
        description: row.description,
        firstSeenAt: row.first_seen_at,
        lastPriceChangeAt: row.last_price_change_at,
        recentPriceDropPct: 0,
        relistDetected: false,
        completenessScore: Number(row.completeness_score),
        sourceHealthScore: 90,
        locationConfidence: 75,
        proximityData,
      };

      const score = scoreListing(input, bl);
      const oldScore = row.current_score != null ? Number(row.current_score) : null;

      if (oldScore != null && Math.abs(score.overallScore - oldScore) < 0.5) {
        unchanged++;
        continue;
      }

      if (!dryRun) {
        // Get latest version ID for this listing
        const versions = await listingVersions.findByListingId(row.id, 1);
        const latestVersionId = versions[0]?.id ?? 0;
        if (latestVersionId > 0) {
          await listingScores.insertScore(row.id, latestVersionId, score);
        }
        await listings.updateScore(row.id, score.overallScore, new Date());
      }

      rescored++;
      log.info(
        `Rescored listing ${row.id}: ${oldScore?.toFixed(1) ?? 'null'} → ${score.overallScore.toFixed(1)}`,
        {
          title: row.title.slice(0, 50),
        },
      );
    } catch (err) {
      errors++;
      log.error(`Failed to rescore listing ${row.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log('\n=== Rescore Summary ===');
  console.log(`Source:         ${sourceCode ?? 'all'}`);
  console.log(`Score version:  ${SCORE_VERSION}`);
  console.log(`Total active:   ${rows.length}`);
  console.log(`Rescored:       ${rescored}`);
  console.log(`Unchanged:      ${unchanged}`);
  console.log(`Errors:         ${errors}`);
  console.log(`Dry run:        ${dryRun}`);
  console.log('======================\n');

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

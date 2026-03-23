#!/usr/bin/env npx tsx
/**
 * Backfill listing_documents from historical raw_listings payloads.
 *
 * Scans raw_listings for URL patterns indicating document/PDF attachments
 * (e.g. .pdf, expose, dokument) and creates document records for matching
 * canonical listings.
 *
 * This is a best-effort scan -- not all raw payloads will contain document URLs.
 *
 * Usage:
 *   npx tsx scripts/backfill-documents.ts
 *   npx tsx scripts/backfill-documents.ts --dry-run
 *   npx tsx scripts/backfill-documents.ts --limit 500
 */

import { createLogger } from '@rei/observability';
import { query, documents, closePool } from '@rei/db';
import { createHash } from 'node:crypto';

const log = createLogger('backfill-documents');
const isDryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const maxRows = limitArg >= 0 ? parseInt(process.argv[limitArg + 1] ?? '5000', 10) : 5000;

// ── Types ──────────────────────────────────────────────────────────────────

interface RawPayloadRow {
  id: string;
  source_listing_key: string;
  source_id: string;
  raw_payload: Record<string, unknown>;
}

interface ListingLookupRow {
  id: string;
}

// ── URL extraction ─────────────────────────────────────────────────────────

/** URL patterns that indicate document/attachment links. */
const DOC_PATTERNS = [
  /https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi,
  /https?:\/\/[^\s"'<>]*(?:expose|expos[eé]|dokument|document|beilage|grundriss|energieausweis)[^\s"'<>]*/gi,
];

interface ExtractedUrl {
  url: string;
  type: string;
}

/**
 * Recursively walk the raw payload and extract document URLs.
 */
function extractDocumentUrls(payload: unknown, depth = 0): ExtractedUrl[] {
  if (depth > 10) return [];
  const results: ExtractedUrl[] = [];
  const seenUrls = new Set<string>();

  function walk(val: unknown): void {
    if (typeof val === 'string') {
      for (const pattern of DOC_PATTERNS) {
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(val)) !== null) {
          const url = match[0];
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            results.push({
              url,
              type: inferDocumentType(url),
            });
          }
        }
      }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        walk(item);
      }
    } else if (typeof val === 'object' && val !== null) {
      for (const key of Object.keys(val as Record<string, unknown>)) {
        walk((val as Record<string, unknown>)[key]);
      }
    }
  }

  walk(payload);
  return results;
}

/**
 * Infer a document type from the URL path.
 */
function inferDocumentType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('energieausweis') || lower.includes('energy')) return 'energy_certificate';
  if (lower.includes('grundriss') || lower.includes('floorplan')) return 'floorplan';
  if (lower.includes('expose') || lower.includes('expos')) return 'expose';
  if (lower.endsWith('.pdf') || lower.includes('.pdf?')) return 'pdf';
  return 'unknown';
}

/**
 * Generate a stable checksum for a URL to enable idempotent upserts.
 */
function urlChecksum(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.info('Scanning raw_listings for document URLs', { isDryRun, maxRows });

  // Query raw_listings whose payload text contains potential document URL patterns.
  // We cast raw_payload to text and search with SIMILAR TO / LIKE for the initial filter,
  // then do precise extraction in application code.
  const rawRows = await query<RawPayloadRow>(
    `SELECT id, source_listing_key, source_id, raw_payload
     FROM raw_listings
     WHERE raw_payload::text ~* '(\.pdf|expose|dokument|expos[eé]|beilage|grundriss|energieausweis)'
     ORDER BY id DESC
     LIMIT $1`,
    [maxRows],
  );

  log.info(`Found ${rawRows.length} raw listings with potential document URLs`);

  let totalExtracted = 0;
  let totalUpserted = 0;
  let totalSkippedNoListing = 0;
  let totalErrors = 0;

  for (const row of rawRows) {
    try {
      const urls = extractDocumentUrls(row.raw_payload);
      if (urls.length === 0) continue;

      totalExtracted += urls.length;

      // Find the canonical listing for this raw listing's source + key
      const listingRows = await query<ListingLookupRow>(
        `SELECT id FROM listings
         WHERE source_id = $1 AND source_listing_key = $2
         LIMIT 1`,
        [Number(row.source_id), row.source_listing_key],
      );

      if (listingRows.length === 0) {
        totalSkippedNoListing++;
        continue;
      }

      const listingId = Number(listingRows[0]!.id);

      for (const extracted of urls) {
        try {
          if (!isDryRun) {
            await documents.upsertDocument({
              listingId,
              url: extracted.url,
              checksum: urlChecksum(extracted.url),
              documentType: extracted.type,
              status: 'pending',
            });
          }
          totalUpserted++;
        } catch (docErr) {
          totalErrors++;
          if (totalErrors <= 10) {
            log.error(`Error upserting document for listing ${listingId}`, {
              url: extracted.url.slice(0, 100),
              error: docErr instanceof Error ? docErr.message : String(docErr),
            });
          }
        }
      }

      if (totalUpserted % 100 === 0 && totalUpserted > 0) {
        log.info(`Progress: ${totalUpserted} documents upserted`);
      }
    } catch (err) {
      totalErrors++;
      if (totalErrors <= 10) {
        log.error(`Error processing raw listing ${row.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Summary
  console.log('\n=== Document Backfill Summary ===');
  console.log(`Mode:              ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Raw listings scanned: ${rawRows.length}`);
  console.log(`URLs extracted:       ${totalExtracted}`);
  console.log(`Documents upserted:   ${totalUpserted}`);
  console.log(`No canonical listing: ${totalSkippedNoListing}`);
  console.log(`Errors:               ${totalErrors}`);
  console.log('=================================\n');

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

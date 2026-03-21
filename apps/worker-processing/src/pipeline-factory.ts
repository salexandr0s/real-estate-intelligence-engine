/**
 * Creates FullIngestionPipeline with all database dependencies wired up.
 * Extracted from scripts/scrape-and-ingest.ts for reuse in workers.
 */

import { FullIngestionPipeline } from '@rei/ingestion';
import type { FullIngestionPipelineDeps } from '@rei/ingestion';
import type { BaselineLookup, ListingStatus } from '@rei/contracts';
import { computeContentHash } from '@rei/scraper-core';
import { WillhabenMapper } from '@rei/normalization';
import { scoreListing } from '@rei/scoring';
import {
  rawListings,
  scrapeRuns,
  listings,
  listingVersions,
  listingScores,
  marketBaselines,
  userFilters,
  alerts,
} from '@rei/db';

export function buildPipelineDeps(): FullIngestionPipelineDeps {
  return {
    raw: {
      upsertRawSnapshot: async (input) => {
        const row = await rawListings.upsertRawSnapshot(input);
        return { id: row.id, isNew: row.observationCount === 1 };
      },
      updateScrapeRunMetrics: async (runId, metrics) => {
        await scrapeRuns.updateMetrics(runId, metrics);
      },
      computeContentHash,
    },
    normalization: {
      findExistingListing: async (sourceId, sourceListingKey) => {
        const row = await listings.findBySourceKey(sourceId, sourceListingKey);
        if (!row) return null;
        return {
          id: row.id,
          contentFingerprint: row.contentFingerprint,
          listingStatus: row.listingStatus,
          listPriceEurCents: row.listPriceEurCents,
          firstSeenAt: row.firstSeenAt,
          lastPriceChangeAt: row.lastPriceChangeAt,
        };
      },
      upsertListing: async (input) => {
        const existing = await listings.findBySourceKey(input.sourceId, input.sourceListingKey);
        const row = await listings.upsertListing(input);
        return { id: row.id, isNew: !existing };
      },
      appendListingVersion: async (input) => {
        const row = await listingVersions.appendVersion({
          ...input,
          listingStatus: input.listingStatus as ListingStatus,
        });
        return { id: row.id, versionNo: row.versionNo };
      },
      updateScrapeRunNormalizationCounts: async (runId, created, updated) => {
        await scrapeRuns.updateMetrics(runId, {
          normalizedCreated: created,
          normalizedUpdated: updated,
        });
      },
    },
    scoreAndAlert: {
      findBaseline: async (districtNo, operationType, propertyType, areaBucket, roomBucket) => {
        const result = await marketBaselines.findBaselineWithFallback({
          districtNo,
          operationType,
          propertyType,
          areaBucket,
          roomBucket,
        });
        const bl: BaselineLookup = {
          districtBaselinePpsqmEur: result.baseline?.medianPpsqmEur ?? null,
          bucketBaselinePpsqmEur: result.baseline?.medianPpsqmEur ?? null,
          bucketSampleSize: result.baseline?.sampleSize ?? 0,
          fallbackLevel: result.fallbackLevel,
        };
        return bl;
      },
      scoreListing,
      persistScore: async (listingId, listingVersionId, score) => {
        await listingScores.insertScore(listingId, listingVersionId, score);
      },
      updateListingScore: async (listingId, score, scoredAt) => {
        await listings.updateScore(listingId, score, scoredAt);
      },
      findMatchingFilters: async (listing) => {
        const filters = await userFilters.findMatchingFilters(listing);
        return filters.map((f) => ({ filterId: f.id, userId: f.userId }));
      },
      createAlert: async (alert) => {
        const row = await alerts.create(alert);
        return row ? { id: row.id } : null;
      },
      findPreviousPrice: async (listingId) => {
        return listingVersions.findPreviousPrice(listingId);
      },
    },
  };
}

export function createPipeline(): FullIngestionPipeline {
  const normalizers = new Map([['willhaben', new WillhabenMapper()]]);
  const deps = buildPipelineDeps();
  return new FullIngestionPipeline(normalizers, deps);
}

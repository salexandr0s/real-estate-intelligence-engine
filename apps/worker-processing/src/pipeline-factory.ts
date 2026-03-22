/**
 * Creates FullIngestionPipeline with all database dependencies wired up.
 * Extracted from scripts/scrape-and-ingest.ts for reuse in workers.
 */

import { FullIngestionPipeline } from '@rei/ingestion';
import type { FullIngestionPipelineDeps } from '@rei/ingestion';
import type { BaselineLookup, ListingStatus } from '@rei/contracts';
import { computeContentHash } from '@rei/scraper-core';
import {
  BaseSourceMapper,
  WillhabenMapper,
  Immoscout24Mapper,
  WohnnetMapper,
  DerStandardMapper,
  FindMyHomeMapper,
  OpenImmoMapper,
  RemaxMapper,
} from '@rei/normalization';
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
  proximity,
} from '@rei/db';
import {
  rawSnapshotRate,
  normalizationTotal,
  versionCreationRate,
  scoringDuration,
  alertLagSeconds,
} from '@rei/observability';

export function buildPipelineDeps(): FullIngestionPipelineDeps {
  return {
    raw: {
      upsertRawSnapshot: async (input) => {
        const row = await rawListings.upsertRawSnapshot(input);
        const isNew = row.observationCount === 1;
        return { id: row.id, isNew };
      },
      updateScrapeRunMetrics: async (runId, metricsData) => {
        await scrapeRuns.updateMetrics(runId, metricsData);
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
          currentScore: row.currentScore ?? null,
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
        const result = await userFilters.findMatchingFilters(listing);
        return {
          evaluatedIds: result.evaluatedIds,
          matched: result.matched.map((f) => ({ filterId: f.id, userId: f.userId })),
        };
      },
      updateEvaluatedAt: async (filterIds) => {
        await userFilters.updateEvaluatedAt(filterIds);
      },
      updateMatchedAt: async (filterIds) => {
        await userFilters.updateMatchedAt(filterIds);
      },
      createAlert: async (alert) => {
        const row = await alerts.create(alert);
        return row ? { id: row.id } : null;
      },
      findPreviousPrice: async (listingId) => {
        return listingVersions.findPreviousPrice(listingId);
      },
      computeProximity: async (latitude, longitude) => {
        return proximity.computeProximity(latitude, longitude);
      },
      getListingCoordinates: async (listingId) => {
        const row = await listings.findById(listingId);
        if (!row || row.latitude == null || row.longitude == null) return null;
        return { latitude: row.latitude, longitude: row.longitude };
      },
    },
  };
}

/**
 * Creates an instrumented FullIngestionPipeline. After each pipeline invocation,
 * metrics counters are incremented based on the stage results.
 */
export function createPipeline(): FullIngestionPipeline {
  const normalizers = new Map<string, BaseSourceMapper>([
    ['willhaben', new WillhabenMapper()],
    ['immoscout24', new Immoscout24Mapper()],
    ['wohnnet', new WohnnetMapper()],
    ['derstandard', new DerStandardMapper()],
    ['findmyhome', new FindMyHomeMapper()],
    ['openimmo', new OpenImmoMapper()],
    ['remax', new RemaxMapper()],
  ]);
  const deps = buildPipelineDeps();
  const pipeline = new FullIngestionPipeline(normalizers, deps);

  // Wrap ingestDetailCapture to add observability metrics
  const originalIngest = pipeline.ingestDetailCapture.bind(pipeline);
  pipeline.ingestDetailCapture = async (capture, sourceId, scrapeRunId) => {
    const pipelineStart = Date.now();
    const result = await originalIngest(capture, sourceId, scrapeRunId);
    const sourceCode = capture.sourceCode;

    // Raw snapshot metric
    if (result.raw.isNewSnapshot) {
      rawSnapshotRate.inc({ source: sourceCode });
    }

    // Normalization metric
    const normOutcome = result.normalization.isNew
      ? 'created'
      : result.normalization.versionReason
        ? 'updated'
        : 'unchanged';
    normalizationTotal.inc({ source: sourceCode, outcome: normOutcome });

    // Version creation metric
    if (result.normalization.versionReason) {
      versionCreationRate.inc({
        source: sourceCode,
        reason: result.normalization.versionReason,
      });
    }

    // Score duration — currently measures full pipeline time as an upper bound.
    // TODO: expose per-step timing from ScoreAndAlertResult for precise measurement
    if (result.scoring) {
      const durationSec = (Date.now() - pipelineStart) / 1000;
      scoringDuration.observe(durationSec);
    }

    // Alert lag: end-to-end time from pipeline start to alert creation
    if (result.scoring && result.scoring.alertsCreated > 0) {
      const lagSec = (Date.now() - pipelineStart) / 1000;
      const alertType =
        result.normalization.versionReason === 'price_change'
          ? 'price_drop'
          : result.normalization.versionReason === 'first_seen'
            ? 'new_match'
            : 'score_upgrade';
      alertLagSeconds.observe({ alert_type: alertType }, lagSec);
    }

    return result;
  };

  return pipeline;
}

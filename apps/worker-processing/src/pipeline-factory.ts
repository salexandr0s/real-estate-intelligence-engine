/**
 * Creates FullIngestionPipeline with all database dependencies wired up.
 * Extracted from scripts/scrape-and-ingest.ts for reuse in workers.
 */

import { FullIngestionPipeline } from '@immoradar/ingestion';
import type { FullIngestionPipelineDeps } from '@immoradar/ingestion';
import type { BaselineLookup, ListingStatus, GeocodePrecision } from '@immoradar/contracts';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import {
  computeContentHash,
  QUEUE_NAMES,
  getRedisConnection,
  getQueuePrefix,
  DEFAULT_JOB_RETRY_OPTS,
} from '@immoradar/scraper-core';
import type { AlertDeliveryJobData, DocumentProcessingJobData } from '@immoradar/scraper-core';
import {
  BaseSourceMapper,
  WillhabenMapper,
  Immoscout24Mapper,
  WohnnetMapper,
  DerStandardMapper,
  FindMyHomeMapper,
  OpenImmoMapper,
  RemaxMapper,
  EdikteMapper,
} from '@immoradar/normalization';
import { scoreListing } from '@immoradar/scoring';
import {
  rawListings,
  scrapeRuns,
  listings,
  listingVersions,
  listingScores,
  marketBaselines,
  userFilters,
  alerts,
  documents,
  proximity,
  listingPois,
  sources,
  clusters,
} from '@immoradar/db';
import {
  rawSnapshotRate,
  normalizationTotal,
  versionCreationRate,
  scoringDuration,
  alertLagSeconds,
} from '@immoradar/observability';

const HEALTH_STATUS_SCORES: Record<string, number> = {
  healthy: 100,
  degraded: 60,
  blocked: 20,
  disabled: 10,
  unknown: 50,
};

const GEOCODE_PRECISION_SCORES: Record<string, number> = {
  source_exact: 100,
  source_approx: 80,
  street: 70,
  district: 50,
  city: 30,
  none: 10,
};

let _deliveryQueue: Queue<AlertDeliveryJobData> | null = null;
let _documentQueue: Queue<DocumentProcessingJobData> | null = null;

function getDeliveryQueue(): Queue<AlertDeliveryJobData> {
  if (!_deliveryQueue) {
    _deliveryQueue = new Queue<AlertDeliveryJobData>(QUEUE_NAMES.ALERT_DELIVERY, {
      connection: getRedisConnection() as ConnectionOptions,
      prefix: getQueuePrefix(),
    });
  }
  return _deliveryQueue;
}

function getDocumentQueue(): Queue<DocumentProcessingJobData> {
  if (!_documentQueue) {
    _documentQueue = new Queue<DocumentProcessingJobData>(QUEUE_NAMES.DOCUMENT_PROCESSING, {
      connection: getRedisConnection() as ConnectionOptions,
      prefix: getQueuePrefix(),
    });
  }
  return _documentQueue;
}

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
          normalizationVersion: row.normalizationVersion,
          listingStatus: row.listingStatus,
          listPriceEurCents: row.listPriceEurCents,
          firstSeenAt: row.firstSeenAt,
          lastPriceChangeAt: row.lastPriceChangeAt,
          currentScore: row.currentScore ?? null,
          title: row.title,
          description: row.description ?? null,
          operationType: row.operationType,
          propertyType: row.propertyType,
          districtNo: row.districtNo,
          city: row.city,
          livingAreaSqm: row.livingAreaSqm,
          usableAreaSqm: row.usableAreaSqm,
          rooms: row.rooms,
          completenessScore: row.completenessScore,
          canonicalUrl: row.canonicalUrl,
          normalizedPayload: row.normalizedPayload,
          propertySubtype: row.propertySubtype,
          postalCode: row.postalCode,
          contactName: row.contactName,
          contactCompany: row.contactCompany,
          contactEmail: row.contactEmail,
          contactPhone: row.contactPhone,
          hasBalcony: row.hasBalcony,
          hasTerrace: row.hasTerrace,
          hasGarden: row.hasGarden,
          hasElevator: row.hasElevator,
          parkingAvailable: row.parkingAvailable,
          isFurnished: row.isFurnished,
        };
      },
      upsertListing: async (input) => {
        const existing = await listings.findBySourceKey(input.sourceId, input.sourceListingKey);
        const row = await listings.upsertListing(input);
        return { id: row.id, isNew: !existing };
      },
      updateLifecycleStatus: async (input) => {
        const row = await listings.updateLifecycleStatus(input);
        return row ? { id: row.id } : null;
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
          matched: result.matched.map((f) => ({
            filterId: f.id,
            userId: f.userId,
            alertChannels: f.alertChannels,
            filterName: f.name,
            requiredKeywords: f.requiredKeywords,
            excludedKeywords: f.excludedKeywords,
            districts: f.districts,
            minPriceEurCents: f.minPriceEurCents,
            maxPriceEurCents: f.maxPriceEurCents,
            minAreaSqm: f.minAreaSqm,
            maxAreaSqm: f.maxAreaSqm,
            minRooms: f.minRooms,
            maxRooms: f.maxRooms,
            minScore: f.minScore,
          })),
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
      findClusterFingerprint: async (listingId) => {
        const cluster = await clusters.findClusterByListingId(listingId);
        return cluster?.fingerprint ?? null;
      },
      existsAlertForCluster: async (userFilterId, clusterFingerprint, alertType) => {
        return alerts.existsForCluster(userFilterId, clusterFingerprint, alertType);
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
      cacheNearestPois: async (listingId, latitude, longitude) => {
        await listingPois.computeAndCache(listingId, latitude, longitude);
      },
      findLatestBaselineDate: async () => {
        return marketBaselines.findLatestBaselineDate();
      },
      enqueueDelivery: async (alertId, channel, userId) => {
        await getDeliveryQueue().add(
          `deliver:${alertId}`,
          { alertId, channel: channel as string, userId },
          { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
        );
      },
    },
    persistAttachments: async (listingId, attachments) => {
      for (const attachment of attachments) {
        const doc = await documents.upsertDocument({
          listingId,
          url: attachment.url,
          label: attachment.label ?? null,
          mimeType: attachment.type ?? null,
          documentType: attachment.type ?? 'unknown',
        });

        if (doc.status !== 'extracted') {
          await getDocumentQueue().add(
            `doc:${doc.id}`,
            { documentId: doc.id },
            DEFAULT_JOB_RETRY_OPTS,
          );
        }
      }
    },
    getSourceHealthScore: async (sourceId: number) => {
      const source = await sources.findById(sourceId);
      if (!source) return 50;
      return HEALTH_STATUS_SCORES[source.healthStatus] ?? 50;
    },
    getLocationConfidence: async (listingId: number) => {
      const listing = await listings.findById(listingId);
      if (!listing) return 50;
      const precision = listing.geocodePrecision as GeocodePrecision | null;
      if (!precision) return 50;
      return GEOCODE_PRECISION_SCORES[precision] ?? 50;
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
    ['edikte', new EdikteMapper()],
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
    // NOTE: Per-step timing deferred — currently measures full pipeline time as upper bound.
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

/**
 * Creates FullIngestionPipeline with all database dependencies wired up.
 * Extracted from scripts/scrape-and-ingest.ts for reuse in workers.
 */

import { loadConfig } from '@immoradar/config';
import { FullIngestionPipeline } from '@immoradar/ingestion';
import type { FullIngestionPipelineDeps, RescoreDeps } from '@immoradar/ingestion';
import type { ListingStatus, GeocodePrecision } from '@immoradar/contracts';
import type { Queue } from 'bullmq';
import {
  computeContentHash,
  QUEUE_NAMES,
  createQueue,
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

// Keyed by the full union, so a new precision fails to compile until it has a score.
const GEOCODE_PRECISION_SCORES: Record<GeocodePrecision, number> = {
  source_exact: 100,
  source_approx: 80,
  street: 70,
  // The geocoder's centroid of several street or station matches.
  estimated: 60,
  district: 50,
  city: 30,
  none: 10,
};

// A delivery worker runs only when one of these channels is switched on. A job for a channel
// that is off would wait in Redis for good while its alert stays queued, so those channels are
// dropped before matching. A filter left with none falls back to in_app.
function deliverableAlertChannels(channels: readonly string[]): string[] {
  const { pushEnabled, emailEnabled, webhookEnabled } = loadConfig().alerts;
  return channels.filter(
    (channel) =>
      channel === 'in_app' ||
      (channel === 'push' && pushEnabled) ||
      (channel === 'email' && emailEnabled) ||
      (channel === 'webhook' && webhookEnabled),
  );
}

let _deliveryQueue: Queue<AlertDeliveryJobData> | null = null;
let _documentQueue: Queue<DocumentProcessingJobData> | null = null;

function getDeliveryQueue(): Queue<AlertDeliveryJobData> {
  if (!_deliveryQueue) {
    _deliveryQueue = createQueue<AlertDeliveryJobData>(QUEUE_NAMES.ALERT_DELIVERY);
  }
  return _deliveryQueue;
}

function getDocumentQueue(): Queue<DocumentProcessingJobData> {
  if (!_documentQueue) {
    _documentQueue = createQueue<DocumentProcessingJobData>(QUEUE_NAMES.DOCUMENT_PROCESSING);
  }
  return _documentQueue;
}

async function getSourceHealthScore(sourceId: number): Promise<number> {
  const source = await sources.findById(sourceId);
  if (!source) return 50;
  return HEALTH_STATUS_SCORES[source.healthStatus] ?? 50;
}

async function getLocationConfidence(listingId: number): Promise<number> {
  const listing = await listings.findById(listingId);
  if (!listing) return 50;
  const precision = listing.geocodePrecision as GeocodePrecision | null;
  if (!precision) return 50;
  return GEOCODE_PRECISION_SCORES[precision] ?? 50;
}

function buildPipelineDeps(): FullIngestionPipelineDeps {
  return {
    raw: {
      upsertRawSnapshot: async (input) => {
        const row = await rawListings.upsertRawSnapshot(input);
        const isNew = row.observationCount === 1;
        return { id: row.id, isNew };
      },
      updateScrapeRunMetrics: async (runId, delta) => {
        await scrapeRuns.incrementMetrics(runId, delta);
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
          isProject: row.isProject,
          priceFromEurCents: row.priceFromEurCents,
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
        await scrapeRuns.incrementMetrics(runId, {
          normalizedCreated: created,
          normalizedUpdated: updated,
        });
      },
    },
    scoreAndAlert: {
      findBaseline: (districtNo, operationType, propertyType, areaBucket, roomBucket) =>
        marketBaselines.findScoringBaselines({
          districtNo,
          operationType,
          propertyType,
          areaBucket,
          roomBucket,
        }),
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
            alertChannels: deliverableAlertChannels(f.alertChannels),
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
    findUnscoredLatestVersion: (listingId) => listingVersions.findUnscoredLatest(listingId),
    persistAttachments: async (listingId, attachments) => {
      // The document worker only runs with documents switched on, and nothing else reads
      // its queue. Until then the rows stay pending, and a later capture enqueues them.
      const documentsEnabled = loadConfig().features.documentsEnabled;
      for (const attachment of attachments) {
        const doc = await documents.upsertDocument({
          listingId,
          url: attachment.url,
          label: attachment.label ?? null,
          mimeType: attachment.type ?? null,
          documentType: attachment.type ?? 'unknown',
        });

        // A downloaded or extracted document keeps its status and needs no new job.
        if (documentsEnabled && doc.status === 'pending') {
          await getDocumentQueue().add(
            `doc:${doc.id}`,
            { documentId: doc.id },
            DEFAULT_JOB_RETRY_OPTS,
          );
        }
      }
    },
    getSourceHealthScore,
    getLocationConfidence,
  };
}

/**
 * Rescoring reads and writes through ingestion's deps, so a rescored listing gets the score
 * ingestion would give it now. It leaves the nearest-POI cache alone, which baselines don't change.
 */
export function buildRescoreDeps(): RescoreDeps {
  const scoring = buildPipelineDeps().scoreAndAlert;
  return {
    findBaseline: scoring.findBaseline,
    scoreListing: scoring.scoreListing,
    findPreviousPrice: scoring.findPreviousPrice,
    computeProximity: scoring.computeProximity,
    getListingCoordinates: scoring.getListingCoordinates,
    findLatestBaselineDate: scoring.findLatestBaselineDate,
    persistScore: scoring.persistScore,
    updateListingScore: scoring.updateListingScore,
    getSourceHealthScore,
    getLocationConfidence,
    findActiveListings: listings.findActiveForRescore,
    findLatestVersion: async (listingId) => {
      const [latest] = await listingVersions.findByListingId(listingId, 1);
      return latest ? { id: latest.id, versionReason: latest.versionReason } : null;
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

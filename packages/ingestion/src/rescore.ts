import type { ScoreResult, VersionReason } from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';
import { computeListingScore } from './score-and-alert.js';
import type { ListingScoringDeps, ScoredListing } from './score-and-alert.js';

const log = createLogger('ingestion:rescore');

/** Most listings one call reads and scores, which bounds its memory and how long it runs. */
export const RESCORE_BATCH_SIZE = 1000;

/** A smaller change is rounding noise, so the stored score stays and nothing is written. */
const MIN_SCORE_CHANGE = 0.5;

export interface RescoreListing extends ScoredListing {
  id: number;
  sourceId: number;
  currentScore: number | null;
}

export interface RescoreDeps extends ListingScoringDeps {
  /** Active listings with an id above `afterListingId`, in id order. */
  findActiveListings: (page: {
    sourceId: number | null;
    afterListingId: number;
    limit: number;
  }) => Promise<RescoreListing[]>;
  /** The listing's newest version, which the new score row belongs to. */
  findLatestVersion: (
    listingId: number,
  ) => Promise<{ id: number; versionReason: VersionReason } | null>;
  getSourceHealthScore: (sourceId: number) => Promise<number>;
  getLocationConfidence: (listingId: number) => Promise<number>;
  persistScore: (listingId: number, listingVersionId: number, score: ScoreResult) => Promise<void>;
  updateListingScore: (listingId: number, score: number, scoredAt: Date) => Promise<void>;
}

export interface RescoreOptions {
  /** Only this source's listings. Null or absent takes every source. */
  sourceId?: number | null;
  /** Starts after this listing id. Pass the previous call's `lastListingId` to continue. */
  afterListingId?: number;
  /** At most RESCORE_BATCH_SIZE, which is also the default. */
  limit?: number;
  /** Scores without writing anything. */
  dryRun?: boolean;
}

export interface RescoreBatchResult {
  examined: number;
  rescored: number;
  unchanged: number;
  failed: number;
  /** Id of the last listing this call read, or null when it read none. */
  lastListingId: number | null;
}

/**
 * Scores up to RESCORE_BATCH_SIZE active listings again, the way ingestion scores them, so a
 * score changes only because the baselines or the formula did. It creates no alerts. A failed
 * listing is logged and counted, and the batch goes on.
 */
export async function rescoreActiveListings(
  deps: RescoreDeps,
  options: RescoreOptions = {},
): Promise<RescoreBatchResult> {
  const result: RescoreBatchResult = {
    examined: 0,
    rescored: 0,
    unchanged: 0,
    failed: 0,
    lastListingId: null,
  };
  const limit = Math.min(options.limit ?? RESCORE_BATCH_SIZE, RESCORE_BATCH_SIZE);
  if (limit <= 0) return result;

  const batch = await deps.findActiveListings({
    sourceId: options.sourceId ?? null,
    afterListingId: options.afterListingId ?? 0,
    limit,
  });

  for (const listing of batch) {
    result.examined++;
    result.lastListingId = listing.id;
    try {
      const [version, sourceHealthScore, locationConfidence] = await Promise.all([
        deps.findLatestVersion(listing.id),
        deps.getSourceHealthScore(listing.sourceId),
        deps.getLocationConfidence(listing.id),
      ]);
      const { score } = await computeListingScore(deps, {
        listingId: listing.id,
        listingVersionId: version?.id ?? 0,
        versionReason: version?.versionReason ?? null,
        listing,
        sourceHealthScore,
        locationConfidence,
      });

      if (
        listing.currentScore != null &&
        Math.abs(score.overallScore - listing.currentScore) < MIN_SCORE_CHANGE
      ) {
        result.unchanged++;
        continue;
      }

      if (!options.dryRun) {
        // A score row needs a version to belong to.
        if (version) await deps.persistScore(listing.id, version.id, score);
        await deps.updateListingScore(listing.id, score.overallScore, new Date());
      }
      result.rescored++;
      log.debug('Rescored listing', {
        listingId: listing.id,
        oldScore: listing.currentScore,
        newScore: score.overallScore,
      });
    } catch (err) {
      result.failed++;
      log.error('Failed to rescore listing', {
        listingId: listing.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

export type RescoreTotals = Omit<RescoreBatchResult, 'lastListingId'>;

export interface RescoreAllOptions {
  /** Only this source's listings. Null or absent takes every source. */
  sourceId?: number | null;
  /** Stops after examining this many listings. Absent means every active listing. */
  maxListings?: number;
  /** Scores without writing anything. */
  dryRun?: boolean;
  /** Called after each batch with the running totals. */
  onBatch?: (totals: RescoreTotals) => void;
}

/**
 * Runs rescoreActiveListings page after page until it has examined `maxListings` or no active
 * listing is left. The rescore worker and scripts/rescore-listings.ts both page through it.
 */
export async function rescoreListingsInBatches(
  deps: RescoreDeps,
  options: RescoreAllOptions = {},
): Promise<RescoreTotals> {
  const maxListings = options.maxListings ?? Number.POSITIVE_INFINITY;
  const totals: RescoreTotals = { examined: 0, rescored: 0, unchanged: 0, failed: 0 };
  let afterListingId = 0;

  while (totals.examined < maxListings) {
    const requested = Math.min(RESCORE_BATCH_SIZE, maxListings - totals.examined);
    const batch = await rescoreActiveListings(deps, {
      sourceId: options.sourceId ?? null,
      afterListingId,
      limit: requested,
      dryRun: options.dryRun ?? false,
    });
    totals.examined += batch.examined;
    totals.rescored += batch.rescored;
    totals.unchanged += batch.unchanged;
    totals.failed += batch.failed;
    options.onBatch?.({ ...totals });
    // A short batch means no active listing is left after it.
    if (batch.lastListingId === null || batch.examined < requested) break;
    afterListingId = batch.lastListingId;
  }

  return totals;
}

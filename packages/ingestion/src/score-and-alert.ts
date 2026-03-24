import type {
  AlertChannel,
  AlertCreate,
  AlertMatchReasons,
  AlertType,
  BaselineLookup,
  ProximityInput,
  ScoreInput,
  ScoreResult,
  VersionReason,
} from '@immoradar/contracts';
import { buildAlertDedupeKey, getAreaBucket, getRoomBucket } from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';

const log = createLogger('ingestion:score-alert');

/**
 * Handles scoring and alert matching after a listing is normalized:
 * 1. Look up market baselines
 * 2. Score the listing
 * 3. Persist score
 * 4. Find matching filters (reverse match)
 * 5. Create deduplicated alerts
 */

export interface ScoreAndAlertResult {
  scored: boolean;
  overallScore: number | null;
  alertsCreated: number;
}

export interface ScoreAndAlertDeps {
  findBaseline: (
    districtNo: number | null,
    operationType: string,
    propertyType: string,
    areaBucket: string,
    roomBucket: string,
  ) => Promise<BaselineLookup>;

  scoreListing: (input: ScoreInput, baseline: BaselineLookup) => ScoreResult;

  persistScore: (listingId: number, listingVersionId: number, score: ScoreResult) => Promise<void>;

  updateListingScore: (listingId: number, score: number, scoredAt: Date) => Promise<void>;

  findMatchingFilters: (listing: {
    operationType: string;
    propertyType: string;
    districtNo: number | null;
    listPriceEurCents: number | null;
    livingAreaSqm: number | null;
    rooms: number | null;
    currentScore: number | null;
    title: string | null;
    description: string | null;
  }) => Promise<{
    evaluatedIds: number[];
    matched: Array<{
      filterId: number;
      userId: number;
      alertChannels: string[];
      filterName?: string;
      requiredKeywords?: string[];
      excludedKeywords?: string[];
      districts?: number[];
      minPriceEurCents?: number | null;
      maxPriceEurCents?: number | null;
      minAreaSqm?: number | null;
      maxAreaSqm?: number | null;
      minRooms?: number | null;
      maxRooms?: number | null;
      minScore?: number | null;
    }>;
  }>;

  updateEvaluatedAt: (filterIds: number[]) => Promise<void>;
  updateMatchedAt: (filterIds: number[]) => Promise<void>;

  createAlert: (alert: AlertCreate) => Promise<{ id: number } | null>;

  /** Find cluster fingerprint for a listing. Returns null if listing is not in any cluster. */
  findClusterFingerprint?: (listingId: number) => Promise<string | null>;

  /** Check if a cluster-aware alert already exists for a filter + cluster + type. */
  existsAlertForCluster?: (
    userFilterId: number,
    clusterFingerprint: string,
    alertType: AlertType,
  ) => Promise<boolean>;

  findPreviousPrice: (listingId: number) => Promise<number | null>;

  computeProximity: (latitude: number, longitude: number) => Promise<ProximityInput>;

  getListingCoordinates: (
    listingId: number,
  ) => Promise<{ latitude: number; longitude: number } | null>;

  cacheNearestPois?: (listingId: number, latitude: number, longitude: number) => Promise<void>;

  /** Returns the most recent baseline computation date. Used for staleness detection. */
  findLatestBaselineDate?: () => Promise<Date | null>;

  /** Enqueue a non-in_app alert for async delivery (push, email, webhook). */
  enqueueDelivery?: (alertId: number, channel: AlertChannel, userId: number) => Promise<void>;
}

export class ScoreAndAlert {
  constructor(private readonly deps: ScoreAndAlertDeps) {}

  async process(params: {
    listingId: number;
    listingVersionId: number;
    versionReason: VersionReason;
    listing: {
      title: string;
      description: string | null;
      operationType: string;
      propertyType: string;
      districtNo: number | null;
      city: string;
      listPriceEurCents: number | null;
      livingAreaSqm: number | null;
      usableAreaSqm: number | null;
      rooms: number | null;
      completenessScore: number;
      firstSeenAt: Date;
      lastPriceChangeAt: Date | null;
      canonicalUrl: string;
      currentScore: number | null;
    };
    sourceHealthScore: number;
    locationConfidence: number;
  }): Promise<ScoreAndAlertResult> {
    const { listingId, listingVersionId, versionReason, listing } = params;

    const effectiveArea = listing.livingAreaSqm ?? listing.usableAreaSqm ?? null;
    const pricePerSqmEur =
      listing.listPriceEurCents != null && effectiveArea != null && effectiveArea > 0
        ? Math.round((listing.listPriceEurCents / 100 / effectiveArea) * 100) / 100
        : null;

    // 1. Look up baselines
    const areaBucket = getAreaBucket(effectiveArea);
    const roomBucket = getRoomBucket(listing.rooms);

    const baseline = await this.deps.findBaseline(
      listing.districtNo,
      listing.operationType,
      listing.propertyType,
      areaBucket,
      roomBucket,
    );

    // 1b. Check baseline staleness — if baselines are outdated, reduce confidence
    const BASELINE_STALE_HOURS = 4;
    let baselineStale = false;
    let baselineFreshnessHours: number | undefined;
    if (this.deps.findLatestBaselineDate) {
      const latestDate = await this.deps.findLatestBaselineDate();
      if (latestDate) {
        const ageHours = (Date.now() - latestDate.getTime()) / 3_600_000;
        baselineFreshnessHours = Math.round(ageHours * 100) / 100;
        if (ageHours > BASELINE_STALE_HOURS) {
          baselineStale = true;
          log.warn('Market baselines are stale', {
            latestBaselineDate: latestDate.toISOString(),
            ageHours: Math.round(ageHours),
          });
        }
      }
    }

    // 2. Compute price history signals
    let recentPriceDropPct = 0;
    const previousPrice = await this.deps.findPreviousPrice(listingId);
    if (previousPrice != null && listing.listPriceEurCents != null && previousPrice > 0) {
      const priceDiff = previousPrice - listing.listPriceEurCents;
      if (priceDiff > 0) {
        recentPriceDropPct = priceDiff / previousPrice;
      }
    }

    const relistDetected = versionReason === 'relist_detected';

    // 2b. Compute proximity data for location score
    let proximityData: ProximityInput | null = null;
    const coords = await this.deps.getListingCoordinates(listingId);
    if (coords) {
      try {
        proximityData = await this.deps.computeProximity(coords.latitude, coords.longitude);
        // NOTE: Known perf opportunity — computeProximity and cacheNearestPois both
        // call findNearby internally. Could share the result to avoid duplicate Haversine query.
        await this.deps.cacheNearestPois?.(listingId, coords.latitude, coords.longitude);
      } catch (err) {
        log.warn('Proximity computation failed, using default', {
          listingId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Score
    const scoreInput: ScoreInput = {
      listingId,
      listingVersionId,
      pricePerSqmEur,
      districtNo: listing.districtNo,
      operationType: listing.operationType,
      propertyType: listing.propertyType,
      livingAreaSqm: listing.livingAreaSqm,
      rooms: listing.rooms,
      city: listing.city,
      title: listing.title,
      description: listing.description,
      firstSeenAt: listing.firstSeenAt,
      lastPriceChangeAt: listing.lastPriceChangeAt,
      completenessScore: listing.completenessScore,
      sourceHealthScore: baselineStale
        ? Math.round(params.sourceHealthScore * 0.7) // Penalize confidence when baselines are stale
        : params.sourceHealthScore,
      locationConfidence: params.locationConfidence,
      recentPriceDropPct,
      relistDetected,
      proximityData,
    };

    const score = this.deps.scoreListing(scoreInput, baseline);

    // 3a. Attach baseline provenance to score for persistence
    score.baselineFallbackLevel = baseline.fallbackLevel;
    score.baselineSampleSize = baseline.bucketSampleSize;
    score.baselineFreshnessHours = baselineFreshnessHours;

    // 3. Persist score
    await this.deps.persistScore(listingId, listingVersionId, score);

    const scoredAt = new Date();
    await this.deps.updateListingScore(listingId, score.overallScore, scoredAt);

    log.info('Listing scored', {
      listingId,
      overallScore: score.overallScore,
      districtPriceScore: score.districtPriceScore,
    });

    // 4. Find matching filters
    const matchingFilters = await this.deps.findMatchingFilters({
      operationType: listing.operationType,
      propertyType: listing.propertyType,
      districtNo: listing.districtNo,
      listPriceEurCents: listing.listPriceEurCents,
      livingAreaSqm: listing.livingAreaSqm,
      rooms: listing.rooms,
      currentScore: score.overallScore,
      title: listing.title,
      description: listing.description,
    });

    // 4b. Update reverse-match metadata timestamps
    const { evaluatedIds, matched } = matchingFilters;
    await this.deps.updateEvaluatedAt(evaluatedIds);
    if (matched.length > 0) {
      await this.deps.updateMatchedAt(matched.map((m) => m.filterId));
    }

    // 5. Create alerts
    let alertsCreated = 0;
    const scoreImproved = listing.currentScore != null && score.overallScore > listing.currentScore;
    const priceDecreased =
      previousPrice != null &&
      listing.listPriceEurCents != null &&
      listing.listPriceEurCents < previousPrice;
    const alertType = this.determineAlertType(versionReason, scoreImproved, priceDecreased);

    // 5a. Cluster-aware dedup: look up cluster fingerprint once for this listing
    let clusterFingerprint: string | null = null;
    if (this.deps.findClusterFingerprint) {
      try {
        clusterFingerprint = await this.deps.findClusterFingerprint(listingId);
      } catch (err) {
        log.warn('Cluster fingerprint lookup failed', {
          listingId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const match of matched) {
      // 5b. Cluster-aware dedup: if another listing in the same cluster already
      // triggered an alert for this filter, suppress the duplicate
      if (clusterFingerprint && this.deps.existsAlertForCluster) {
        try {
          const exists = await this.deps.existsAlertForCluster(
            match.filterId,
            clusterFingerprint,
            alertType,
          );
          if (exists) {
            log.info('Suppressed cluster-duplicate alert', {
              filterId: match.filterId,
              listingId,
              clusterFingerprint,
              alertType,
            });
            continue;
          }
        } catch (err) {
          log.warn('Cluster dedup check failed, proceeding with alert', {
            filterId: match.filterId,
            listingId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 5c. Build structured match reasons
      const matchReasons = this.buildMatchReasons(match, listing, score.overallScore);

      const channels: string[] = match.alertChannels.length > 0 ? match.alertChannels : ['in_app'];
      const dedupeKey = buildAlertDedupeKey({
        filterId: match.filterId,
        listingId,
        alertType,
        scoreVersion: score.scoreVersion,
      });
      const title = this.buildAlertTitle(alertType, listing.title);
      const body = this.buildAlertBody(alertType, listing);

      for (const channel of channels) {
        const alertInput: AlertCreate = {
          userId: match.userId,
          userFilterId: match.filterId,
          listingId,
          listingVersionId,
          alertType,
          channel: channel as AlertChannel,
          dedupeKey,
          title,
          body,
          matchReasons,
          clusterFingerprint,
        };

        let alertResult: { id: number } | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            alertResult = await this.deps.createAlert(alertInput);
            break;
          } catch (err) {
            if (attempt === 3) {
              log.error('Alert creation failed after 3 attempts', {
                filterId: match.filterId,
                listingId,
                alertType,
                channel,
                error: err instanceof Error ? err.message : String(err),
              });
            } else {
              log.warn(`Alert creation attempt ${attempt} failed, retrying`, {
                filterId: match.filterId,
                listingId,
                channel,
              });
              await new Promise((resolve) => setTimeout(resolve, attempt * 500));
            }
          }
        }
        if (alertResult) {
          alertsCreated++;
          log.info('Alert created', {
            filterId: match.filterId,
            listingId,
            alertType,
            channel,
            dedupeKey,
          });

          // Enqueue async delivery for non-in_app channels
          if (channel !== 'in_app' && this.deps.enqueueDelivery) {
            try {
              await this.deps.enqueueDelivery(
                alertResult.id,
                channel as AlertChannel,
                match.userId,
              );
            } catch (err) {
              log.error('Failed to enqueue alert delivery', {
                alertId: alertResult.id,
                channel,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }
    }

    if (alertsCreated > 0) {
      log.info('Alerts created', { listingId, alertsCreated, alertType });
    }

    return {
      scored: true,
      overallScore: score.overallScore,
      alertsCreated,
    };
  }

  private determineAlertType(
    versionReason: VersionReason,
    scoreImproved: boolean,
    priceDecreased: boolean,
  ): AlertType {
    switch (versionReason) {
      case 'first_seen':
        return 'new_match';
      case 'price_change':
        return priceDecreased ? 'price_drop' : 'price_change';
      case 'content_change':
        return scoreImproved ? 'score_upgrade' : 'status_change';
      case 'status_change':
        return 'status_change';
      default:
        return 'new_match';
    }
  }

  private buildAlertTitle(alertType: string, listingTitle: string): string {
    const prefix: Record<string, string> = {
      new_match: 'Neues Inserat',
      price_drop: 'Preissenkung',
      price_change: 'Preisänderung',
      score_upgrade: 'Score-Upgrade',
      status_change: 'Statusänderung',
    };
    return `${prefix[alertType] ?? 'Alert'}: ${listingTitle}`;
  }

  private buildMatchReasons(
    match: {
      filterName?: string;
      requiredKeywords?: string[];
      excludedKeywords?: string[];
      districts?: number[];
      minPriceEurCents?: number | null;
      maxPriceEurCents?: number | null;
      minAreaSqm?: number | null;
      maxAreaSqm?: number | null;
      minRooms?: number | null;
      maxRooms?: number | null;
      minScore?: number | null;
    },
    listing: {
      districtNo: number | null;
      listPriceEurCents: number | null;
      livingAreaSqm: number | null;
      rooms: number | null;
    },
    currentScore: number,
  ): AlertMatchReasons {
    const reasons: AlertMatchReasons = {};

    if (match.filterName) {
      reasons.filterName = match.filterName;
    }

    // Keywords
    if (match.requiredKeywords && match.requiredKeywords.length > 0) {
      reasons.matchedKeywords = [...match.requiredKeywords];
    }
    if (match.excludedKeywords && match.excludedKeywords.length > 0) {
      reasons.excludedKeywordsClean = true;
    }

    // District
    if (match.districts && match.districts.length > 0 && listing.districtNo != null) {
      reasons.districtMatch = match.districts.includes(listing.districtNo);
    }

    // Thresholds
    const thresholdsMet: AlertMatchReasons['thresholdsMet'] = {};
    let hasThreshold = false;

    if (match.minPriceEurCents != null || match.maxPriceEurCents != null) {
      thresholdsMet.price = true;
      hasThreshold = true;
    }
    if (match.minAreaSqm != null || match.maxAreaSqm != null) {
      thresholdsMet.area = true;
      hasThreshold = true;
    }
    if (match.minRooms != null || match.maxRooms != null) {
      thresholdsMet.rooms = true;
      hasThreshold = true;
    }
    if (match.minScore != null && currentScore >= match.minScore) {
      thresholdsMet.score = true;
      hasThreshold = true;
    }

    if (hasThreshold) {
      reasons.thresholdsMet = thresholdsMet;
    }

    return reasons;
  }

  private buildAlertBody(
    alertType: string,
    listing: { listPriceEurCents: number | null; livingAreaSqm: number | null; city: string },
  ): string {
    const price = listing.listPriceEurCents
      ? `€${Math.round(listing.listPriceEurCents / 100).toLocaleString('de-AT')}`
      : 'Preis auf Anfrage';
    const area = listing.livingAreaSqm ? `${listing.livingAreaSqm} m²` : '';
    return `${price}${area ? ` · ${area}` : ''} · ${listing.city}`;
  }
}

import type {
  AlertCreate,
  BaselineLookup,
  ScoreInput,
  ScoreResult,
  VersionReason,
} from '@rei/contracts';
import { buildAlertDedupeKey } from '@rei/contracts';
import { createLogger } from '@rei/observability';

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

  persistScore: (
    listingId: number,
    listingVersionId: number,
    score: ScoreResult,
  ) => Promise<void>;

  updateListingScore: (
    listingId: number,
    score: number,
    scoredAt: Date,
  ) => Promise<void>;

  findMatchingFilters: (listing: {
    operationType: string;
    propertyType: string;
    districtNo: number | null;
    listPriceEurCents: number | null;
    livingAreaSqm: number | null;
    rooms: number | null;
    currentScore: number | null;
  }) => Promise<Array<{ filterId: number; userId: number }>>;

  createAlert: (alert: AlertCreate) => Promise<{ id: number } | null>;

  findPreviousPrice: (listingId: number) => Promise<number | null>;
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
    const { getAreaBucket, getRoomBucket } = await import('@rei/contracts');
    const areaBucket = getAreaBucket(effectiveArea);
    const roomBucket = getRoomBucket(listing.rooms);

    const baseline = await this.deps.findBaseline(
      listing.districtNo,
      listing.operationType,
      listing.propertyType,
      areaBucket,
      roomBucket,
    );

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
      sourceHealthScore: params.sourceHealthScore,
      locationConfidence: params.locationConfidence,
      recentPriceDropPct,
      relistDetected,
    };

    const score = this.deps.scoreListing(scoreInput, baseline);

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
    });

    // 5. Create alerts
    let alertsCreated = 0;
    const alertType = this.determineAlertType(versionReason);

    for (const match of matchingFilters) {
      const dedupeKey = buildAlertDedupeKey({
        filterId: match.filterId,
        listingId,
        alertType,
        scoreVersion: score.scoreVersion,
      });

      const alertInput: AlertCreate = {
        userId: match.userId,
        userFilterId: match.filterId,
        listingId,
        listingVersionId,
        alertType,
        channel: 'in_app',
        dedupeKey,
        title: this.buildAlertTitle(alertType, listing.title),
        body: this.buildAlertBody(alertType, listing),
      };

      const created = await this.deps.createAlert(alertInput);
      if (created) {
        alertsCreated++;
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
  ): 'new_match' | 'price_drop' | 'score_upgrade' | 'status_change' {
    switch (versionReason) {
      case 'first_seen':
        return 'new_match';
      case 'price_change':
        return 'price_drop';
      case 'status_change':
        return 'status_change';
      default:
        return 'new_match';
    }
  }

  private buildAlertTitle(alertType: string, listingTitle: string): string {
    const prefix: Record<string, string> = {
      new_match: 'Neues Inserat',
      price_drop: 'Preisänderung',
      score_upgrade: 'Score-Upgrade',
      status_change: 'Statusänderung',
    };
    return `${prefix[alertType] ?? 'Alert'}: ${listingTitle}`;
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

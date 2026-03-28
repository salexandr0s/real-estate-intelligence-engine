import type {
  CanonicalListingInput,
  ListingStatus,
  NormalizationContext,
  NormalizationResult,
  OperationType,
  PropertyType,
  SourceNormalizer,
  SourceRawListingBase,
  VersionReason,
} from '@immoradar/contracts';
import { CURRENT_NORMALIZATION_VERSION } from '@immoradar/contracts';
import { computeContentFingerprint } from '@immoradar/normalization';
import { createLogger } from '@immoradar/observability';

const log = createLogger('ingestion:normalize');

/**
 * Handles the normalization and listing upsert stage:
 * 1. Load raw snapshot payload
 * 2. Run source-specific normalizer
 * 3. Detect changes vs existing listing
 * 4. Upsert canonical listing
 * 5. Append listing version if meaningful change
 * 6. Update scrape run metrics
 */

export interface NormalizeAndUpsertListingData {
  title: string;
  description: string | null;
  operationType: OperationType;
  propertyType: PropertyType;
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
}

export interface NormalizeAndUpsertResult {
  listingId: number;
  listingVersionId: number | null;
  isNew: boolean;
  versionReason: VersionReason | null;
  warnings: string[];
  listing: NormalizeAndUpsertListingData | null;
}

export interface NormalizationDeps {
  findExistingListing: (
    sourceId: number,
    sourceListingKey: string,
  ) => Promise<{
    id: number;
    contentFingerprint: string;
    normalizationVersion: number;
    listingStatus: string;
    listPriceEurCents: number | null;
    firstSeenAt: Date;
    lastPriceChangeAt: Date | null;
    currentScore: number | null;
    title: string;
    description: string | null;
    operationType: OperationType;
    propertyType: PropertyType;
    districtNo: number | null;
    city: string;
    livingAreaSqm: number | null;
    usableAreaSqm: number | null;
    rooms: number | null;
    completenessScore: number;
    canonicalUrl: string;
    normalizedPayload: Record<string, unknown>;
    propertySubtype: CanonicalListingInput['propertySubtype'];
    postalCode: string | null;
    contactName: string | null;
    contactCompany: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    hasBalcony: boolean | null;
    hasTerrace: boolean | null;
    hasGarden: boolean | null;
    hasElevator: boolean | null;
    parkingAvailable: boolean | null;
    isFurnished: boolean | null;
  } | null>;

  upsertListing: (input: CanonicalListingInput) => Promise<{ id: number; isNew: boolean }>;

  updateLifecycleStatus: (input: {
    id: number;
    currentRawListingId: number;
    latestScrapeRunId: number;
    listingStatus: ListingStatus;
    sourceStatusRaw?: string | null;
    contentFingerprint?: string | null;
  }) => Promise<{ id: number } | null>;

  appendListingVersion: (input: {
    listingId: number;
    rawListingId: number;
    versionReason: VersionReason;
    contentFingerprint: string;
    listingStatus: string;
    listPriceEurCents: number | null;
    livingAreaSqm: number | null;
    pricePerSqmEur: number | null;
    normalizedSnapshot: Record<string, unknown>;
  }) => Promise<{ id: number; versionNo: number }>;

  updateScrapeRunNormalizationCounts: (
    runId: number,
    created: number,
    updated: number,
  ) => Promise<void>;
}

export class NormalizeAndUpsert {
  constructor(
    private readonly normalizers: Map<string, SourceNormalizer>,
    private readonly deps: NormalizationDeps,
  ) {}

  async process(
    sourceCode: string,
    rawPayload: SourceRawListingBase,
    context: NormalizationContext,
    scrapeRunId: number,
  ): Promise<NormalizeAndUpsertResult> {
    const normalizer = this.normalizers.get(sourceCode);
    if (!normalizer) {
      throw new Error(`No normalizer registered for source: ${sourceCode}`);
    }

    // 1. Normalize
    const result: NormalizationResult = normalizer.normalize(rawPayload, context);

    const existingLookupSourceId = result.listing?.sourceId ?? context.sourceId;
    const existingLookupSourceKey = result.listing?.sourceListingKey ?? context.sourceListingKey;
    const existing = await this.deps.findExistingListing(
      existingLookupSourceId,
      existingLookupSourceKey,
    );

    if (!result.success || !result.listing) {
      const lifecycleStatus = resolveLifecycleStatus(context.availabilityStatus);
      if (existing && lifecycleStatus) {
        return this.applyLifecycleStatusOnlyUpdate(existing, lifecycleStatus, context, scrapeRunId);
      }

      log.warn('Normalization failed', {
        sourceCode,
        sourceListingKey: context.sourceListingKey,
        errors: result.errors,
      });
      return {
        listingId: 0,
        listingVersionId: null,
        isNew: false,
        versionReason: null,
        warnings: result.errors,
        listing: null,
      };
    }

    const listing = result.listing;
    const explicitLifecycleStatus = resolveLifecycleStatus(context.availabilityStatus);
    if (explicitLifecycleStatus) {
      listing.listingStatus = explicitLifecycleStatus;
      listing.sourceStatusRaw = context.availabilityStatus ?? explicitLifecycleStatus;
      listing.contentFingerprint = computeContentFingerprint(listing);
    }

    // 3. Detect version reason
    const INACTIVE_STATUSES = ['inactive', 'withdrawn', 'expired'] as const;
    let versionReason: VersionReason | null = null;
    if (!existing) {
      versionReason = 'first_seen';
    } else if (
      (INACTIVE_STATUSES as readonly string[]).includes(existing.listingStatus) &&
      listing.listingStatus === 'active'
    ) {
      // Listing was previously inactive/withdrawn/expired and is now active again
      versionReason = 'relist_detected';
    } else if (existing.contentFingerprint !== listing.contentFingerprint) {
      // Fingerprint changed — determine why
      const isNormalizationUpgrade = existing.normalizationVersion < CURRENT_NORMALIZATION_VERSION;

      if (isNormalizationUpgrade) {
        // Fingerprint changed because our normalization logic improved, not because
        // the source content changed. Update the listing but skip version creation
        // to avoid spurious alerts.
        log.info('Normalization upgrade detected, skipping version', {
          sourceCode,
          oldVersion: existing.normalizationVersion,
          newVersion: CURRENT_NORMALIZATION_VERSION,
        });
        // versionReason stays null — listing will be upserted but no version/alert created
      } else if (existing.listPriceEurCents !== listing.listPriceEurCents) {
        versionReason = 'price_change';
      } else if (existing.listingStatus !== listing.listingStatus) {
        versionReason = 'status_change';
      } else {
        versionReason = 'content_change';
      }
    }

    // 4. Upsert listing
    const { id: listingId, isNew } = await this.deps.upsertListing(listing);

    // 5. Append version if meaningful change
    let listingVersionId: number | null = null;
    if (versionReason) {
      const pricePerSqmEur = this.computePricePerSqm(
        listing.listPriceEurCents ?? null,
        listing.livingAreaSqm ?? listing.usableAreaSqm ?? null,
      );

      const versionResult = await this.deps.appendListingVersion({
        listingId,
        rawListingId: context.rawListingId,
        versionReason,
        contentFingerprint: listing.contentFingerprint,
        listingStatus: listing.listingStatus,
        listPriceEurCents: listing.listPriceEurCents ?? null,
        livingAreaSqm: listing.livingAreaSqm ?? null,
        pricePerSqmEur,
        normalizedSnapshot: listing.normalizedPayload,
      });

      listingVersionId = versionResult.id;

      log.info('Listing version created', {
        listingId,
        versionNo: versionResult.versionNo,
        versionReason,
        sourceCode,
      });
    }

    // 6. Update scrape run metrics
    await this.deps.updateScrapeRunNormalizationCounts(
      scrapeRunId,
      isNew ? 1 : 0,
      !isNew && versionReason ? 1 : 0,
    );

    return {
      listingId,
      listingVersionId,
      isNew,
      versionReason,
      warnings: result.warnings.map((w) => `${w.field}: ${w.code}`),
      listing: {
        title: listing.title,
        description: listing.description ?? null,
        operationType: listing.operationType,
        propertyType: listing.propertyType,
        districtNo: listing.districtNo ?? null,
        city: listing.city,
        listPriceEurCents: listing.listPriceEurCents ?? null,
        livingAreaSqm: listing.livingAreaSqm ?? null,
        usableAreaSqm: listing.usableAreaSqm ?? null,
        rooms: listing.rooms ?? null,
        completenessScore: listing.completenessScore,
        firstSeenAt: existing?.firstSeenAt ?? new Date(),
        lastPriceChangeAt: existing?.lastPriceChangeAt ?? null,
        canonicalUrl: listing.canonicalUrl ?? context.canonicalUrl,
        currentScore: existing?.currentScore ?? null,
      },
    };
  }

  private computePricePerSqm(priceCents: number | null, areaSqm: number | null): number | null {
    if (priceCents == null || areaSqm == null || areaSqm <= 0) return null;
    return Math.round((priceCents / 100 / areaSqm) * 100) / 100;
  }

  private async applyLifecycleStatusOnlyUpdate(
    existing: NonNullable<Awaited<ReturnType<NormalizationDeps['findExistingListing']>>>,
    lifecycleStatus: ListingStatus,
    context: NormalizationContext,
    scrapeRunId: number,
  ): Promise<NormalizeAndUpsertResult> {
    const nextFingerprint = computeContentFingerprint({
      title: existing.title,
      description: existing.description ?? null,
      listPriceEurCents: existing.listPriceEurCents ?? null,
      livingAreaSqm: existing.livingAreaSqm ?? null,
      usableAreaSqm: existing.usableAreaSqm ?? null,
      rooms: existing.rooms ?? null,
      propertyType: existing.propertyType,
      propertySubtype: existing.propertySubtype ?? null,
      districtNo: existing.districtNo ?? null,
      postalCode: existing.postalCode ?? null,
      city: existing.city,
      contactName: existing.contactName ?? null,
      contactCompany: existing.contactCompany ?? null,
      contactEmail: existing.contactEmail ?? null,
      contactPhone: existing.contactPhone ?? null,
      hasBalcony: existing.hasBalcony ?? null,
      hasTerrace: existing.hasTerrace ?? null,
      hasGarden: existing.hasGarden ?? null,
      hasElevator: existing.hasElevator ?? null,
      parkingAvailable: existing.parkingAvailable ?? null,
      isFurnished: existing.isFurnished ?? null,
      listingStatus: lifecycleStatus,
    });

    const updated = await this.deps.updateLifecycleStatus({
      id: existing.id,
      currentRawListingId: context.rawListingId,
      latestScrapeRunId: scrapeRunId,
      listingStatus: lifecycleStatus,
      sourceStatusRaw: context.availabilityStatus ?? lifecycleStatus,
      contentFingerprint: nextFingerprint,
    });

    if (!updated) {
      return {
        listingId: existing.id,
        listingVersionId: null,
        isNew: false,
        versionReason: null,
        warnings: [],
        listing: null,
      };
    }

    const versionReason: VersionReason | null =
      existing.listingStatus !== lifecycleStatus ? 'status_change' : null;
    let listingVersionId: number | null = null;

    if (versionReason) {
      const pricePerSqmEur = this.computePricePerSqm(
        existing.listPriceEurCents ?? null,
        existing.livingAreaSqm ?? existing.usableAreaSqm ?? null,
      );

      const versionResult = await this.deps.appendListingVersion({
        listingId: existing.id,
        rawListingId: context.rawListingId,
        versionReason,
        contentFingerprint: nextFingerprint,
        listingStatus: lifecycleStatus,
        listPriceEurCents: existing.listPriceEurCents ?? null,
        livingAreaSqm: existing.livingAreaSqm ?? null,
        pricePerSqmEur,
        normalizedSnapshot: {
          ...existing.normalizedPayload,
          listingStatus: lifecycleStatus,
          sourceStatusRaw: context.availabilityStatus ?? lifecycleStatus,
        },
      });

      listingVersionId = versionResult.id;
    }

    await this.deps.updateScrapeRunNormalizationCounts(scrapeRunId, 0, versionReason ? 1 : 0);

    return {
      listingId: existing.id,
      listingVersionId,
      isNew: false,
      versionReason,
      warnings: [],
      listing: {
        title: existing.title,
        description: existing.description ?? null,
        operationType: existing.operationType,
        propertyType: existing.propertyType,
        districtNo: existing.districtNo ?? null,
        city: existing.city,
        listPriceEurCents: existing.listPriceEurCents ?? null,
        livingAreaSqm: existing.livingAreaSqm ?? null,
        usableAreaSqm: existing.usableAreaSqm ?? null,
        rooms: existing.rooms ?? null,
        completenessScore: existing.completenessScore,
        firstSeenAt: existing.firstSeenAt,
        lastPriceChangeAt: existing.lastPriceChangeAt ?? null,
        canonicalUrl: existing.canonicalUrl,
        currentScore: existing.currentScore ?? null,
      },
    };
  }
}

function resolveLifecycleStatus(
  availabilityStatus: NormalizationContext['availabilityStatus'],
): ListingStatus | null {
  switch (availabilityStatus) {
    case 'sold':
      return 'sold';
    case 'rented':
      return 'rented';
    case 'removed':
    case 'not_found':
      return 'withdrawn';
    default:
      return null;
  }
}

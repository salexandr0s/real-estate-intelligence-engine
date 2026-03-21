import type {
  CanonicalListingInput,
  NormalizationContext,
  NormalizationResult,
  SourceNormalizer,
  SourceRawListingBase,
  VersionReason,
} from '@rei/contracts';
import { createLogger } from '@rei/observability';

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
    listingStatus: string;
    listPriceEurCents: number | null;
    firstSeenAt: Date;
    lastPriceChangeAt: Date | null;
    currentScore: number | null;
  } | null>;

  upsertListing: (input: CanonicalListingInput) => Promise<{ id: number; isNew: boolean }>;

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

    if (!result.success || !result.listing) {
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

    // 2. Check existing listing
    const existing = await this.deps.findExistingListing(
      listing.sourceId,
      listing.sourceListingKey,
    );

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
      // Determine specific change type
      if (existing.listPriceEurCents !== listing.listPriceEurCents) {
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
}

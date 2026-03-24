import type {
  NormalizationContext,
  NormalizationResult,
  SourceRawListingBase,
} from '@immoradar/contracts';
import { BaseSourceMapper } from './base-mapper.js';
import { parseEurPrice } from '../canonical/coerce.js';

/**
 * Ediktsdatei (Zwangsversteigerung) raw listing fields.
 * Government auction listings from edikte.justiz.gv.at.
 */
export interface EdikteRawListing extends SourceRawListingBase {
  /** Edikt document ID */
  ediktId?: string | null;
  /** Court handling the auction */
  courtName?: string | null;
  /** Case number (Aktenzeichen) */
  caseNumber?: string | null;
  /** Scheduled auction date (ISO string) */
  auctionDate?: string | null;
  /** Appraised value as raw string (e.g., "EUR 250.000,00") */
  appraisedValueRaw?: string | null;
  /** Minimum bid as raw string */
  minimumBidRaw?: string | null;
  /** Scheduled property viewing dates (ISO strings) */
  viewingDates?: string[] | null;
  /** Source-reported property category (e.g., "Eigentumswohnung") */
  sourcePropertyCategory?: string | null;
}

/**
 * Ediktsdatei (Austrian court auction) normalizer.
 * Enriches base normalization with auction-specific metadata.
 */
export class EdikteMapper extends BaseSourceMapper {
  override readonly normalizationVersion = 1;

  constructor() {
    super('edikte');
  }

  override normalize(
    rawPayload: EdikteRawListing,
    context: NormalizationContext,
  ): NormalizationResult {
    const result = super.normalize(rawPayload, context);

    if (!result.success || result.listing == null) {
      return result;
    }

    // Parse auction-specific price fields
    const appraisedResult = parseEurPrice(rawPayload.appraisedValueRaw);
    const minimumBidResult = parseEurPrice(rawPayload.minimumBidRaw);

    // Enrich normalizedPayload with auction metadata
    result.listing.normalizedPayload = {
      ...result.listing.normalizedPayload,
      isAuction: true,
      ediktId: rawPayload.ediktId ?? null,
      courtName: rawPayload.courtName ?? null,
      caseNumber: rawPayload.caseNumber ?? null,
      auctionDate: rawPayload.auctionDate ?? null,
      appraisedValueEurCents: appraisedResult.value,
      minimumBidEurCents: minimumBidResult.value,
      viewingDates: rawPayload.viewingDates ?? [],
      sourcePropertyCategory: rawPayload.sourcePropertyCategory ?? null,
    };

    // Auctions are always sales
    result.listing.operationType = 'sale';

    // Mark as forced auction subtype
    result.listing.propertySubtype = 'zwangsversteigerung';

    // Fall back to appraised value if no list price was parsed
    if (result.listing.listPriceEurCents == null && appraisedResult.value != null) {
      result.listing.listPriceEurCents = appraisedResult.value;
    }

    return result;
  }
}

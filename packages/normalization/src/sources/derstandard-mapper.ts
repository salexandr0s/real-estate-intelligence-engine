import type {
  NormalizationContext,
  NormalizationResult,
  SourceRawListingBase,
} from '@rei/contracts';
import { BaseSourceMapper } from './base-mapper.js';

/**
 * DerStandard Immobilien-specific raw listing fields.
 */
export interface DerStandardRawListing extends SourceRawListingBase {
  /** DerStandard listing ID */
  standardId?: string | null;
  /** Property subtype from DerStandard (e.g., "Dachgeschoß", "Sonstige Wohnungen") */
  subTypeRaw?: string | null;
}

/**
 * DerStandard-specific normalizer.
 * Minimal enrichment — DerStandard listings have simple flat structure.
 */
export class DerStandardMapper extends BaseSourceMapper {
  constructor() {
    super('derstandard');
  }

  override normalize(
    rawPayload: DerStandardRawListing,
    context: NormalizationContext,
  ): NormalizationResult {
    const enriched = this.enrichPayload(rawPayload);
    const result = super.normalize(enriched, context);

    if (result.success && result.listing) {
      result.listing.normalizedPayload = {
        ...result.listing.normalizedPayload,
        derStandardId: rawPayload.standardId ?? null,
      };

      // Map DerStandard subtype to property subtype
      if (rawPayload.subTypeRaw != null) {
        const subLower = rawPayload.subTypeRaw.toLowerCase();
        if (subLower.includes('dachgeschoss') || subLower.includes('dachgeschoß')) {
          result.listing.propertySubtype = 'penthouse';
        } else if (subLower.includes('maisonette')) {
          result.listing.propertySubtype = 'maisonette';
        } else if (subLower.includes('loft')) {
          result.listing.propertySubtype = 'loft';
        }
      }
    }

    return result;
  }

  private enrichPayload(raw: DerStandardRawListing): DerStandardRawListing {
    const enriched: DerStandardRawListing = { ...raw };

    // DerStandard uses "Wohnung" as default property type
    if (enriched.propertyTypeRaw == null && enriched.subTypeRaw != null) {
      enriched.propertyTypeRaw = enriched.subTypeRaw;
    }

    return enriched;
  }
}

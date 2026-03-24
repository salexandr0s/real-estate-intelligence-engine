import type {
  NormalizationContext,
  NormalizationResult,
  SourceRawListingBase,
} from '@immoradar/contracts';
import { BaseSourceMapper } from './base-mapper.js';

/**
 * Wohnnet-specific raw listing fields beyond the base DTO.
 */
export interface WohnnetRawListing extends SourceRawListingBase {
  /** Wohnnet listing ID */
  wohnnetId?: string | null;
  /** Broker company name */
  brokerCompany?: string | null;
  /** Wohnnet property category (e.g., "Eigentumswohnung", "Altbauwohnung") */
  categoryRaw?: string | null;
}

/**
 * Wohnnet-specific normalizer.
 * Minimal enrichment — wohnnet data maps cleanly to base DTO fields.
 */
export class WohnnetMapper extends BaseSourceMapper {
  constructor() {
    super('wohnnet');
  }

  override normalize(
    rawPayload: WohnnetRawListing,
    context: NormalizationContext,
  ): NormalizationResult {
    const enriched = this.enrichPayload(rawPayload);
    const result = super.normalize(enriched, context);

    if (result.success && result.listing) {
      result.listing.normalizedPayload = {
        ...result.listing.normalizedPayload,
        wohnnetId: rawPayload.wohnnetId ?? null,
        wohnnetBrokerCompany: rawPayload.brokerCompany ?? null,
      };

      // Infer property type from wohnnet category
      if (result.listing.propertyType === 'other' && rawPayload.categoryRaw != null) {
        const catLower = rawPayload.categoryRaw.toLowerCase();
        if (
          catLower.includes('wohnung') ||
          catLower.includes('altbau') ||
          catLower.includes('neubau') ||
          catLower.includes('dachgeschoss') ||
          catLower.includes('penthouse')
        ) {
          result.listing.propertyType = 'apartment';
        } else if (
          catLower.includes('haus') ||
          catLower.includes('villa') ||
          catLower.includes('reihenhaus')
        ) {
          result.listing.propertyType = 'house';
        } else if (catLower.includes('grundstück')) {
          result.listing.propertyType = 'land';
        }
      }
    }

    return result;
  }

  private enrichPayload(raw: WohnnetRawListing): WohnnetRawListing {
    const enriched: WohnnetRawListing = { ...raw };

    if (enriched.propertyTypeRaw == null && enriched.categoryRaw != null) {
      enriched.propertyTypeRaw = enriched.categoryRaw;
    }

    return enriched;
  }
}

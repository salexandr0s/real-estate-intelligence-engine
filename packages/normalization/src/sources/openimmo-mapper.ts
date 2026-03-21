import type {
  NormalizationContext,
  NormalizationResult,
  SourceRawListingBase,
} from '@rei/contracts';
import { BaseSourceMapper } from './base-mapper.js';

/**
 * OpenImmo-specific raw listing fields.
 * Uses German field names following the OpenImmo data standard.
 */
export interface OpenImmoRawListing extends SourceRawListingBase {
  /** OpenImmo object number */
  openimmoId?: string | null;
  /** OpenImmo Vermarktungsart (KAUF, MIETE) */
  vermarktungsartRaw?: string | null;
  /** OpenImmo Objektart (WOHNUNG, HAUS, etc.) */
  objektartRaw?: string | null;
}

/**
 * OpenImmo-specific normalizer.
 * Maps OpenImmo standard field names to base DTO fields.
 */
export class OpenImmoMapper extends BaseSourceMapper {
  constructor() {
    super('openimmo');
  }

  override normalize(
    rawPayload: OpenImmoRawListing,
    context: NormalizationContext,
  ): NormalizationResult {
    const enriched = this.enrichPayload(rawPayload);
    const result = super.normalize(enriched, context);

    if (result.success && result.listing) {
      result.listing.normalizedPayload = {
        ...result.listing.normalizedPayload,
        openimmoId: rawPayload.openimmoId ?? null,
      };

      // Map OpenImmo Vermarktungsart if operation type not already set
      if (result.listing.operationType == null && rawPayload.vermarktungsartRaw != null) {
        const vLower = rawPayload.vermarktungsartRaw.toLowerCase();
        if (vLower === 'kauf' || vLower.includes('kauf')) {
          result.listing.operationType = 'sale';
        } else if (vLower === 'miete' || vLower.includes('miet')) {
          result.listing.operationType = 'rent';
        }
      }

      // Map OpenImmo Objektart if property type not already resolved
      if (result.listing.propertyType === 'other' && rawPayload.objektartRaw != null) {
        const oLower = rawPayload.objektartRaw.toLowerCase();
        if (oLower === 'wohnung' || oLower.includes('wohnung')) {
          result.listing.propertyType = 'apartment';
        } else if (oLower === 'haus' || oLower.includes('haus')) {
          result.listing.propertyType = 'house';
        } else if (oLower.includes('grundstück') || oLower.includes('grundstueck')) {
          result.listing.propertyType = 'land';
        } else if (oLower.includes('gewerbe') || oLower.includes('büro') || oLower.includes('buero')) {
          result.listing.propertyType = 'commercial';
        }
      }
    }

    return result;
  }

  private enrichPayload(raw: OpenImmoRawListing): OpenImmoRawListing {
    const enriched: OpenImmoRawListing = { ...raw };

    if (enriched.propertyTypeRaw == null && enriched.objektartRaw != null) {
      enriched.propertyTypeRaw = enriched.objektartRaw;
    }

    if (enriched.operationTypeRaw == null && enriched.vermarktungsartRaw != null) {
      const v = enriched.vermarktungsartRaw.toLowerCase();
      if (v.includes('kauf')) enriched.operationTypeRaw = 'sale';
      else if (v.includes('miet')) enriched.operationTypeRaw = 'rent';
    }

    return enriched;
  }
}

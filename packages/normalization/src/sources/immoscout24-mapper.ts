import type {
  NormalizationContext,
  NormalizationResult,
  SourceRawListingBase,
} from '@immoradar/contracts';
import { BaseSourceMapper } from './base-mapper.js';

/**
 * ImmobilienScout24-specific raw listing fields beyond the base DTO.
 */
export interface Immoscout24RawListing extends SourceRawListingBase {
  /** IS24 expose ID */
  immoscout24Id?: string | null;
  /** Broker company name */
  brokerName?: string | null;
  /** IS24 estate type code (e.g., "APARTMENT", "HOUSE") */
  estateTypeRaw?: string | null;
}

/**
 * ImmobilienScout24-specific normalizer.
 * Enriches raw payload with IS24 attribute mappings before base normalization.
 */
export class Immoscout24Mapper extends BaseSourceMapper {
  constructor() {
    super('immoscout24');
  }

  override normalize(
    rawPayload: Immoscout24RawListing,
    context: NormalizationContext,
  ): NormalizationResult {
    const enriched = this.enrichPayload(rawPayload);
    const result = super.normalize(enriched, context);

    if (rawPayload.priceFromRaw === undefined && enriched.priceFromRaw != null) {
      result.provenance['priceFrom'] = 'payload.attributesRaw.priceFromRaw';
    }
    if (rawPayload.isProjectRaw === undefined && enriched.isProjectRaw === true) {
      result.provenance['isProject'] =
        'inferred (parser v3: attributesRaw.priceFromRaw + estateTypeRaw)';
    }

    if (result.success && result.listing) {
      result.listing.normalizedPayload = {
        ...result.listing.normalizedPayload,
        immoscout24Id: rawPayload.immoscout24Id ?? null,
        immoscout24BrokerName: rawPayload.brokerName ?? null,
      };

      // Infer property type from IS24 estate type if base mapping failed
      if (result.listing.propertyType === 'other' && rawPayload.estateTypeRaw != null) {
        const typeLower = rawPayload.estateTypeRaw.toLowerCase();
        if (typeLower.includes('wohnung') || typeLower.includes('apartment')) {
          result.listing.propertyType = 'apartment';
        } else if (typeLower.includes('haus') || typeLower.includes('house')) {
          result.listing.propertyType = 'house';
        } else if (typeLower.includes('grundstück') || typeLower.includes('land')) {
          result.listing.propertyType = 'land';
        } else if (typeLower.includes('gewerbe') || typeLower.includes('büro')) {
          result.listing.propertyType = 'commercial';
        }
      }
    }

    return result;
  }

  private enrichPayload(raw: Immoscout24RawListing): Immoscout24RawListing {
    const enriched: Immoscout24RawListing = { ...raw };

    // Parser v3 put the from-price in attributes. An estate type is evidence of
    // an Expose record, which emitted a from-price only for a project.
    const legacyFrom = raw.attributesRaw?.['priceFromRaw'];
    if (
      raw.priceFromRaw === undefined &&
      (typeof legacyFrom === 'string' || typeof legacyFrom === 'number')
    ) {
      enriched.priceFromRaw = legacyFrom;
    }
    if (raw.isProjectRaw === undefined && legacyFrom != null && raw.estateTypeRaw != null) {
      enriched.isProjectRaw = true;
    }
    if (enriched.isProjectRaw === true) {
      enriched.priceRaw = null;
      enriched.livingAreaRaw = null;
      enriched.usableAreaRaw = null;
      enriched.roomsRaw = null;
      enriched.roomsCountRaw = null;
    }

    enriched.contactNameRaw ??= (raw as { contactName?: string | null }).contactName ?? null;
    enriched.contactCompanyRaw ??= raw.brokerName ?? null;

    if (enriched.propertyTypeRaw == null && enriched.estateTypeRaw != null) {
      enriched.propertyTypeRaw = enriched.estateTypeRaw;
    }

    if (enriched.attributesRaw != null) {
      const attrs = enriched.attributesRaw;
      if (enriched.floorRaw == null && attrs['floor'] != null) {
        enriched.floorRaw = String(attrs['floor']);
      }
      if (enriched.yearBuiltRaw == null && attrs['constructionYear'] != null) {
        enriched.yearBuiltRaw = String(attrs['constructionYear']);
      }
      if (enriched.heatingTypeRaw == null && attrs['heatingType'] != null) {
        enriched.heatingTypeRaw = String(attrs['heatingType']);
      }
      if (enriched.conditionRaw == null && attrs['condition'] != null) {
        enriched.conditionRaw = String(attrs['condition']);
      }
      if (enriched.energyCertificateRaw == null && attrs['energyCertificate'] != null) {
        enriched.energyCertificateRaw = String(attrs['energyCertificate']);
      }
    }

    return enriched;
  }
}

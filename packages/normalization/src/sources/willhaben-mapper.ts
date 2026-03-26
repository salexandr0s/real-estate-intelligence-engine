import type {
  NormalizationContext,
  NormalizationResult,
  SourceRawListingBase,
} from '@immoradar/contracts';
import { BaseSourceMapper } from './base-mapper.js';

// ── Willhaben-specific DTO extension ───────────────────────────────────────

/**
 * Willhaben-specific raw listing fields beyond the base DTO.
 * These capture willhaben's particular payload structure.
 */
export interface WillhabenRawListing extends SourceRawListingBase {
  /** Willhaben internal advertisement ID */
  advertisementId?: string | null;
  /** Willhaben category path (e.g., "Immobilien / Eigentumswohnungen") */
  categoryPath?: string | null;
  /** Willhaben seller type */
  sellerType?: string | null;
  /** Raw "Objekttyp" attribute */
  objekttypRaw?: string | null;
  /** Commission-free flag text */
  provisionRaw?: string | null;
}

// ── Willhaben Mapper ───────────────────────────────────────────────────────

/**
 * Willhaben-specific normalizer that extends BaseSourceMapper
 * with willhaben-specific field mappings and extractions.
 */
export class WillhabenMapper extends BaseSourceMapper {
  constructor() {
    super('willhaben');
  }

  override normalize(
    rawPayload: WillhabenRawListing,
    context: NormalizationContext,
  ): NormalizationResult {
    // Enrich the raw payload with willhaben-specific field mappings
    // before passing to the base mapper
    const enriched = this.enrichPayload(rawPayload);

    // Run the base normalization
    const result = super.normalize(enriched, context);

    // Add willhaben-specific metadata to normalizedPayload
    if (result.success && result.listing) {
      result.listing.normalizedPayload = {
        ...result.listing.normalizedPayload,
        willhabenAdvertisementId: rawPayload.advertisementId ?? null,
        willhabenCategoryPath: rawPayload.categoryPath ?? null,
        willhabenSellerType: rawPayload.sellerType ?? null,
      };

      // Infer operation type from category path if not already set
      if (rawPayload.operationTypeRaw == null && rawPayload.categoryPath != null) {
        const categoryLower = rawPayload.categoryPath.toLowerCase();
        if (categoryLower.includes('eigentum') || categoryLower.includes('kauf')) {
          result.listing.operationType = 'sale';
        } else if (categoryLower.includes('miet') || categoryLower.includes('miete')) {
          result.listing.operationType = 'rent';
        }
      }

      // Infer property type from category path if base mapping failed
      if (result.listing.propertyType === 'other' && rawPayload.categoryPath != null) {
        const categoryLower = rawPayload.categoryPath.toLowerCase();
        if (categoryLower.includes('wohnung') || categoryLower.includes('apartment')) {
          result.listing.propertyType = 'apartment';
        } else if (categoryLower.includes('haus') || categoryLower.includes('house')) {
          result.listing.propertyType = 'house';
        } else if (categoryLower.includes('grundstück') || categoryLower.includes('grundstueck')) {
          result.listing.propertyType = 'land';
        } else if (
          categoryLower.includes('gewerbe') ||
          categoryLower.includes('büro') ||
          categoryLower.includes('buero')
        ) {
          result.listing.propertyType = 'commercial';
        } else if (categoryLower.includes('garage') || categoryLower.includes('stellplatz')) {
          result.listing.propertyType = 'parking';
        }
      }

      // Check commission-free status from provision text
      if (rawPayload.provisionRaw != null) {
        const provLower = rawPayload.provisionRaw.toLowerCase();
        if (provLower.includes('provisionsfrei') || provLower.includes('keine provision')) {
          result.listing.normalizedPayload['isCommissionFree'] = true;
        }
      }
    }

    return result;
  }

  /**
   * Enriches the willhaben payload with field-level mappings
   * specific to how willhaben structures its data.
   */
  private enrichPayload(raw: WillhabenRawListing): WillhabenRawListing {
    const enriched: WillhabenRawListing = { ...raw };

    enriched.contactNameRaw ??= (raw as { contactName?: string | null }).contactName ?? null;
    enriched.contactPhoneRaw ??= (raw as { contactPhone?: string | null }).contactPhone ?? null;

    // Map Objekttyp to property type if main type is missing
    if (enriched.propertyTypeRaw == null && enriched.objekttypRaw != null) {
      enriched.propertyTypeRaw = enriched.objekttypRaw;
    }

    // Willhaben sometimes stores attributes in a specific structure
    if (enriched.attributesRaw != null) {
      const attrs = enriched.attributesRaw;

      // Map from willhaben attribute keys to base DTO fields
      if (enriched.floorRaw == null && attrs['FLOOR'] != null) {
        enriched.floorRaw = String(attrs['FLOOR']);
      }
      if (
        enriched.yearBuiltRaw == null &&
        (attrs['CONSTRUCTION_YEAR'] ?? attrs['YEAR_BUILT']) != null
      ) {
        enriched.yearBuiltRaw = String(attrs['CONSTRUCTION_YEAR'] ?? attrs['YEAR_BUILT']);
      }
      if (enriched.heatingTypeRaw == null && attrs['HEATING'] != null) {
        enriched.heatingTypeRaw = String(attrs['HEATING']);
      }
      if (
        enriched.conditionRaw == null &&
        (attrs['BUILDING_CONDITION'] ?? attrs['CONDITION']) != null
      ) {
        enriched.conditionRaw = String(attrs['BUILDING_CONDITION'] ?? attrs['CONDITION']);
      }
      if (
        enriched.energyCertificateRaw == null &&
        (attrs['ENERGY_HWB_CLASS'] ?? attrs['ENERGY_CERTIFICATE']) != null
      ) {
        enriched.energyCertificateRaw = String(
          attrs['ENERGY_HWB_CLASS'] ?? attrs['ENERGY_CERTIFICATE'],
        );
      }
      if (enriched.balconyAreaRaw == null && attrs['BALCONY_AREA'] != null) {
        enriched.balconyAreaRaw = String(attrs['BALCONY_AREA']);
      }
      if (enriched.terraceAreaRaw == null && attrs['TERRACE_AREA'] != null) {
        enriched.terraceAreaRaw = String(attrs['TERRACE_AREA']);
      }
      if (enriched.gardenAreaRaw == null && attrs['GARDEN_AREA'] != null) {
        enriched.gardenAreaRaw = String(attrs['GARDEN_AREA']);
      }
    }

    return enriched;
  }
}

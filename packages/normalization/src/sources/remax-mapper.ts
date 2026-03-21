import type {
  NormalizationContext,
  NormalizationResult,
  SourceRawListingBase,
} from '@rei/contracts';
import { BaseSourceMapper } from './base-mapper.js';

/**
 * RE/MAX Austria-specific raw listing fields.
 */
export interface RemaxRawListing extends SourceRawListingBase {
  /** RE/MAX property ID */
  remaxId?: string | null;
  /** RE/MAX agent company (e.g., "RE/MAX Donaustadt") */
  agentCompany?: string | null;
  /** RE/MAX transaction type (e.g., "Kauf", "Miete") */
  transactionTypeRaw?: string | null;
}

/**
 * RE/MAX Austria-specific normalizer.
 * Maps RE/MAX field names to base DTO and preserves agent metadata.
 */
export class RemaxMapper extends BaseSourceMapper {
  constructor() {
    super('remax');
  }

  override normalize(
    rawPayload: RemaxRawListing,
    context: NormalizationContext,
  ): NormalizationResult {
    const enriched = this.enrichPayload(rawPayload);
    const result = super.normalize(enriched, context);

    if (result.success && result.listing) {
      result.listing.normalizedPayload = {
        ...result.listing.normalizedPayload,
        remaxId: rawPayload.remaxId ?? null,
        remaxAgentCompany: rawPayload.agentCompany ?? null,
      };

      // Infer operation type from RE/MAX transaction type
      if (result.listing.operationType == null && rawPayload.transactionTypeRaw != null) {
        const tLower = rawPayload.transactionTypeRaw.toLowerCase();
        if (tLower.includes('kauf') || tLower.includes('eigentum')) {
          result.listing.operationType = 'sale';
        } else if (tLower.includes('miet')) {
          result.listing.operationType = 'rent';
        }
      }
    }

    return result;
  }

  private enrichPayload(raw: RemaxRawListing): RemaxRawListing {
    const enriched: RemaxRawListing = { ...raw };

    if (enriched.operationTypeRaw == null && enriched.transactionTypeRaw != null) {
      const t = enriched.transactionTypeRaw.toLowerCase();
      if (t.includes('kauf')) enriched.operationTypeRaw = 'sale';
      else if (t.includes('miet')) enriched.operationTypeRaw = 'rent';
    }

    return enriched;
  }
}

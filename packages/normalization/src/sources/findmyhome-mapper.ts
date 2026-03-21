import type {
  NormalizationContext,
  NormalizationResult,
  SourceRawListingBase,
} from '@rei/contracts';
import { BaseSourceMapper } from './base-mapper.js';

/**
 * FindMyHome-specific raw listing fields.
 */
export interface FindMyHomeRawListing extends SourceRawListingBase {
  /** FindMyHome listing ID */
  findmyhomeId?: string | null;
}

/**
 * FindMyHome-specific normalizer.
 * Minimal — FindMyHome data maps directly to base DTO fields.
 */
export class FindMyHomeMapper extends BaseSourceMapper {
  constructor() {
    super('findmyhome');
  }

  override normalize(
    rawPayload: FindMyHomeRawListing,
    context: NormalizationContext,
  ): NormalizationResult {
    const result = super.normalize(rawPayload, context);

    if (result.success && result.listing) {
      result.listing.normalizedPayload = {
        ...result.listing.normalizedPayload,
        findmyhomeId: rawPayload.findmyhomeId ?? null,
      };
    }

    return result;
  }
}

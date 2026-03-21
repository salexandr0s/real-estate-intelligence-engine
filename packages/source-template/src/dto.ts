import type { SourceRawListingBase } from '@rei/contracts';

// TODO: Replace with source-specific discovery item fields
export interface TemplateDiscoveryItem {
  listingId: string;
  detailUrl: string;
  titleRaw: string | null;
  priceRaw: string | null;
  locationRaw: string | null;
}

// TODO: Replace with source-specific detail DTO fields
export interface TemplateDetailDTO extends SourceRawListingBase {
  // Add source-specific fields here, e.g.:
  // sourceSpecificId: string;
  // images: string[];
  // contactName: string | null;
}

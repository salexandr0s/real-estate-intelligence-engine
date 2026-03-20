import type { SourceRawListingBase } from '@rei/contracts';

export interface WillhabenDiscoveryItem {
  listingId: string;
  detailUrl: string;
  titleRaw: string | null;
  priceRaw: string | null;
  locationRaw: string | null;
  roomsRaw: string | null;
  areaRaw: string | null;
}

export interface WillhabenDetailDTO extends SourceRawListingBase {
  willhabenId: string;
  images: string[];
  contactName: string | null;
  contactPhone: string | null;
}

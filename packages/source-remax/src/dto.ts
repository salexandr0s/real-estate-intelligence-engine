import type { SourceRawListingBase } from '@immoradar/contracts';

// -- window.dataLayer from detail pages --------------------------------------

export interface RemaxDataLayer {
  immoId?: string;
  immoType?: string;
  immoTransaction?: string;
  immoPostcode?: string;
  immoLocation?: string;
  immoRegion?: string;
  maklerId?: string;
  maklerName?: string;
}

// -- Discovery / Detail DTOs -------------------------------------------------

export interface RemaxDiscoveryItem {
  remaxId: string;
  detailUrl: string;
  titleRaw: string | null;
  priceRaw: string | null;
  locationRaw: string | null;
  roomsRaw: string | null;
  areaRaw: string | null;
  agentName: string | null;
  agentCompany: string | null;
}

export interface RemaxDetailDTO extends SourceRawListingBase {
  remaxId: string;
  immoId: string | null;
  images: string[];
  contactName: string | null;
  agentCompany: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  commissionRaw: string | null;
  features: string[];
}

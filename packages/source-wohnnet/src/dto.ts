import type { SourceRawListingBase } from '@immoradar/contracts';

// -- JSON-LD Types (detail page uses Product schema) --------------------------

export interface JsonLdOffer {
  '@type'?: string;
  price?: string;
  priceCurrency?: string;
  availability?: string;
}

export interface JsonLdProduct {
  '@context'?: string;
  '@type'?: string;
  name?: string;
  description?: string;
  url?: string;
  image?: string | string[];
  offers?: JsonLdOffer;
  brand?: {
    '@type'?: string;
    name?: string;
  };
}

// -- dataLayer type (embedded JS on detail page) ------------------------------

export interface WohnnetDataLayer {
  'dL-angebot'?: string;
  'dL-flaeche'?: string;
  'dL-preis'?: string;
  'dL-zimmer'?: string;
  'dL-objektart'?: string;
  'Region4.Name'?: string;
}

// -- Discovery / Detail DTOs --------------------------------------------------

export interface WohnnetDiscoveryItem {
  wohnnetId: string;
  detailUrl: string;
  titleRaw: string | null;
  priceRaw: string | null;
  locationRaw: string | null;
  roomsRaw: string | null;
  areaRaw: string | null;
  features: string[];
}

export interface WohnnetDetailDTO extends SourceRawListingBase {
  wohnnetId: string;
  images: string[];
  contactName: string | null;
  brokerCompany: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

import type { SourceRawListingBase } from '@rei/contracts';

// ── JSON-LD schema types for findmyhome.at detail pages ─────────────────────
// Discovery parsing no longer uses JSON-LD (site serves HTML cards).
// These types are retained for the detail page parser which still reads JSON-LD.

export interface JsonLdOffer {
  '@type': string;
  price: string;
  priceCurrency: string;
}

export interface JsonLdQuantitativeValue {
  '@type': string;
  value: string;
  unitCode: string;
}

export interface JsonLdPostalAddress {
  '@type': string;
  postalCode: string;
  addressLocality: string;
  addressRegion?: string;
  streetAddress?: string;
}

export interface JsonLdGeoCoordinates {
  '@type': string;
  latitude: string;
  longitude: string;
}

export interface JsonLdAmenityFeature {
  '@type': string;
  name: string;
  value?: string;
}

export interface JsonLdContactPoint {
  '@type': string;
  contactType?: string;
  name?: string;
  telephone?: string;
  email?: string;
}

export interface JsonLdPhoto {
  '@type': string;
  contentUrl: string;
  caption?: string;
}

export interface JsonLdApartmentDetail {
  '@context': string;
  '@type': string;
  '@id': string;
  name: string;
  identifier: string;
  description?: string;
  offers?: JsonLdOffer;
  floorSize?: JsonLdQuantitativeValue;
  numberOfRooms?: string;
  address?: JsonLdPostalAddress;
  geo?: JsonLdGeoCoordinates;
  photo?: JsonLdPhoto[];
  yearBuilt?: string;
  amenityFeature?: JsonLdAmenityFeature[];
  contactPoint?: JsonLdContactPoint;
  additionalProperty?: Array<{ '@type': string; name: string; value: string }>;
}

// ── Discovery / Detail DTOs ─────────────────────────────────────────────────

export interface FindMyHomeDiscoveryItem {
  findmyhomeId: string;
  detailUrl: string;
  titleRaw: string | null;
  priceRaw: string | null;
  locationRaw: string | null;
  roomsRaw: string | null;
  areaRaw: string | null;
}

export interface FindMyHomeDetailDTO extends SourceRawListingBase {
  findmyhomeId: string;
  images: string[];
  contactName: string | null;
}

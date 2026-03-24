import type { SourceRawListingBase } from '@immoradar/contracts';

// -- IS24 JSON-LD types (CollectionPage / Product / RealEstateAgent) ----------

export interface IS24PostalAddress {
  streetAddress?: string;
  postalCode?: string;
  addressLocality?: string;
  addressCountry?: string;
}

export interface IS24RealEstateListing {
  '@type': string;
  '@id': string;
  name: string;
  description: string;
  url: string;
  image: string[];
  datePosted: string;
  provider: { name: string };
  mainEntity: { address: IS24PostalAddress };
}

export interface IS24ListItem {
  '@type': string;
  position: number;
  item: IS24RealEstateListing;
}

export interface IS24CollectionPage {
  '@type': string;
  name?: string;
  mainEntity: {
    '@type': string;
    numberOfItems?: number;
    itemListElement: IS24ListItem[];
  };
}

export interface IS24ProductOffer {
  '@type': string;
  price: number;
  priceCurrency: string;
  availability?: string;
}

export interface IS24Product {
  '@type': string;
  name: string;
  description: string;
  image: string[];
  offers?: IS24ProductOffer;
}

export interface IS24RealEstateAgent {
  '@type': string;
  name: string;
}

// -- Discovery / Detail DTOs -------------------------------------------------

export interface Immoscout24DiscoveryItem {
  exposeId: string;
  detailUrl: string;
  titleRaw: string | null;
  priceRaw: string | null;
  locationRaw: string | null;
  roomsRaw: string | null;
  areaRaw: string | null;
}

export interface Immoscout24DetailDTO extends SourceRawListingBase {
  immoscout24Id: string;
  images: string[];
  contactName: string | null;
  brokerName: string | null;
}

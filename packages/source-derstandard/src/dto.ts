import type { SourceRawListingBase } from '@immoradar/contracts';

// ── Embedded JSON shape from <script id="listing-detail-data"> ──────────────

export interface DerStandardDetailAddress {
  postalCode: string;
  city: string;
  district: string;
  street: string | null;
}

export interface DerStandardDetailCoordinates {
  lat: number;
  lng: number;
}

export interface DerStandardDetailContact {
  name: string | null;
  phone: string | null;
}

export interface DerStandardDetailData {
  id: number | null;
  title: string;
  description: string | null;
  price: number | null;
  livingArea: number | null;
  usableArea: number | null;
  rooms: number | null;
  floor: number | null;
  yearBuilt: number | null;
  address: DerStandardDetailAddress;
  coordinates: DerStandardDetailCoordinates | null;
  images: string[];
  contact: DerStandardDetailContact | null;
  propertyType: string | null;
  subType: string | null;
  heatingType: string | null;
  condition: string | null;
  energyCertificate: string | null;
  features: string[];
  operatingCosts: number | null;
  status: string;
}

// ── Discovery / Detail DTOs ────────────────────────────────────────────────

export interface DerStandardDiscoveryItem {
  standardId: string;
  detailUrl: string;
  titleRaw: string | null;
  priceRaw: string | null;
  locationRaw: string | null;
  roomsRaw: string | null;
  areaRaw: string | null;
}

export interface DerStandardDetailDTO extends SourceRawListingBase {
  standardId: string;
  images: string[];
  contactName: string | null;
  contactPhone: string | null;
}

import type { SourceRawListingBase } from '@rei/contracts';

// ── OpenImmo discovery JSON structure ───────────────────────────────────────

export interface OpenImmoSearchData {
  meta: {
    totalCount: number;
    page: number;
    pageSize: number;
  };
  results: OpenImmoSearchResult[];
}

export interface OpenImmoSearchResult {
  objektNr: string;
  titel: string;
  kaufpreis: number | null;
  wohnflaeche: number | null;
  anzahlZimmer: number | null;
  plz: string | null;
  ort: string | null;
  stadtteil: string | null;
  detailUrl: string;
  bildUrl: string | null;
}

// ── OpenImmo detail JSON structure ──────────────────────────────────────────

export interface OpenImmoListingData {
  objektNr: string;
  titel: string;
  beschreibung: string | null;
  kaufpreis: number | null;
  wohnflaeche: number | null;
  nutzflaeche: number | null;
  anzahlZimmer: number | null;
  etage: number | null;
  baujahr: number | null;
  plz: string | null;
  ort: string | null;
  stadtteil: string | null;
  strasse: string | null;
  breitengrad: number | null;
  laengengrad: number | null;
  heizungsart: string | null;
  zustand: string | null;
  energieausweis: string | null;
  balkonFlaeche: number | null;
  betriebskosten: number | null;
  bilder: string[];
  kontaktName: string | null;
  kontaktTelefon: string | null;
  vermarktungsart: string | null;
  objektart: string | null;
  status: string | null;
}

// ── Discovery / Detail DTOs ─────────────────────────────────────────────────

export interface OpenImmoDiscoveryItem {
  openimmoId: string;
  detailUrl: string;
  titleRaw: string | null;
  priceRaw: string | null;
  locationRaw: string | null;
  roomsRaw: string | null;
  areaRaw: string | null;
}

export interface OpenImmoDetailDTO extends SourceRawListingBase {
  openimmoId: string;
  images: string[];
  contactName: string | null;
}

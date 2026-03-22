// ── Canonical domain types ──────────────────────────────────────────────────

export type OperationType = 'sale' | 'rent';

export type PropertyType = 'apartment' | 'house' | 'land' | 'commercial' | 'parking' | 'other';

export type ListingStatus =
  | 'active'
  | 'inactive'
  | 'sold'
  | 'rented'
  | 'withdrawn'
  | 'expired'
  | 'unknown';

export type SourceHealthStatus = 'healthy' | 'degraded' | 'blocked' | 'disabled' | 'unknown';

export type ScrapeMode = 'browser' | 'http' | 'api' | 'feed';

export type ScrapeRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'rate_limited';

export type ScrapeRunTriggerType = 'schedule' | 'manual' | 'backfill' | 'retry' | 'recovery';

export type ScrapeRunScope = 'discovery' | 'detail' | 'full';

export type ExtractionStatus = 'captured' | 'parse_failed' | 'blocked' | 'not_found';

export type GeocodePrecision =
  | 'source_exact'
  | 'source_approx'
  | 'street'
  | 'estimated'
  | 'district'
  | 'city'
  | 'none';

export type AlertType =
  | 'new_match'
  | 'price_drop'
  | 'price_change'
  | 'score_upgrade'
  | 'status_change'
  | 'digest'
  | 'source_degraded';

export type AlertChannel = 'in_app' | 'email' | 'push' | 'webhook';

export type AlertStatus = 'queued' | 'sent' | 'failed' | 'dismissed' | 'opened' | 'suppressed';

export type AlertFrequency = 'instant' | 'hourly_digest' | 'daily_digest' | 'manual';

export type FilterKind = 'listing_search' | 'alert';

export type SortBy = 'score_desc' | 'newest' | 'price_asc' | 'price_desc' | 'sqm_desc';

export type LegalStatus = 'approved' | 'review_required' | 'disabled';

export type VersionReason =
  | 'first_seen'
  | 'price_change'
  | 'content_change'
  | 'status_change'
  | 'relist_detected'
  | 'backfill';

// ── Vienna District Data ────────────────────────────────────────────────────

export interface ViennaDistrict {
  readonly districtNo: number;
  readonly name: string;
  readonly postalCode: string;
  readonly aliases: readonly string[];
}

export const VIENNA_DISTRICTS: readonly ViennaDistrict[] = [
  { districtNo: 1, name: 'Innere Stadt', postalCode: '1010', aliases: ['1. bezirk', 'innenstadt'] },
  { districtNo: 2, name: 'Leopoldstadt', postalCode: '1020', aliases: ['2. bezirk'] },
  { districtNo: 3, name: 'Landstraße', postalCode: '1030', aliases: ['landstrasse', '3. bezirk'] },
  { districtNo: 4, name: 'Wieden', postalCode: '1040', aliases: ['4. bezirk'] },
  { districtNo: 5, name: 'Margareten', postalCode: '1050', aliases: ['5. bezirk'] },
  { districtNo: 6, name: 'Mariahilf', postalCode: '1060', aliases: ['6. bezirk'] },
  { districtNo: 7, name: 'Neubau', postalCode: '1070', aliases: ['7. bezirk'] },
  { districtNo: 8, name: 'Josefstadt', postalCode: '1080', aliases: ['8. bezirk'] },
  { districtNo: 9, name: 'Alsergrund', postalCode: '1090', aliases: ['9. bezirk'] },
  { districtNo: 10, name: 'Favoriten', postalCode: '1100', aliases: ['10. bezirk'] },
  { districtNo: 11, name: 'Simmering', postalCode: '1110', aliases: ['11. bezirk'] },
  { districtNo: 12, name: 'Meidling', postalCode: '1120', aliases: ['12. bezirk'] },
  { districtNo: 13, name: 'Hietzing', postalCode: '1130', aliases: ['13. bezirk'] },
  { districtNo: 14, name: 'Penzing', postalCode: '1140', aliases: ['14. bezirk'] },
  {
    districtNo: 15,
    name: 'Rudolfsheim-Fünfhaus',
    postalCode: '1150',
    aliases: ['rudolfsheim fuenfhaus', 'rudolfsheim-funfhaus', '15. bezirk'],
  },
  { districtNo: 16, name: 'Ottakring', postalCode: '1160', aliases: ['16. bezirk'] },
  { districtNo: 17, name: 'Hernals', postalCode: '1170', aliases: ['17. bezirk'] },
  { districtNo: 18, name: 'Währing', postalCode: '1180', aliases: ['waehring', '18. bezirk'] },
  { districtNo: 19, name: 'Döbling', postalCode: '1190', aliases: ['doebling', '19. bezirk'] },
  { districtNo: 20, name: 'Brigittenau', postalCode: '1200', aliases: ['20. bezirk'] },
  { districtNo: 21, name: 'Floridsdorf', postalCode: '1210', aliases: ['21. bezirk'] },
  { districtNo: 22, name: 'Donaustadt', postalCode: '1220', aliases: ['22. bezirk'] },
  { districtNo: 23, name: 'Liesing', postalCode: '1230', aliases: ['23. bezirk'] },
] as const;

// ── Source Row ───────────────────────────────────────────────────────────────

export interface SourceRow {
  id: number;
  code: string;
  name: string;
  baseUrl: string;
  countryCode: string;
  scrapeMode: ScrapeMode;
  isActive: boolean;
  healthStatus: SourceHealthStatus;
  crawlIntervalMinutes: number;
  priority: number;
  rateLimitRpm: number;
  concurrencyLimit: number;
  parserVersion: number;
  legalStatus: LegalStatus;
  config: Record<string, unknown>;
  lastSuccessfulRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Listing Row ─────────────────────────────────────────────────────────────

export interface ListingRow {
  id: number;
  listingUid: string;
  sourceId: number;
  sourceListingKey: string;
  sourceExternalId: string | null;
  currentRawListingId: number;
  latestScrapeRunId: number;
  canonicalUrl: string;
  operationType: OperationType;
  propertyType: PropertyType;
  propertySubtype: string | null;
  listingStatus: ListingStatus;
  sourceStatusRaw: string | null;
  title: string;
  description: string | null;
  districtNo: number | null;
  districtName: string | null;
  postalCode: string | null;
  city: string;
  federalState: string | null;
  street: string | null;
  houseNumber: string | null;
  addressDisplay: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodePrecision: GeocodePrecision | null;
  crossSourceFingerprint: string | null;
  listPriceEurCents: number | null;
  monthlyOperatingCostEurCents: number | null;
  reserveFundEurCents: number | null;
  commissionEurCents: number | null;
  livingAreaSqm: number | null;
  usableAreaSqm: number | null;
  balconyAreaSqm: number | null;
  terraceAreaSqm: number | null;
  gardenAreaSqm: number | null;
  rooms: number | null;
  floorLabel: string | null;
  floorNumber: number | null;
  yearBuilt: number | null;
  conditionCategory: string | null;
  heatingType: string | null;
  energyCertificateClass: string | null;
  hasBalcony: boolean | null;
  hasTerrace: boolean | null;
  hasGarden: boolean | null;
  hasElevator: boolean | null;
  parkingAvailable: boolean | null;
  isFurnished: boolean | null;
  pricePerSqmEur: number | null;
  completenessScore: number;
  currentScore: number | null;
  normalizationVersion: number;
  contentFingerprint: string;
  normalizedPayload: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstPublishedAt: Date | null;
  lastPriceChangeAt: Date | null;
  lastContentChangeAt: Date | null;
  lastStatusChangeAt: Date | null;
  lastScoredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

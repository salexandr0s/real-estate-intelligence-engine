import type {
  GeocodePrecision,
  ListingStatus,
  OperationType,
  PropertyType,
  VersionReason,
} from './domain.js';

/**
 * Bump this when normalization logic changes in a way that alters content fingerprints.
 * The pipeline uses this to distinguish "source content changed" from "our parsing improved".
 */
export const CURRENT_NORMALIZATION_VERSION = 1;

// ── Canonical Listing Input ─────────────────────────────────────────────────

export interface CanonicalListingInput {
  sourceId: number;
  sourceListingKey: string;
  sourceExternalId?: string | null;
  currentRawListingId: number;
  latestScrapeRunId: number;
  canonicalUrl: string;

  operationType: OperationType;
  propertyType: PropertyType;
  propertySubtype?: string | null;
  listingStatus: ListingStatus;

  title: string;
  description?: string | null;
  sourceStatusRaw?: string | null;

  city: string;
  federalState?: string | null;
  postalCode?: string | null;
  districtNo?: number | null;
  districtName?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  addressDisplay?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocodePrecision?: GeocodePrecision | null;

  listPriceEurCents?: number | null;
  monthlyOperatingCostEurCents?: number | null;
  reserveFundEurCents?: number | null;
  commissionEurCents?: number | null;

  livingAreaSqm?: number | null;
  usableAreaSqm?: number | null;
  balconyAreaSqm?: number | null;
  terraceAreaSqm?: number | null;
  gardenAreaSqm?: number | null;
  rooms?: number | null;
  floorLabel?: string | null;
  floorNumber?: number | null;
  yearBuilt?: number | null;
  conditionCategory?: string | null;
  heatingType?: string | null;
  energyCertificateClass?: string | null;

  hasBalcony?: boolean | null;
  hasTerrace?: boolean | null;
  hasGarden?: boolean | null;
  hasElevator?: boolean | null;
  parkingAvailable?: boolean | null;
  isFurnished?: boolean | null;

  crossSourceFingerprint?: string | null;

  normalizedPayload: Record<string, unknown>;
  completenessScore: number;
  contentFingerprint: string;
  normalizationVersion: number;
}

// ── Normalization Result ────────────────────────────────────────────────────

export interface NormalizationWarning {
  field: string;
  code: string;
  message: string;
  rawValue?: unknown;
}

export interface NormalizationResult {
  success: boolean;
  listing: CanonicalListingInput | null;
  warnings: NormalizationWarning[];
  errors: string[];
  provenance: Record<string, string>;
  versionReason: VersionReason | null;
}

// ── Source DTO Shape (generic base) ─────────────────────────────────────────

export interface SourceRawListingBase {
  titleRaw?: string | null;
  descriptionRaw?: string | null;
  priceRaw?: string | number | null;
  livingAreaRaw?: string | number | null;
  usableAreaRaw?: string | number | null;
  roomsRaw?: string | number | null;
  addressRaw?: string | null;
  postalCodeRaw?: string | null;
  districtRaw?: string | null;
  cityRaw?: string | null;
  federalStateRaw?: string | null;
  streetRaw?: string | null;
  houseNumberRaw?: string | null;
  latRaw?: string | number | null;
  lonRaw?: string | number | null;
  propertyTypeRaw?: string | null;
  propertySubtypeRaw?: string | null;
  operationTypeRaw?: string | null;
  statusRaw?: string | null;
  floorRaw?: string | number | null;
  yearBuiltRaw?: string | number | null;
  roomsCountRaw?: string | number | null;
  balconyAreaRaw?: string | number | null;
  terraceAreaRaw?: string | number | null;
  gardenAreaRaw?: string | number | null;
  commissionRaw?: string | number | null;
  operatingCostRaw?: string | number | null;
  reserveFundRaw?: string | number | null;
  heatingTypeRaw?: string | null;
  conditionRaw?: string | null;
  energyCertificateRaw?: string | null;
  attributesRaw?: Record<string, unknown>;
  mediaRaw?: unknown[];
}

// ── Normalizer Interface ────────────────────────────────────────────────────

export interface SourceNormalizer<TSourceDTO extends SourceRawListingBase = SourceRawListingBase> {
  readonly sourceCode: string;
  readonly normalizationVersion: number;
  normalize(rawPayload: TSourceDTO, context: NormalizationContext): NormalizationResult;
}

export interface NormalizationContext {
  sourceId: number;
  sourceListingKey: string;
  sourceExternalId?: string | null;
  rawListingId: number;
  scrapeRunId: number;
  canonicalUrl: string;
  detailUrl: string;
}

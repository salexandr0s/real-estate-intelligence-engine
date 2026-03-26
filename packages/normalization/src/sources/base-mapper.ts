import type {
  CanonicalListingInput,
  ListingStatus,
  NormalizationContext,
  NormalizationResult,
  NormalizationWarning,
  SourceNormalizer,
  SourceRawListingBase,
  OperationType,
  PropertyType,
} from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';
import {
  parseEurPrice,
  parseSqm,
  parseRooms,
  parseBoolean,
  parseYear,
  parseFloor,
  normalizeWhitespace,
} from '../canonical/coerce.js';
import { computeCompletenessScore } from '../canonical/completeness.js';
import {
  computeContentFingerprint,
  computeCrossSourceFingerprint,
} from '../canonical/fingerprint.js';
import { resolveDistrict, postalCodeToDistrict } from '../district/lookup.js';
import { normalizePropertyType, normalizeOperationType } from '../canonical/property-type.js';

const logger = createLogger('normalization');

const NORMALIZATION_VERSION = 2;

/**
 * Maps source-reported availability strings to canonical listing statuses.
 * Supports both English and German terms.
 */
const SOURCE_STATUS_MAP: Record<string, ListingStatus> = {
  active: 'active',
  available: 'active',
  sold: 'sold',
  verkauft: 'sold',
  rented: 'rented',
  vermietet: 'rented',
  reserved: 'unknown',
  reserviert: 'unknown',
  removed: 'withdrawn',
  deleted: 'withdrawn',
  inactive: 'inactive',
  blocked: 'unknown',
  not_found: 'withdrawn',
};

/**
 * Resolves a raw source status string to a canonical ListingStatus.
 * Returns 'active' when the input is null/undefined/empty (new listing assumed active).
 * Returns 'unknown' for unrecognised non-empty values to avoid false positives.
 */
export function resolveListingStatus(rawStatusInput: string | null | undefined): ListingStatus {
  if (rawStatusInput == null) return 'active';
  const normalized = rawStatusInput.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized === '') return 'active';
  return SOURCE_STATUS_MAP[normalized] ?? 'unknown';
}

/**
 * Hard-fail fields: normalization fails if these are missing after mapping.
 */
const _HARD_FAIL_FIELDS = [
  'sourceListingKey',
  'canonicalUrl',
  'operationType',
  'propertyType',
  'title',
] as const;

/**
 * Base normalizer that implements the SourceNormalizer interface.
 * Source-specific mappers extend this class and override field extraction.
 */
export class BaseSourceMapper implements SourceNormalizer {
  readonly sourceCode: string;
  readonly normalizationVersion = NORMALIZATION_VERSION;

  constructor(sourceCode: string) {
    this.sourceCode = sourceCode;
  }

  normalize(rawPayload: SourceRawListingBase, context: NormalizationContext): NormalizationResult {
    const warnings: NormalizationWarning[] = [];
    const errors: string[] = [];
    const provenance: Record<string, string> = {};

    try {
      // ── Step 1: Coerce all raw fields ──
      const title = normalizeWhitespace(rawPayload.titleRaw);
      const description = normalizeWhitespace(rawPayload.descriptionRaw);

      // Price
      const priceResult = parseEurPrice(rawPayload.priceRaw);
      if (priceResult.warning) warnings.push(priceResult.warning);
      provenance['price'] = rawPayload.priceRaw != null ? 'payload.priceRaw' : 'missing';

      // Areas
      const livingAreaResult = parseSqm(rawPayload.livingAreaRaw);
      if (livingAreaResult.warning) warnings.push(livingAreaResult.warning);
      provenance['livingArea'] =
        rawPayload.livingAreaRaw != null ? 'payload.livingAreaRaw' : 'missing';

      const usableAreaResult = parseSqm(rawPayload.usableAreaRaw);
      if (usableAreaResult.warning) warnings.push(usableAreaResult.warning);

      const balconyAreaResult = parseSqm(rawPayload.balconyAreaRaw);
      if (balconyAreaResult.warning) warnings.push(balconyAreaResult.warning);

      const terraceAreaResult = parseSqm(rawPayload.terraceAreaRaw);
      if (terraceAreaResult.warning) warnings.push(terraceAreaResult.warning);

      const gardenAreaResult = parseSqm(rawPayload.gardenAreaRaw);
      if (gardenAreaResult.warning) warnings.push(gardenAreaResult.warning);

      // Rooms
      const roomsResult = parseRooms(rawPayload.roomsRaw ?? rawPayload.roomsCountRaw);
      if (roomsResult.warning) warnings.push(roomsResult.warning);
      provenance['rooms'] =
        (rawPayload.roomsRaw ?? rawPayload.roomsCountRaw) != null ? 'payload.roomsRaw' : 'missing';

      // Floor
      const floorResult = parseFloor(rawPayload.floorRaw);
      if (floorResult.warning) warnings.push(floorResult.warning);

      // Year built
      const yearResult = parseYear(rawPayload.yearBuiltRaw);
      if (yearResult.warning) warnings.push(yearResult.warning);

      // Costs
      const operatingCostResult = parseEurPrice(rawPayload.operatingCostRaw);
      if (operatingCostResult.warning) warnings.push(operatingCostResult.warning);

      const reserveFundResult = parseEurPrice(rawPayload.reserveFundRaw);
      if (reserveFundResult.warning) warnings.push(reserveFundResult.warning);

      const commissionResult = parseEurPrice(rawPayload.commissionRaw);
      if (commissionResult.warning) warnings.push(commissionResult.warning);

      // Booleans (from attributes or explicit fields)
      const attrs = rawPayload.attributesRaw ?? {};
      const hasBalcony =
        parseBoolean(
          (attrs['balkon'] as string | undefined) ?? (attrs['balcony'] as string | undefined),
        ) ?? (balconyAreaResult.value != null && balconyAreaResult.value > 0 ? true : null);
      const hasTerrace =
        parseBoolean(
          (attrs['terrasse'] as string | undefined) ?? (attrs['terrace'] as string | undefined),
        ) ?? (terraceAreaResult.value != null && terraceAreaResult.value > 0 ? true : null);
      const hasGarden =
        parseBoolean(
          (attrs['garten'] as string | undefined) ?? (attrs['garden'] as string | undefined),
        ) ?? (gardenAreaResult.value != null && gardenAreaResult.value > 0 ? true : null);
      const hasElevator = parseBoolean(
        (attrs['aufzug'] as string | undefined) ??
          (attrs['lift'] as string | undefined) ??
          (attrs['elevator'] as string | undefined),
      );
      const parkingAvailable = parseBoolean(
        (attrs['parkplatz'] as string | undefined) ??
          (attrs['parking'] as string | undefined) ??
          (attrs['garage'] as string | undefined),
      );
      const isFurnished = parseBoolean(
        (attrs['möbliert'] as string | undefined) ??
          (attrs['furnished'] as string | undefined) ??
          (attrs['moebliert'] as string | undefined),
      );

      // ── Step 2: Property type normalization ──
      const propertyTypeResult = normalizePropertyType(rawPayload.propertyTypeRaw);
      const propertyType: PropertyType = propertyTypeResult?.propertyType ?? 'other';
      const propertySubtype: string | null =
        rawPayload.propertySubtypeRaw ?? propertyTypeResult?.propertySubtype ?? null;
      if (!propertyTypeResult && rawPayload.propertyTypeRaw != null) {
        warnings.push({
          field: 'propertyType',
          code: 'property_type_unmapped',
          message: `Could not map property type: "${rawPayload.propertyTypeRaw}"`,
          rawValue: rawPayload.propertyTypeRaw,
        });
      }

      // ── Step 3: Operation type normalization ──
      const operationType: OperationType | null = normalizeOperationType(
        rawPayload.operationTypeRaw,
      );
      if (operationType == null && rawPayload.operationTypeRaw != null) {
        warnings.push({
          field: 'operationType',
          code: 'operation_type_unmapped',
          message: `Could not map operation type: "${rawPayload.operationTypeRaw}"`,
          rawValue: rawPayload.operationTypeRaw,
        });
      }

      // ── Step 4: District resolution ──
      const districtResolution = resolveDistrict({
        postalCode: rawPayload.postalCodeRaw,
        districtRaw: rawPayload.districtRaw,
        addressRaw: rawPayload.addressRaw,
        cityRaw: rawPayload.cityRaw,
      });
      for (const w of districtResolution.warnings) {
        warnings.push({
          field: 'district',
          code: 'district_resolution_warning',
          message: w,
        });
      }
      provenance['district'] =
        districtResolution.districtNo != null
          ? `inferred (confidence: ${districtResolution.confidence})`
          : 'not_resolved';

      // ── Step 4b: Vienna gate — reject non-Vienna listings ──
      const postalRaw = rawPayload.postalCodeRaw?.trim() ?? null;
      const cityRaw = rawPayload.cityRaw?.trim() ?? null;
      const isViennaPostal = postalRaw != null && postalCodeToDistrict(postalRaw) != null;
      const isViennaByCity = cityRaw != null && ['wien', 'vienna'].includes(cityRaw.toLowerCase());

      if (postalRaw != null && !isViennaPostal && !isViennaByCity) {
        logger.debug('Skipping non-Vienna listing', { postalCode: postalRaw, city: cityRaw });
        return {
          success: false,
          listing: null,
          warnings: [
            {
              field: 'location',
              code: 'non_vienna_listing',
              message: `Skipped: postal code ${postalRaw} is not in Vienna (1010-1230)`,
            },
          ],
          errors: [],
          provenance,
          versionReason: null,
        };
      }

      // ── Step 5: Location fields ──
      const city = normalizeWhitespace(rawPayload.cityRaw) ?? 'Wien';
      const postalCode = rawPayload.postalCodeRaw?.trim() ?? null;
      const street = normalizeWhitespace(rawPayload.streetRaw);
      const houseNumber = normalizeWhitespace(rawPayload.houseNumberRaw);
      const federalState = normalizeWhitespace(rawPayload.federalStateRaw);

      // Coordinates
      let latitude: number | null = null;
      let longitude: number | null = null;
      if (rawPayload.latRaw != null && rawPayload.lonRaw != null) {
        const lat =
          typeof rawPayload.latRaw === 'number'
            ? rawPayload.latRaw
            : parseFloat(String(rawPayload.latRaw));
        const lon =
          typeof rawPayload.lonRaw === 'number'
            ? rawPayload.lonRaw
            : parseFloat(String(rawPayload.lonRaw));
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          lat >= -90 &&
          lat <= 90 &&
          lon >= -180 &&
          lon <= 180
        ) {
          latitude = lat;
          longitude = lon;
        }
      }

      // ── Step 6: Compute price per sqm ──
      let pricePerSqmEur: number | null = null;
      const effectiveArea = livingAreaResult.value ?? usableAreaResult.value;
      if (priceResult.value != null && effectiveArea != null && effectiveArea > 0) {
        pricePerSqmEur = Math.round((priceResult.value / 100 / effectiveArea) * 100) / 100;
      }

      // ── Step 7: Derive listing status from source availability ──
      const listingStatus: ListingStatus = resolveListingStatus(rawPayload.statusRaw);

      // ── Step 8: Build canonical listing ──
      const listing: CanonicalListingInput = {
        sourceId: context.sourceId,
        sourceListingKey: context.sourceListingKey,
        sourceExternalId: context.sourceExternalId,
        currentRawListingId: context.rawListingId,
        latestScrapeRunId: context.scrapeRunId,
        canonicalUrl: context.canonicalUrl,

        operationType: operationType ?? 'sale',
        propertyType,
        propertySubtype,
        listingStatus,

        title: title ?? '',
        description,
        sourceStatusRaw: rawPayload.statusRaw ?? null,

        city,
        federalState,
        postalCode,
        districtNo: districtResolution.districtNo,
        districtName: districtResolution.districtName,
        street,
        houseNumber,
        addressDisplay: buildAddressDisplay(street, houseNumber, postalCode, city),
        latitude,
        longitude,
        geocodePrecision: latitude != null ? 'source_approx' : null,

        listPriceEurCents: priceResult.value,
        monthlyOperatingCostEurCents: operatingCostResult.value,
        reserveFundEurCents: reserveFundResult.value,
        commissionEurCents: commissionResult.value,

        livingAreaSqm: livingAreaResult.value,
        usableAreaSqm: usableAreaResult.value,
        balconyAreaSqm: balconyAreaResult.value,
        terraceAreaSqm: terraceAreaResult.value,
        gardenAreaSqm: gardenAreaResult.value,
        rooms: roomsResult.value,
        floorLabel: floorResult.label,
        floorNumber: floorResult.value,
        yearBuilt: yearResult.value,
        conditionCategory: normalizeWhitespace(rawPayload.conditionRaw),
        heatingType: normalizeWhitespace(rawPayload.heatingTypeRaw),
        energyCertificateClass: normalizeWhitespace(rawPayload.energyCertificateRaw),
        contactName: normalizeWhitespace(rawPayload.contactNameRaw),
        contactCompany: normalizeWhitespace(rawPayload.contactCompanyRaw),
        contactEmail: normalizeWhitespace(rawPayload.contactEmailRaw),
        contactPhone: normalizeWhitespace(rawPayload.contactPhoneRaw),

        hasBalcony,
        hasTerrace,
        hasGarden,
        hasElevator,
        parkingAvailable,
        isFurnished,

        normalizedPayload: {
          provenance,
          sourceCode: this.sourceCode,
          pricePerSqmEur,
          contact: {
            name: normalizeWhitespace(rawPayload.contactNameRaw),
            company: normalizeWhitespace(rawPayload.contactCompanyRaw),
            email: normalizeWhitespace(rawPayload.contactEmailRaw),
            phone: normalizeWhitespace(rawPayload.contactPhoneRaw),
          },
        },
        completenessScore: 0, // computed below
        contentFingerprint: '', // computed below
        normalizationVersion: this.normalizationVersion,
      };

      // ── Step 9: Completeness score ──
      listing.completenessScore = computeCompletenessScore(listing);

      // ── Step 10: Content fingerprint ──
      listing.contentFingerprint = computeContentFingerprint(listing);

      // ── Step 10b: Cross-source fingerprint ──
      listing.crossSourceFingerprint = computeCrossSourceFingerprint(listing);

      // ── Step 11: Hard-fail validation ──
      if (!title || title.trim() === '') {
        errors.push('missing_title');
      }
      if (operationType == null) {
        errors.push('missing_operation_type');
      }
      if (!context.canonicalUrl || context.canonicalUrl.trim() === '') {
        errors.push('missing_canonical_url');
      }
      if (!context.sourceListingKey || context.sourceListingKey.trim() === '') {
        errors.push('missing_source_listing_key');
      }

      // Location: need at least one usable hint
      if (!city || (postalCode == null && districtResolution.districtNo == null)) {
        warnings.push({
          field: 'location',
          code: 'location_weak',
          message: 'No postal code or district resolved; location confidence is low',
        });
      }

      if (errors.length > 0) {
        logger.warn('normalization hard-fail', {
          listingKey: context.sourceListingKey,
          errorClass: 'normalization_error',
        });
        return {
          success: false,
          listing: null,
          warnings,
          errors,
          provenance,
          versionReason: null,
        };
      }

      return {
        success: true,
        listing,
        warnings,
        errors: [],
        provenance,
        versionReason: 'first_seen',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('normalization exception', {
        listingKey: context.sourceListingKey,
        errorClass: 'normalization_exception',
      });
      return {
        success: false,
        listing: null,
        warnings,
        errors: [`normalization_exception: ${message}`],
        provenance,
        versionReason: null,
      };
    }
  }
}

/**
 * Builds a human-readable address display string.
 */
function buildAddressDisplay(
  street: string | null,
  houseNumber: string | null,
  postalCode: string | null,
  city: string | null,
): string | null {
  const parts: string[] = [];

  if (street) {
    parts.push(houseNumber ? `${street} ${houseNumber}` : street);
  }

  if (postalCode || city) {
    const locationPart = [postalCode, city].filter(Boolean).join(' ');
    parts.push(locationPart);
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

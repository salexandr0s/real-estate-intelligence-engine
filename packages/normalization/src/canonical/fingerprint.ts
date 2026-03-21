import { createHash } from 'node:crypto';
import type { CanonicalListingInput } from '@rei/contracts';

// ── Cross-Source Fingerprint ─────────────────────────────────────────────────

/**
 * Fields used to identify the same property across different sources.
 * Uses normalized address + area + price (rounded to nearest 1000 EUR).
 */
interface CrossSourceFields {
  addressNormalized: string | null;
  livingAreaSqmRounded: number | null;
  priceRoundedEur: number | null;
}

/**
 * Computes a SHA-256 cross-source fingerprint from normalized address,
 * living area, and price (rounded to nearest 1000 EUR).
 *
 * Returns a hex string, or null if insufficient data (needs at least
 * address + one of area or price).
 */
export function computeCrossSourceFingerprint(
  listing: Partial<CanonicalListingInput>,
): string | null {
  const address = buildNormalizedAddress(listing);
  if (!address) return null;

  const area = listing.livingAreaSqm ?? null;
  const priceCents = listing.listPriceEurCents ?? null;

  // Need address plus at least one of area or price
  if (area == null && priceCents == null) return null;

  const fields: CrossSourceFields = {
    addressNormalized: address,
    livingAreaSqmRounded: area != null ? Math.round(area) : null,
    priceRoundedEur: priceCents != null ? Math.round(priceCents / 100 / 1000) * 1000 : null,
  };

  const json = JSON.stringify(fields, Object.keys(fields).sort());
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Builds a normalized address string from available location fields.
 * Returns null if no usable address components exist.
 */
function buildNormalizedAddress(listing: Partial<CanonicalListingInput>): string | null {
  const parts: string[] = [];

  if (listing.street) {
    parts.push(listing.street.toLowerCase().trim());
  }
  if (listing.houseNumber) {
    parts.push(listing.houseNumber.toLowerCase().trim());
  }
  if (listing.postalCode) {
    parts.push(listing.postalCode.trim());
  }
  if (listing.city) {
    parts.push(listing.city.toLowerCase().trim());
  }

  // Need at least city/postal + street for a meaningful address
  if (parts.length < 2) return null;

  return parts.join('|');
}

/**
 * Fields included in the content fingerprint.
 * These are fields that materially affect investment decisions.
 * Excludes: timestamps, crawl IDs, artifact keys, raw data.
 */
interface FingerprintFields {
  title: string | null;
  description: string | null;
  listPriceEurCents: number | null;
  livingAreaSqm: number | null;
  usableAreaSqm: number | null;
  rooms: number | null;
  propertyType: string | null;
  propertySubtype: string | null;
  districtNo: number | null;
  postalCode: string | null;
  city: string | null;
  hasBalcony: boolean | null;
  hasTerrace: boolean | null;
  hasGarden: boolean | null;
  hasElevator: boolean | null;
  parkingAvailable: boolean | null;
  isFurnished: boolean | null;
  listingStatus: string | null;
}

/**
 * Computes a SHA-256 content fingerprint from canonical listing fields.
 * Uses deterministic JSON serialization of investment-relevant fields.
 * Returns a "sha256:<hex>" string.
 */
export function computeContentFingerprint(listing: Partial<CanonicalListingInput>): string {
  const fields: FingerprintFields = {
    title: listing.title ?? null,
    description: listing.description ?? null,
    listPriceEurCents: listing.listPriceEurCents ?? null,
    livingAreaSqm: listing.livingAreaSqm ?? null,
    usableAreaSqm: listing.usableAreaSqm ?? null,
    rooms: listing.rooms ?? null,
    propertyType: listing.propertyType ?? null,
    propertySubtype: listing.propertySubtype ?? null,
    districtNo: listing.districtNo ?? null,
    postalCode: listing.postalCode ?? null,
    city: listing.city ?? null,
    hasBalcony: listing.hasBalcony ?? null,
    hasTerrace: listing.hasTerrace ?? null,
    hasGarden: listing.hasGarden ?? null,
    hasElevator: listing.hasElevator ?? null,
    parkingAvailable: listing.parkingAvailable ?? null,
    isFurnished: listing.isFurnished ?? null,
    listingStatus: listing.listingStatus ?? null,
  };

  // Deterministic JSON: sorted keys, no undefined
  const json = JSON.stringify(fields, Object.keys(fields).sort());
  const hash = createHash('sha256').update(json, 'utf8').digest('hex');
  return hash;
}

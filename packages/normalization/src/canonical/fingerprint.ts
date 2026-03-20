import { createHash } from 'node:crypto';
import type { CanonicalListingInput } from '@rei/contracts';

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
  return `sha256:${hash}`;
}

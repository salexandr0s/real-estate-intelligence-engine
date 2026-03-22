/**
 * Tiered geocoding strategy for Vienna real estate listings.
 *
 * Priority order:
 * 1. Skip if listing already has coordinates (source_exact / source_approx)
 * 2. Street + postal code → Nominatim (precision: street)
 * 3. Postal code → district centroid (precision: district)
 * 4. District number → district centroid (precision: district)
 * 5. City only → city centroid (precision: city)
 */

import type { GeocodePrecision } from '@rei/contracts';
import { geocodeAddress, type GeocodingResult } from './nominatim-client.js';
import {
  VIENNA_CENTER,
  VIENNA_DISTRICT_CENTROIDS,
  postalCodeToDistrictNo,
} from './vienna-centroids.js';

export interface GeocodingInput {
  listingId: number;
  address: string | null;
  postalCode: string | null;
  city: string;
  districtNo: number | null;
  existingLatitude: number | null;
  existingLongitude: number | null;
  existingPrecision: GeocodePrecision | null;
}

export interface GeocodingOutput {
  latitude: number;
  longitude: number;
  geocodePrecision: GeocodePrecision;
  source: 'skip' | 'nominatim' | 'centroid';
}

/**
 * Geocode a listing using the tiered strategy.
 * Returns null only if all tiers fail (should be rare for Vienna).
 */
export async function geocodeListing(input: GeocodingInput): Promise<GeocodingOutput | null> {
  // Tier 0: Skip if already geocoded with source-level precision
  if (
    input.existingLatitude != null &&
    input.existingLongitude != null &&
    input.existingPrecision != null &&
    input.existingPrecision !== 'none'
  ) {
    return {
      latitude: input.existingLatitude,
      longitude: input.existingLongitude,
      geocodePrecision: input.existingPrecision,
      source: 'skip',
    };
  }

  // Tier 1: Nominatim with street address
  if (input.address && input.address.trim().length > 0) {
    const result = await geocodeAddress({
      street: input.address,
      postalCode: input.postalCode ?? undefined,
      city: input.city,
    });
    if (result) return nominatimToOutput(result);
  }

  // Tier 2: Nominatim with postal code only (no street)
  if (input.postalCode) {
    const result = await geocodeAddress({
      postalCode: input.postalCode,
      city: input.city,
    });
    if (result) return nominatimToOutput(result);
  }

  // Tier 3: District centroid from postal code
  if (input.postalCode) {
    const districtNo = postalCodeToDistrictNo(input.postalCode);
    if (districtNo) {
      const centroid = VIENNA_DISTRICT_CENTROIDS[districtNo];
      if (centroid) {
        return {
          latitude: centroid.lat,
          longitude: centroid.lon,
          geocodePrecision: 'district',
          source: 'centroid',
        };
      }
    }
  }

  // Tier 4: District centroid from district number
  if (input.districtNo) {
    const centroid = VIENNA_DISTRICT_CENTROIDS[input.districtNo];
    if (centroid) {
      return {
        latitude: centroid.lat,
        longitude: centroid.lon,
        geocodePrecision: 'district',
        source: 'centroid',
      };
    }
  }

  // Tier 5: City centroid (Vienna center)
  if (input.city.toLowerCase().includes('wien')) {
    return {
      latitude: VIENNA_CENTER.lat,
      longitude: VIENNA_CENTER.lon,
      geocodePrecision: 'city',
      source: 'centroid',
    };
  }

  return null;
}

function nominatimToOutput(result: GeocodingResult): GeocodingOutput {
  return {
    latitude: result.lat,
    longitude: result.lon,
    geocodePrecision: result.precision,
    source: 'nominatim',
  };
}

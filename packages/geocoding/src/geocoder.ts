/**
 * Tiered geocoding strategy for Vienna real estate listings.
 *
 * Priority order:
 * 0. Skip if listing already has coordinates (source_exact / source_approx)
 * 1. Street + postal code → Nominatim (precision: street)
 * 2. NLP street extraction from text → Nominatim (precision: street)
 * 3. NLP U-Bahn station match from text → direct coords (precision: street)
 * 4. Postal code → Nominatim (precision: postal_code)
 * 5. District centroid from postal code (precision: district)
 * 6. District centroid from district number (precision: district)
 * 7. NLP district extraction from text → centroid (precision: district)
 * 8. City only → city centroid (precision: city)
 */

import type { GeocodePrecision } from '@immoradar/contracts';
import { geocodeAddress, type GeocodingResult } from './nominatim-client.js';
import {
  VIENNA_CENTER,
  VIENNA_DISTRICT_CENTROIDS,
  postalCodeToDistrictNo,
} from './vienna-centroids.js';
import { extractLocationSignals, type TextExtractionInput } from './text-extractor.js';

export interface GeocodingInput {
  listingId: number;
  address: string | null;
  postalCode: string | null;
  city: string;
  districtNo: number | null;
  existingLatitude: number | null;
  existingLongitude: number | null;
  existingPrecision: GeocodePrecision | null;
  /** Listing title for NLP extraction */
  title: string | null;
  /** Listing description for NLP extraction */
  description: string | null;
  /** Address display string for NLP extraction */
  addressDisplay: string | null;
}

export interface GeocodingOutput {
  latitude: number;
  longitude: number;
  geocodePrecision: GeocodePrecision;
  source: 'skip' | 'nominatim' | 'nlp_nominatim' | 'nlp_station' | 'centroid';
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

  // Tier 1: Nominatim with street address (from structured data)
  if (input.address && input.address.trim().length > 0) {
    const result = await geocodeAddress({
      street: input.address,
      postalCode: input.postalCode ?? undefined,
      city: input.city,
    });
    if (result) return nominatimToOutput(result);
  }

  // Extract NLP signals from text (title, addressDisplay, description)
  const textInput: TextExtractionInput = {
    title: input.title,
    description: input.description,
    addressDisplay: input.addressDisplay,
  };
  const signals = extractLocationSignals(textInput);

  // Tier 2: NLP street extraction → Nominatim
  // If multiple streets found, geocode all and triangulate (centroid)
  if (signals.streets.length > 0) {
    const geocodedPoints: Array<{ lat: number; lon: number }> = [];
    for (const street of signals.streets.slice(0, 5)) {
      const result = await geocodeAddress({
        street: street.fullAddress,
        postalCode: input.postalCode ?? undefined,
        city: input.city,
      });
      if (result) {
        geocodedPoints.push({ lat: result.lat, lon: result.lon });
      }
    }

    if (geocodedPoints.length === 1) {
      return {
        latitude: geocodedPoints[0]!.lat,
        longitude: geocodedPoints[0]!.lon,
        geocodePrecision: 'street',
        source: 'nlp_nominatim',
      };
    }
    if (geocodedPoints.length >= 2) {
      const centroid = computeCentroid(geocodedPoints);
      return {
        latitude: centroid.lat,
        longitude: centroid.lon,
        geocodePrecision: 'estimated',
        source: 'nlp_nominatim',
      };
    }
  }

  // Tier 3: NLP U-Bahn station match (no API call)
  // If multiple stations found, triangulate
  if (signals.stations.length > 0) {
    if (signals.stations.length === 1) {
      const station = signals.stations[0]!;
      return {
        latitude: station.latitude,
        longitude: station.longitude,
        geocodePrecision: 'street',
        source: 'nlp_station',
      };
    }
    const centroid = computeCentroid(
      signals.stations.map((s) => ({ lat: s.latitude, lon: s.longitude })),
    );
    return {
      latitude: centroid.lat,
      longitude: centroid.lon,
      geocodePrecision: 'estimated',
      source: 'nlp_station',
    };
  }

  // Tier 4: Nominatim with postal code only (no street)
  if (input.postalCode) {
    const result = await geocodeAddress({
      postalCode: input.postalCode,
      city: input.city,
    });
    if (result) return nominatimToOutput(result);
  }

  // Tier 5: District centroid from postal code
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

  // Tier 6: District centroid from district number
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

  // Tier 7: NLP district extraction from text → centroid
  // Only useful if districtNo was null (otherwise Tier 6 already ran)
  if (!input.districtNo && signals.districts.length > 0) {
    const district = signals.districts[0]!;
    const centroid = VIENNA_DISTRICT_CENTROIDS[district.districtNo];
    if (centroid) {
      return {
        latitude: centroid.lat,
        longitude: centroid.lon,
        geocodePrecision: 'district',
        source: 'centroid',
      };
    }
  }

  // Tier 8: City centroid (Vienna center)
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

/**
 * Compute the geographic centroid of multiple points.
 * Used for triangulation when multiple streets or stations are mentioned.
 */
function computeCentroid(points: Array<{ lat: number; lon: number }>): {
  lat: number;
  lon: number;
} {
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }), {
    lat: 0,
    lon: 0,
  });
  return {
    lat: sum.lat / points.length,
    lon: sum.lon / points.length,
  };
}

/**
 * Nominatim (OpenStreetMap) geocoding client.
 * Free, no API key required. Rate limit: 1 request/second.
 * https://nominatim.org/release-docs/develop/api/Search/
 */

import type { GeocodePrecision } from '@immoradar/contracts';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'ImmoRadar/0.1 (geocoding)';

interface NominatimResult {
  lat: string;
  lon: string;
  type: string;
  importance: number;
  display_name: string;
}

export interface GeocodingResult {
  lat: number;
  lon: number;
  precision: GeocodePrecision;
  displayName: string;
}

/**
 * Geocode an address using Nominatim's structured search.
 * Returns null if no result found or on error.
 */
export async function geocodeAddress(opts: {
  street?: string;
  postalCode?: string;
  city: string;
  country?: string;
}): Promise<GeocodingResult | null> {
  const params = new URLSearchParams({
    format: 'json',
    limit: '1',
    countrycodes: opts.country ?? 'at',
    city: opts.city,
  });

  if (opts.street) params.set('street', opts.street);
  if (opts.postalCode) params.set('postalcode', opts.postalCode);

  try {
    const url = `${NOMINATIM_BASE}/search?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const results = (await response.json()) as NominatimResult[];
    if (results.length === 0) return null;

    const result = results[0]!;
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);

    if (isNaN(lat) || isNaN(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    // Determine precision from result type
    const precision = inferPrecision(result.type, !!opts.street);

    return { lat, lon, precision, displayName: result.display_name };
  } catch {
    return null;
  }
}

function inferPrecision(resultType: string, hadStreet: boolean): GeocodePrecision {
  // Nominatim types that indicate street-level precision
  const streetTypes = new Set(['house', 'building', 'residential', 'apartments', 'house_number']);
  if (streetTypes.has(resultType) || (hadStreet && resultType !== 'postcode')) {
    return 'street';
  }
  return 'district';
}

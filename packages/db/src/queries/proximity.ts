import type { ProximityInput } from '@immoradar/contracts';
import { findNearby } from './pois.js';

/**
 * Compute proximity data for a geocoded listing.
 * Queries nearby POIs within 2km and aggregates into the shape
 * expected by the scoring engine's location score formula.
 */
export async function computeProximity(
  latitude: number,
  longitude: number,
): Promise<ProximityInput> {
  const nearby = await findNearby(latitude, longitude, 2000); // 2km radius for hospitals

  const nearestUbahn = nearby.find((p) => p.category === 'ubahn');
  const nearestTram = nearby.find((p) => p.category === 'tram');
  const nearestBus = nearby.find((p) => p.category === 'bus');

  return {
    nearestUbahnDistanceM: nearestUbahn?.distanceM ?? null,
    nearestTramDistanceM: nearestTram?.distanceM ?? null,
    nearestBusDistanceM: nearestBus?.distanceM ?? null,
    parksWithin500m: nearby.filter((p) => p.category === 'park' && p.distanceM <= 500).length,
    schoolsWithin500m: nearby.filter((p) => p.category === 'school' && p.distanceM <= 500).length,
    policeWithin1000m: nearby.filter((p) => p.category === 'police' && p.distanceM <= 1000).length,
    fireStationsWithin1000m: nearby.filter(
      (p) => p.category === 'fire_station' && p.distanceM <= 1000,
    ).length,
    supermarketsWithin500m: nearby.filter((p) => p.category === 'supermarket' && p.distanceM <= 500)
      .length,
    hospitalsWithin2000m: nearby.filter((p) => p.category === 'hospital' && p.distanceM <= 2000)
      .length,
    doctorsWithin500m: nearby.filter((p) => p.category === 'doctor' && p.distanceM <= 500).length,
  };
}

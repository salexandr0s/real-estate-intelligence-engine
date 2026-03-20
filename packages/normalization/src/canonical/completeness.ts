import type { CanonicalListingInput } from '@rei/contracts';

/**
 * Computes a 0-100 completeness score reflecting data quality.
 *
 * Weight breakdown:
 *   - price present:                       20
 *   - area present:                        20
 *   - city/postal/district present:        20
 *   - description present:                 10
 *   - rooms present:                       10
 *   - source key + canonical URL:          10
 *   - amenities/floor/condition present:   10
 *
 * Completeness is NOT the opportunity score. It is a confidence proxy.
 */
export function computeCompletenessScore(listing: Partial<CanonicalListingInput>): number {
  let score = 0;

  // Price present: 20 points
  if (listing.listPriceEurCents != null && listing.listPriceEurCents > 0) {
    score += 20;
  }

  // Area present: 20 points
  if (
    (listing.livingAreaSqm != null && listing.livingAreaSqm > 0) ||
    (listing.usableAreaSqm != null && listing.usableAreaSqm > 0)
  ) {
    score += 20;
  }

  // Location present: 20 points (partial credit)
  let locationPoints = 0;
  if (listing.city != null && listing.city.trim() !== '') {
    locationPoints += 7;
  }
  if (listing.postalCode != null && listing.postalCode.trim() !== '') {
    locationPoints += 7;
  }
  if (listing.districtNo != null || (listing.districtName != null && listing.districtName.trim() !== '')) {
    locationPoints += 6;
  }
  score += Math.min(locationPoints, 20);

  // Description present: 10 points
  if (listing.description != null && listing.description.trim().length > 10) {
    score += 10;
  }

  // Rooms present: 10 points
  if (listing.rooms != null && listing.rooms > 0) {
    score += 10;
  }

  // Source key + canonical URL: 10 points
  let identityPoints = 0;
  if (listing.sourceListingKey != null && listing.sourceListingKey.trim() !== '') {
    identityPoints += 5;
  }
  if (listing.canonicalUrl != null && listing.canonicalUrl.trim() !== '') {
    identityPoints += 5;
  }
  score += identityPoints;

  // Amenities / floor / condition: 10 points (partial credit)
  let amenityPoints = 0;
  if (listing.hasBalcony != null || listing.hasTerrace != null || listing.hasGarden != null) {
    amenityPoints += 3;
  }
  if (listing.hasElevator != null || listing.parkingAvailable != null) {
    amenityPoints += 3;
  }
  if (listing.floorNumber != null) {
    amenityPoints += 2;
  }
  if (listing.conditionCategory != null && listing.conditionCategory.trim() !== '') {
    amenityPoints += 2;
  }
  score += Math.min(amenityPoints, 10);

  return Math.min(score, 100);
}

import type { CompiledFilter, OperationType, PropertyType } from '@immoradar/contracts';
import { passesKeywordFilter } from '@immoradar/contracts';

export interface ListingMatchCandidate {
  operationType: OperationType;
  propertyType: PropertyType;
  districtNo: number | null;
  listPriceEurCents: number | null;
  livingAreaSqm: number | null;
  rooms: number | null;
  currentScore: number | null;
  title: string | null;
  description: string | null;
}

export function matchesCompiledFilter(
  listing: ListingMatchCandidate,
  filter: CompiledFilter,
): boolean {
  if (filter.operationType && listing.operationType !== filter.operationType) {
    return false;
  }

  if (filter.propertyTypes?.length && !filter.propertyTypes.includes(listing.propertyType)) {
    return false;
  }

  if (filter.districts?.length) {
    if (listing.districtNo == null || !filter.districts.includes(listing.districtNo)) {
      return false;
    }
  }

  if (filter.minPriceCents != null) {
    if (listing.listPriceEurCents == null || listing.listPriceEurCents < filter.minPriceCents) {
      return false;
    }
  }

  if (filter.maxPriceCents != null) {
    if (listing.listPriceEurCents == null || listing.listPriceEurCents > filter.maxPriceCents) {
      return false;
    }
  }

  if (filter.minAreaSqm != null) {
    if (listing.livingAreaSqm == null || listing.livingAreaSqm < filter.minAreaSqm) {
      return false;
    }
  }

  if (filter.maxAreaSqm != null) {
    if (listing.livingAreaSqm == null || listing.livingAreaSqm > filter.maxAreaSqm) {
      return false;
    }
  }

  if (filter.minRooms != null) {
    if (listing.rooms == null || listing.rooms < filter.minRooms) {
      return false;
    }
  }

  if (filter.maxRooms != null) {
    if (listing.rooms == null || listing.rooms > filter.maxRooms) {
      return false;
    }
  }

  if (filter.minScore != null) {
    if (listing.currentScore == null || listing.currentScore < filter.minScore) {
      return false;
    }
  }

  return passesKeywordFilter(
    listing.title,
    listing.description,
    filter.requiredKeywords ?? [],
    filter.excludedKeywords ?? [],
  );
}

import type { DetailCapture, SourceAvailability } from '@rei/contracts';
import type { DerStandardDetailDTO, DerStandardDetailData } from './dto.js';

/**
 * derstandard.at detail pages embed listing data as JSON in
 * <script id="listing-detail-data">. Parse that to extract all fields.
 */

export function parseDetailPage(
  html: string,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<DerStandardDetailDTO> {
  const scriptMatch = html.match(
    /<script[^>]+id="listing-detail-data"[^>]*>([\s\S]*?)<\/script>/,
  );

  let detailData: DerStandardDetailData | null = null;
  if (scriptMatch?.[1]) {
    try {
      detailData = JSON.parse(scriptMatch[1]) as DerStandardDetailData;
    } catch {
      // parse failed, fall through
    }
  }

  if (!detailData) {
    return buildFailedCapture(url, sourceCode, parserVersion);
  }

  const standardId = String(detailData.id) || extractIdFromUrl(url) || '';
  const addr = detailData.address;
  const coords = detailData.coordinates;
  const contact = detailData.contact;

  const districtRaw = addr?.district
    ? extractDistrictLabel(addr.district)
    : null;

  const features = detailData.features ?? [];
  const hasBalcony = features.some((f) => /balkon|loggia/i.test(f));
  const hasTerrace = features.some((f) => /terrasse|dachterrasse/i.test(f));
  const hasGarden = features.some((f) => /garten/i.test(f));
  const hasElevator = features.some((f) => /lift|aufzug/i.test(f));

  const payload: DerStandardDetailDTO = {
    standardId,
    titleRaw: detailData.title ?? null,
    descriptionRaw: detailData.description ?? null,
    priceRaw: detailData.price != null ? String(detailData.price) : null,
    livingAreaRaw: normalizeDecimal(
      detailData.livingArea != null ? String(detailData.livingArea) : null,
    ),
    usableAreaRaw: normalizeDecimal(
      detailData.usableArea != null ? String(detailData.usableArea) : null,
    ),
    roomsRaw: detailData.rooms != null ? String(detailData.rooms) : null,
    addressRaw: formatAddress(addr),
    postalCodeRaw: addr?.postalCode ?? null,
    districtRaw,
    cityRaw: addr?.city ?? null,
    streetRaw: addr?.street ?? null,
    propertyTypeRaw: detailData.propertyType ?? null,
    propertySubtypeRaw: detailData.subType ?? null,
    operationTypeRaw: 'sale', // derstandard kaufen section is always sale
    statusRaw: detailData.status ?? 'unknown',
    floorRaw: detailData.floor != null ? String(detailData.floor) : null,
    yearBuiltRaw: detailData.yearBuilt != null ? String(detailData.yearBuilt) : null,
    heatingTypeRaw: detailData.heatingType ?? null,
    conditionRaw: detailData.condition ?? null,
    energyCertificateRaw: detailData.energyCertificate ?? null,
    operatingCostRaw:
      detailData.operatingCosts != null ? String(detailData.operatingCosts) : null,
    latRaw: coords?.lat != null ? String(coords.lat) : null,
    lonRaw: coords?.lng != null ? String(coords.lng) : null,
    balconyAreaRaw: null, // derstandard does not provide typed area breakdowns
    terraceAreaRaw: null,
    gardenAreaRaw: null,
    commissionRaw: null,
    reserveFundRaw: null,
    attributesRaw: {
      features,
      hasBalcony,
      hasTerrace,
      hasGarden,
      hasElevator,
    },
    mediaRaw: [],
    images: detailData.images ?? [],
    contactName: contact?.name ?? null,
  };

  return {
    sourceCode,
    sourceListingKeyCandidate: standardId,
    externalId: standardId,
    canonicalUrl: url.split('?')[0] ?? url,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload,
    parserVersion,
    extractionStatus: payload.titleRaw ? 'captured' : 'parse_failed',
  };
}

function buildFailedCapture(
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<DerStandardDetailDTO> {
  return {
    sourceCode,
    sourceListingKeyCandidate: extractIdFromUrl(url) ?? '',
    externalId: extractIdFromUrl(url),
    canonicalUrl: url.split('?')[0] ?? url,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload: {
      standardId: extractIdFromUrl(url) ?? '',
      titleRaw: null,
      descriptionRaw: null,
      priceRaw: null,
      livingAreaRaw: null,
      usableAreaRaw: null,
      roomsRaw: null,
      addressRaw: null,
      postalCodeRaw: null,
      districtRaw: null,
      cityRaw: null,
      streetRaw: null,
      propertyTypeRaw: null,
      propertySubtypeRaw: null,
      operationTypeRaw: null,
      statusRaw: 'unknown',
      floorRaw: null,
      yearBuiltRaw: null,
      heatingTypeRaw: null,
      conditionRaw: null,
      energyCertificateRaw: null,
      operatingCostRaw: null,
      latRaw: null,
      lonRaw: null,
      balconyAreaRaw: null,
      terraceAreaRaw: null,
      gardenAreaRaw: null,
      commissionRaw: null,
      reserveFundRaw: null,
      attributesRaw: {},
      mediaRaw: [],
      images: [],
      contactName: null,
    },
    parserVersion,
    extractionStatus: 'parse_failed',
  };
}

export function detectDetailAvailability(html: string): SourceAvailability {
  // Check for embedded detail data first
  const scriptMatch = html.match(
    /<script[^>]+id="listing-detail-data"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (scriptMatch?.[1]) {
    try {
      const data = JSON.parse(scriptMatch[1]) as DerStandardDetailData;
      return detectAvailabilityFromData(data);
    } catch {
      // fall through
    }
  }

  // Check for "not available" error page text
  if (/Anzeige nicht mehr verf[uü]gbar/i.test(html)) {
    return { status: 'not_found' };
  }

  // Check for captcha/block indicators
  if (/captcha|blocked|challenge/i.test(html)) {
    return { status: 'blocked' };
  }

  return { status: 'unknown' };
}

function detectAvailabilityFromData(data: DerStandardDetailData): SourceAvailability {
  const status = data.status?.toLowerCase();

  if (status === 'active') return { status: 'available' };
  if (status === 'sold' || status === 'verkauft') return { status: 'sold' };
  if (status === 'reserved' || status === 'reserviert') return { status: 'reserved' };
  if (status === 'inactive' || status === 'removed' || status === 'deleted') {
    return { status: 'removed' };
  }

  return { status: 'available' };
}

/**
 * Extract numeric listing ID from derstandard detail URL.
 * Pattern: /detail/{id}/{slug}
 */
export function extractIdFromUrl(url: string): string | null {
  const m = url.match(/\/detail\/(\d+)/);
  if (m?.[1]) return m[1];
  // Fallback: last numeric segment in URL path
  const fallback = url.match(/\/(\d+)\/?(?:\?|$|#)/);
  return fallback?.[1] ?? null;
}

/**
 * Normalize Austrian decimal format to standard format.
 * Handles: "58,4" -> "58.4", "1.250,50" -> "1250.50", "86" -> "86"
 */
function normalizeDecimal(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed;
}

function formatAddress(
  addr: { postalCode?: string; city?: string; district?: string; street?: string | null } | undefined,
): string | null {
  if (!addr) return null;
  const parts: string[] = [];
  if (addr.street) parts.push(addr.street);
  if (addr.postalCode) parts.push(addr.postalCode);
  if (addr.city) parts.push(addr.city);
  if (addr.district) parts.push(addr.district);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Extract a district label from a district name string.
 * E.g., "Leopoldstadt" -> "2. Bezirk" based on Vienna district mapping.
 * Falls back to the raw string if not a recognized Vienna district.
 */
function extractDistrictLabel(district: string): string {
  const viennaDistricts: Record<string, number> = {
    'innere stadt': 1,
    'leopoldstadt': 2,
    'landstraße': 3,
    'landstrasse': 3,
    'wieden': 4,
    'margareten': 5,
    'mariahilf': 6,
    'neubau': 7,
    'josefstadt': 8,
    'alsergrund': 9,
    'favoriten': 10,
    'simmering': 11,
    'meidling': 12,
    'hietzing': 13,
    'penzing': 14,
    'rudolfsheim-fünfhaus': 15,
    'rudolfsheim-fuenfhaus': 15,
    'ottakring': 16,
    'hernals': 17,
    'währing': 18,
    'waehring': 18,
    'döbling': 19,
    'doebling': 19,
    'brigittenau': 20,
    'floridsdorf': 21,
    'donaustadt': 22,
    'liesing': 23,
  };

  const num = viennaDistricts[district.toLowerCase()];
  if (num != null) return `${num}. Bezirk`;
  // Check if already in "N. Bezirk" format
  if (/^\d+\.\s*Bezirk$/i.test(district)) return district;
  return district;
}

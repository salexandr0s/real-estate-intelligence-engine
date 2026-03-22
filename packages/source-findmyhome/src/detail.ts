import type { DetailCapture, SourceAvailability } from '@rei/contracts';
import type { FindMyHomeDetailDTO, JsonLdApartmentDetail } from './dto.js';

const JSON_LD_REGEX = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

/**
 * findmyhome.at detail pages serve structured data via JSON-LD Apartment/RealEstateListing schema.
 * Fields extracted: name, description, price, floorSize, numberOfRooms, address, geo,
 * photo array, yearBuilt, amenityFeature, contactPoint, additionalProperty.
 */
export function parseDetailPage(
  html: string,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<FindMyHomeDetailDTO> {
  // Try JSON-LD first (legacy), then fall back to DOM extraction
  const apartment = extractApartmentLd(html);
  const findmyhomeId = apartment?.identifier ?? extractIdFromUrl(url) ?? '';

  let payload: FindMyHomeDetailDTO;

  if (apartment) {
    // JSON-LD path (legacy)
    const address = apartment.address;
    const geo = apartment.geo;
    const images: string[] = [];
    if (apartment.photo) {
      for (const photo of apartment.photo) {
        if (photo.contentUrl) images.push(photo.contentUrl);
      }
    }
    const amenities = (apartment.amenityFeature ?? []).map((a) => a.name);
    const hasBalcony = amenities.some((a) => /balkon/i.test(a));
    const hasElevator = amenities.some((a) => /lift|aufzug/i.test(a));
    const additionalProps = new Map<string, string>();
    if (apartment.additionalProperty) {
      for (const prop of apartment.additionalProperty) {
        additionalProps.set(prop.name, prop.value);
      }
    }
    payload = {
      findmyhomeId,
      titleRaw: apartment.name ?? null,
      descriptionRaw: apartment.description ? stripHtml(apartment.description) : null,
      priceRaw: apartment.offers?.price ?? null,
      livingAreaRaw: normalizeDecimal(apartment.floorSize?.value ?? null),
      usableAreaRaw: null,
      roomsRaw: apartment.numberOfRooms ?? null,
      addressRaw: address
        ? [address.streetAddress, address.postalCode, address.addressLocality]
            .filter(Boolean)
            .join(', ')
        : null,
      postalCodeRaw: address?.postalCode ?? null,
      districtRaw: address?.addressRegion ?? null,
      cityRaw: address?.addressLocality ?? null,
      federalStateRaw: null,
      floorRaw: additionalProps.get('Stockwerk') ?? null,
      yearBuiltRaw: apartment.yearBuilt ?? null,
      propertyTypeRaw:
        apartment['@type'] === 'Apartment' ? 'Wohnung' : (apartment['@type'] ?? null),
      operationTypeRaw: 'sale',
      statusRaw: 'active',
      heatingTypeRaw: additionalProps.get('Heizung') ?? null,
      conditionRaw: additionalProps.get('Zustand') ?? null,
      energyCertificateRaw: additionalProps.get('Energieklasse') ?? null,
      balconyAreaRaw: null,
      terraceAreaRaw: null,
      gardenAreaRaw: null,
      commissionRaw: additionalProps.get('Provision') ?? null,
      operatingCostRaw: additionalProps.get('Betriebskosten') ?? null,
      reserveFundRaw: null,
      latRaw: geo?.latitude ?? null,
      lonRaw: geo?.longitude ?? null,
      attributesRaw: { amenities, hasBalcony, hasElevator, ...Object.fromEntries(additionalProps) },
      mediaRaw: [],
      images,
      contactName: apartment.contactPoint?.name ?? null,
    };
  } else {
    // DOM fallback — extract from HTML table rows and OG meta tags
    payload = extractFromDom(html, findmyhomeId);
  }

  if (!payload.titleRaw) {
    return buildFailedCapture(url, sourceCode, parserVersion);
  }

  return {
    sourceCode,
    sourceListingKeyCandidate: findmyhomeId,
    externalId: findmyhomeId,
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
): DetailCapture<FindMyHomeDetailDTO> {
  const fallbackId = extractIdFromUrl(url) ?? '';
  return {
    sourceCode,
    sourceListingKeyCandidate: fallbackId,
    externalId: fallbackId || null,
    canonicalUrl: url.split('?')[0] ?? url,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload: {
      findmyhomeId: fallbackId,
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
      propertyTypeRaw: null,
      operationTypeRaw: null,
      statusRaw: 'unknown',
      attributesRaw: {},
      mediaRaw: [],
      images: [],
      contactName: null,
    },
    parserVersion,
    extractionStatus: 'parse_failed',
  };
}

/**
 * Detects listing availability from the detail page HTML.
 * Checks for "nicht mehr verfügbar" / "verkauft" / "deaktiviert" markers,
 * and falls back to JSON-LD presence.
 */
export function detectDetailAvailability(html: string): SourceAvailability {
  // Check for explicit unavailability markers in page content
  if (/nicht\s+mehr\s+verf[uü]gbar|deaktiviert|wurde\s+entfernt/i.test(html)) {
    return { status: 'not_found' };
  }

  if (/bereits\s+verkauft|verkauft/i.test(html)) {
    return { status: 'sold' };
  }

  if (/reserviert/i.test(html)) {
    return { status: 'reserved' };
  }

  // Check if there is a valid JSON-LD Apartment block or price indicator — if so, listing is available
  const apartment = extractApartmentLd(html);
  if (apartment) {
    return { status: 'available' };
  }

  // DOM-based: check for price or listing header
  if (/class="immo_header_value"/i.test(html) || /<h1[^>]*>.*<\/h1>/i.test(html)) {
    return { status: 'available' };
  }

  // No JSON-LD and no explicit markers — could be a blocked page or unknown state
  if (/captcha|blocked|challenge/i.test(html)) {
    return { status: 'blocked' };
  }

  return { status: 'unknown' };
}

// ── DOM fallback extraction ──────────────────────────────────────────────────

/**
 * Extract listing data from HTML when JSON-LD is absent.
 * Uses OG meta tags, table rows, and header price spans.
 */
function extractFromDom(html: string, findmyhomeId: string): FindMyHomeDetailDTO {
  // Title from og:title or <h1>
  const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)?.[1] ?? null;
  const h1Title =
    html
      .match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim() ?? null;
  const titleRaw = ogTitle ?? h1Title;

  // Description from og:description or page text
  const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i)?.[1] ?? null;

  // Price from span.immo_header_value or table
  const priceMatch = html.match(/class="immo_header_value"[^>]*>([\s\S]*?)<\/span>/i);
  const priceRaw =
    priceMatch?.[1]
      ?.replace(/<[^>]+>/g, '')
      .replace(/[^\d.,]/g, '')
      .trim() ?? null;

  // Extract table rows: <tr><td>Label</td><td>Value</td></tr>
  const facts = new Map<string, string>();
  const rowPattern = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const key = rowMatch[1]!.replace(/<[^>]+>/g, '').trim();
    const value = rowMatch[2]!.replace(/<[^>]+>/g, '').trim();
    if (key && value) facts.set(key, value);
  }

  const livingAreaStr =
    facts.get('Fläche') ?? facts.get('Wohnfläche') ?? facts.get('Flaeche') ?? null;
  const roomsStr = facts.get('Zimmer') ?? null;
  const locationStr = facts.get('Ort') ?? facts.get('Lage') ?? null;

  // Extract postal code from location like "1050 Wien"
  const postalMatch = locationStr?.match(/(\d{4})\s/);
  const postalCodeRaw = postalMatch?.[1] ?? null;
  const cityRaw =
    locationStr
      ?.replace(/^\d{4}\s*/, '')
      .split(',')[0]
      ?.trim() ?? null;

  // Images from og:image
  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1];
  const images = ogImage ? [ogImage] : [];

  return {
    findmyhomeId,
    titleRaw: titleRaw ? stripHtml(titleRaw) : null,
    descriptionRaw: ogDesc ? stripHtml(ogDesc) : null,
    priceRaw: priceRaw ? normalizeDecimal(priceRaw) : null,
    livingAreaRaw: livingAreaStr
      ? normalizeDecimal(livingAreaStr.replace(/\s*m.*$/, '').trim())
      : null,
    usableAreaRaw: null,
    roomsRaw: roomsStr ?? null,
    addressRaw: locationStr,
    postalCodeRaw,
    districtRaw: null,
    cityRaw,
    federalStateRaw: null,
    floorRaw: facts.get('Stockwerk') ?? facts.get('Etage') ?? null,
    yearBuiltRaw: facts.get('Baujahr') ?? null,
    propertyTypeRaw: facts.get('Typ') ?? facts.get('Objekttyp') ?? null,
    operationTypeRaw: 'sale',
    statusRaw: 'active',
    heatingTypeRaw: facts.get('Heizung') ?? null,
    conditionRaw: facts.get('Zustand') ?? null,
    energyCertificateRaw: facts.get('Energieklasse') ?? facts.get('Energieausweis') ?? null,
    balconyAreaRaw: null,
    terraceAreaRaw: null,
    gardenAreaRaw: null,
    commissionRaw: facts.get('Provision') ?? null,
    operatingCostRaw: facts.get('Betriebskosten') ?? null,
    reserveFundRaw: null,
    latRaw: null,
    lonRaw: null,
    attributesRaw: Object.fromEntries(facts),
    mediaRaw: [],
    images,
    contactName: null,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extracts the JSON-LD Apartment or RealEstateListing block from the HTML.
 * Scans all ld+json scripts and returns the first one with a matching @type.
 */
function extractApartmentLd(html: string): JsonLdApartmentDetail | null {
  let match: RegExpExecArray | null;
  JSON_LD_REGEX.lastIndex = 0;

  while ((match = JSON_LD_REGEX.exec(html)) !== null) {
    const jsonStr = match[1];
    if (!jsonStr) continue;

    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const type = parsed['@type'] as string | undefined;
      if (type === 'Apartment' || type === 'RealEstateListing' || type === 'Residence') {
        return parsed as unknown as JsonLdApartmentDetail;
      }
    } catch {
      // skip malformed JSON-LD blocks
    }
  }

  return null;
}

/**
 * Extracts a numeric listing ID from the URL path.
 * Handles: "/kaufen/wohnung/wien/schoene-wohnung-501234" -> "501234"
 *          "/listing/501234" -> "501234"
 */
export function extractIdFromUrl(url: string): string | null {
  const match = url.match(/-(\d+)\/?(?:\?.*)?$/);
  return match?.[1] ?? url.match(/\/(\d+)\/?(?:\?.*)?$/)?.[1] ?? null;
}

/**
 * Strip HTML tags from a string, collapsing whitespace.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize Austrian decimal format to standard format.
 * Handles: "74,5" -> "74.5", "1.250,50" -> "1250.50", "86" -> "86"
 */
export function normalizeDecimal(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    // Austrian/German format: dots are thousands separators, comma is decimal
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed;
}

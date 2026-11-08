import type { DetailCapture, SourceAvailability } from '@immoradar/contracts';
import { headlineNotices, headlineText, isChallengePage } from '@immoradar/scraper-core';
import { decodeHtmlEntities } from './discovery.js';
import type { FindMyHomeDetailDTO, JsonLdApartmentDetail } from './dto.js';

const JSON_LD_REGEX = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
const HEADER_VALUE_REGEX = /class="immo_header_value"/i;

/**
 * findmyhome.at renders detail pages in the DOM: an h1 title, a header with place, price and area
 * (`span.immo_header_value`) and a facts table. JSON-LD Apartment or RealEstateListing data, which
 * older pages carried, is still read first when present.
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
      contactEmail: apartment.contactPoint?.email ?? null,
      contactPhone: apartment.contactPoint?.telephone ?? null,
    };
  } else {
    const facts = extractFacts(html);
    // No header values and no facts table: a soft 404 or a redesign, not a listing page.
    if (!holdsListing(html, facts)) {
      return buildFailedCapture(url, sourceCode, parserVersion);
    }
    payload = extractFromDom(html, findmyhomeId, facts);
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
      contactEmail: null,
      contactPhone: null,
    },
    parserVersion,
    extractionStatus: 'parse_failed',
  };
}

/**
 * Detects listing availability from the detail page HTML. Status words count only as notices in
 * the title and h1, because live project pages use "verkauft" for units already sold.
 */
export function detectDetailAvailability(html: string): SourceAvailability {
  const headline = headlineText(html);
  // A gone page can come with a 200, and only `removed` retires a listing then. The worker
  // reports 404 and 410 as not_found on its own.
  if (/nicht\s+mehr\s+verf[uü]gbar|deaktiviert|wurde\s+entfernt/i.test(headline)) {
    return { status: 'removed' };
  }
  const notices = headlineNotices(headline);
  if (notices.has('sold')) return { status: 'sold' };
  if (notices.has('reserved')) return { status: 'reserved' };

  if (extractApartmentLd(html)) return { status: 'available' };
  // Soft 404s have an h1 too, so only the listing's own markup counts.
  if (holdsListing(html, extractFacts(html))) return { status: 'available' };

  if (isChallengePage(html)) return { status: 'blocked' };

  return { status: 'unknown' };
}

// ── DOM fallback extraction ──────────────────────────────────────────────────

/**
 * Extract listing data from HTML when JSON-LD is absent.
 * Uses the h1, OG meta tags, the facts table, and header price spans.
 */
function extractFromDom(
  html: string,
  findmyhomeId: string,
  facts: Map<string, string>,
): FindMyHomeDetailDTO {
  // og:title is the same on every page, so the h1 is the title. Its " - Objektnr. N" suffix is
  // the listing ID, not part of the title. Stripping comments skips the commented-out h1 these
  // pages also carry.
  const h1Html = html.replace(/<!--[\s\S]*?-->/g, '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const h1Title = h1Html ? cleanText(h1Html).replace(/\s*-\s*Objektnr\.\s*\d+$/i, '') : null;
  const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)?.[1];
  const titleRaw = h1Title || (ogTitle ? cleanText(ogTitle) : null);

  // Description from og:description or page text
  const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i)?.[1] ?? null;

  const propertyTypeRaw =
    facts.get('Immobilienart') ?? facts.get('Typ') ?? facts.get('Objekttyp') ?? null;
  // Immobilienart reads "Wohnung - Eigentum", "Eigentum" or "Miete".
  const operationTypeRaw = /\bmiete\b/i.test(propertyTypeRaw ?? '') ? 'rent' : 'sale';

  // The first header value is the postal code, so the price is read by its label. Rent pages
  // show the monthly total in place of a purchase price.
  const header = extractHeaderValues(html);
  const priceText =
    operationTypeRaw === 'rent'
      ? (header.get('Gesamtkosten') ??
        facts.get('Brutto-Miete') ??
        facts.get('Monatliche Gesamtkosten'))
      : (header.get('Kaufpreis') ?? facts.get('Kaufpreis'));
  // The first amount is the price: "€ 389.000 (inkl. 20 % USt)" holds a second number.
  const priceRaw = priceText?.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/)?.[0] ?? null;

  const livingAreaStr =
    facts.get('Fläche') ?? facts.get('Wohnfläche') ?? facts.get('Flaeche') ?? null;
  const roomsStr = facts.get('Zimmer') ?? null;
  const locationStr = facts.get('Anschrift') ?? facts.get('Ort') ?? facts.get('Lage') ?? null;

  // Anschrift reads "1130 Wien, Hietzing / Wien 13., Hie" or "Musterstraße 1/5 1120 Wien",
  // so the postal code and city are matched wherever they sit.
  const place = locationStr?.match(/(?:^|\s)(\d{4})\s+([^\d,][^,]*?)\s*(?:,|$)/);
  const postalCodeRaw = place?.[1] ?? null;
  const cityRaw = place?.[2] ?? null;

  // Images from og:image
  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1];
  const images = ogImage ? [ogImage] : [];

  return {
    findmyhomeId,
    titleRaw,
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
    floorRaw: facts.get('Stock') ?? facts.get('Stockwerk') ?? facts.get('Etage') ?? null,
    yearBuiltRaw: facts.get('Baujahr') ?? null,
    propertyTypeRaw,
    operationTypeRaw,
    statusRaw: 'active',
    heatingTypeRaw: facts.get('Heizung') ?? facts.get('Befeuerung') ?? null,
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
    contactEmail: null,
    contactPhone: null,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Rows of the facts table, `<tr><td>Label</td><td>Value</td></tr>`, by label. Labels lose a
 * trailing colon and any note in brackets, so "Betriebskosten (inkl. MwSt):" is "Betriebskosten".
 */
function extractFacts(html: string): Map<string, string> {
  const facts = new Map<string, string>();
  const rowPattern = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const key = cleanText(rowMatch[1]!)
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/:$/, '')
      .trim();
    const value = cleanText(rowMatch[2]!);
    if (key && value) facts.set(key, value);
  }
  return facts;
}

/** Header values by label, from `immo_header_value` and `immo_header_desc` span pairs. */
function extractHeaderValues(html: string): Map<string, string> {
  const header = new Map<string, string>();
  // A value can hold a link but never a span, so a match cannot run on into the next pair.
  const pairPattern =
    /<span\s+class="immo_header_value"[^>]*>((?:(?!<\/span>)[\s\S])*)<\/span>\s*(?:<hr[^>]*>\s*)?<span\s+class="immo_header_desc"[^>]*>([\s\S]*?)<\/span>/gi;
  let pairMatch: RegExpExecArray | null;
  while ((pairMatch = pairPattern.exec(html)) !== null) {
    const label = cleanText(pairMatch[2]!);
    const value = cleanText(pairMatch[1]!);
    if (label && value) header.set(label, value);
  }
  return header;
}

/** Text of an HTML fragment. Titles and facts carry entities such as `&amp;` and `&nbsp;`. */
function cleanText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** A listing page has the header values or the facts table; a soft 404 has neither. */
function holdsListing(html: string, facts: Map<string, string>): boolean {
  return HEADER_VALUE_REGEX.test(html) || facts.size > 0;
}

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

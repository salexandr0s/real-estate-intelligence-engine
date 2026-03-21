import type { DetailCapture, SourceAvailability } from '@rei/contracts';
import type { DerStandardDetailDTO, DerStandardDetailData } from './dto.js';

/**
 * derstandard.at detail pages may embed listing data as JSON in
 * <script id="listing-detail-data">, or render it as DOM text in a
 * Next.js React app. We try JSON first, then fall back to DOM extraction.
 */

export function parseDetailPage(
  html: string,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<DerStandardDetailDTO> {
  // ── Primary path: embedded JSON ──────────────────────────────────────────
  const scriptMatch = html.match(
    /<script[^>]+id="listing-detail-data"[^>]*>([\s\S]*?)<\/script>/,
  );

  if (scriptMatch?.[1]) {
    try {
      const detailData = JSON.parse(scriptMatch[1]) as DerStandardDetailData;
      return buildCaptureFromJson(detailData, url, sourceCode, parserVersion);
    } catch {
      // parse failed, fall through to DOM extraction
    }
  }

  // ── Fallback path: DOM text extraction ───────────────────────────────────
  const domResult = extractFromDom(html);
  if (domResult) {
    return buildCaptureFromDom(domResult, url, sourceCode, parserVersion);
  }

  return buildFailedCapture(url, sourceCode, parserVersion);
}

// ── JSON path builder ────────────────────────────────────────────────────────

function buildCaptureFromJson(
  detailData: DerStandardDetailData,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<DerStandardDetailDTO> {
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

// ── DOM extraction types and helpers ─────────────────────────────────────────

interface DomExtracted {
  title: string | null;
  price: string | null;
  livingArea: string | null;
  rooms: string | null;
  floor: string | null;
  yearBuilt: string | null;
  heatingType: string | null;
  energyCertificate: string | null;
  postalCode: string | null;
  city: string | null;
  district: string | null;
  street: string | null;
  lat: string | null;
  lng: string | null;
  description: string | null;
  contactName: string | null;
  images: string[];
  features: string[];
}

/**
 * Decode common HTML entities that appear in derstandard pages.
 * Handles numeric (&#NNN; / &#xHH;) and named entities used in German text.
 */
function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&euro;': '\u20AC',
    '&auml;': '\u00E4',
    '&ouml;': '\u00F6',
    '&uuml;': '\u00FC',
    '&Auml;': '\u00C4',
    '&Ouml;': '\u00D6',
    '&Uuml;': '\u00DC',
    '&szlig;': '\u00DF',
    '&sup2;': '\u00B2',
    '&nbsp;': ' ',
  };

  let result = text;
  for (const [entity, char] of Object.entries(named)) {
    result = result.split(entity).join(char);
  }

  // Numeric entities: &#123; or &#x1F;
  result = result.replace(/&#(\d+);/g, (_, code: string) =>
    String.fromCharCode(Number(code)),
  );
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  return result;
}

/**
 * Strip HTML tags, decode entities, and collapse whitespace.
 */
function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Extract a regex match from HTML, decoding entities in the result.
 */
function extractMatch(html: string, pattern: RegExp, group = 1): string | null {
  const m = html.match(pattern);
  if (!m?.[group]) return null;
  return decodeHtmlEntities(m[group]!).trim() || null;
}

/**
 * Extract listing data from DOM-rendered HTML using regex patterns.
 * Returns null only if absolutely no usable data is found.
 */
function extractFromDom(html: string): DomExtracted | null {
  // Decode the full HTML once for text-based matching
  const decoded = decodeHtmlEntities(html);

  // Title: prefer <h1>, fall back to <title>
  const title =
    extractMatch(decoded, /<h1[^>]*>([\s\S]*?)<\/h1>/) ??
    extractMatch(decoded, /<title>([^<]*)<\/title>/);

  // Price: look for "Kaufpreis" label near a price value, or standalone euro amount
  let price: string | null = null;
  const priceMatch =
    decoded.match(/Kaufpreis[\s\S]{0,80}?([\d.]+(?:,\d+)?)\s*(?:\u20AC|EUR)?/) ??
    decoded.match(/\u20AC\s*([\d.]+(?:,\d+)?)/) ??
    decoded.match(/([\d.]+(?:,\d+)?)\s*\u20AC/);
  if (priceMatch?.[1]) {
    // Normalize Austrian price format: "460.000" -> "460000", "460.000,50" -> "460000.50"
    price = normalizeAustrianPrice(priceMatch[1]);
  }

  // Living area
  const areaMatch = decoded.match(/Wohnfl\u00E4che[\s\S]{0,50}?([\d.,]+)\s*m/);
  const livingArea = areaMatch?.[1] ? normalizeDecimal(areaMatch[1]) : null;

  // Rooms
  const roomsMatch = decoded.match(/Zimmer[\s\S]{0,30}?(\d+)/);
  const rooms = roomsMatch?.[1] ?? null;

  // Floor (Etage)
  const floorMatch = decoded.match(/Etage[\s\S]{0,30}?(\d+)/);
  const floor = floorMatch?.[1] ?? null;

  // Year built
  const yearMatch = decoded.match(/Baujahr[\s\S]{0,30}?(\d{4})/);
  const yearBuilt = yearMatch?.[1] ?? null;

  // Heating type
  let heatingType: string | null = null;
  const heatingMatch = decoded.match(/Heizungsart[\s\S]{0,80}?<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/);
  if (heatingMatch?.[1]) {
    heatingType = stripTags(heatingMatch[1]);
  } else {
    const heatingFallback = decoded.match(/Heizungsart[\s\S]{0,50}?([A-Z\u00C0-\u00FF][a-z\u00E0-\u00FF\u00C0-\u00FF]+(?:\s+[a-z\u00E0-\u00FF]+)*)/);
    if (heatingFallback?.[1]) {
      heatingType = heatingFallback[1].trim();
    }
  }

  // Energy certificate
  const energyMatch = decoded.match(/Energieklasse[\s\S]{0,30}?([A-G]\+?\+?)/);
  const energyCertificate = energyMatch?.[1] ?? null;

  // Location: postal code, city, district
  const locationMatch = decoded.match(/(\d{4})\s+Wien(?:\s*,\s*([^<\n]+))?/);
  const postalCode = locationMatch?.[1] ?? null;
  const city = locationMatch ? 'Wien' : null;
  const district = locationMatch?.[2]?.trim() ?? null;

  // Street: from location section — look for the second span in .location
  let street: string | null = null;
  const locationSection = decoded.match(/<div[^>]*class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (locationSection?.[1]) {
    const spans = locationSection[1].match(/<span[^>]*>([\s\S]*?)<\/span>/g);
    if (spans && spans.length >= 2) {
      street = stripTags(spans[1]!);
    }
  }

  // Coordinates
  const lat = extractMatch(decoded, /data-lat="([\d.]+)"/);
  const lng = extractMatch(decoded, /data-lng="([\d.]+)"/);

  // Description
  let description: string | null = null;
  const descSection = decoded.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (descSection?.[1]) {
    description = stripTags(descSection[1]);
  }

  // Contact name
  let contactName: string | null = null;
  const contactSection = decoded.match(/<span[^>]*class="[^"]*agent-name[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  if (contactSection?.[1]) {
    contactName = stripTags(contactSection[1]);
  }

  // Images: src attributes from img tags with derstandard URLs
  const images: string[] = [];
  const imgPattern = /<img[^>]+src="([^"]*derstandard[^"]*)"/g;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgPattern.exec(decoded)) !== null) {
    if (imgMatch[1]) {
      images.push(imgMatch[1]);
    }
  }

  // Features: spans inside .features div
  const features: string[] = [];
  const featuresSection = decoded.match(/<div[^>]*class="[^"]*features[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (featuresSection?.[1]) {
    const featureSpans = featuresSection[1].match(/<span[^>]*>([\s\S]*?)<\/span>/g);
    if (featureSpans) {
      for (const span of featureSpans) {
        const text = stripTags(span);
        if (text) features.push(text);
      }
    }
  }

  // Only return null if we found absolutely nothing useful
  const hasAnyData = title ?? price ?? livingArea ?? rooms ?? description;
  if (!hasAnyData) return null;

  return {
    title: title ? stripTags(title) : null,
    price,
    livingArea,
    rooms,
    floor,
    yearBuilt,
    heatingType,
    energyCertificate,
    postalCode,
    city,
    district,
    street,
    lat,
    lng,
    description,
    contactName,
    images,
    features,
  };
}

// ── DOM path builder ─────────────────────────────────────────────────────────

function buildCaptureFromDom(
  dom: DomExtracted,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<DerStandardDetailDTO> {
  const standardId = extractIdFromUrl(url) ?? '';

  const districtRaw = dom.district
    ? extractDistrictLabel(dom.district)
    : null;

  const features = dom.features;
  const hasBalcony = features.some((f) => /balkon|loggia/i.test(f));
  const hasTerrace = features.some((f) => /terrasse|dachterrasse/i.test(f));
  const hasGarden = features.some((f) => /garten/i.test(f));
  const hasElevator = features.some((f) => /lift|aufzug/i.test(f));

  const addressParts: string[] = [];
  if (dom.street) addressParts.push(dom.street);
  if (dom.postalCode) addressParts.push(dom.postalCode);
  if (dom.city) addressParts.push(dom.city);
  if (dom.district) addressParts.push(dom.district);

  const payload: DerStandardDetailDTO = {
    standardId,
    titleRaw: dom.title,
    descriptionRaw: dom.description,
    priceRaw: dom.price,
    livingAreaRaw: dom.livingArea,
    usableAreaRaw: null, // not available in DOM-rendered pages
    roomsRaw: dom.rooms,
    addressRaw: addressParts.length > 0 ? addressParts.join(', ') : null,
    postalCodeRaw: dom.postalCode,
    districtRaw,
    cityRaw: dom.city,
    streetRaw: dom.street,
    propertyTypeRaw: null, // not reliably available in DOM
    propertySubtypeRaw: null,
    operationTypeRaw: 'sale', // kaufen section is always sale
    statusRaw: 'unknown', // DOM pages don't expose status
    floorRaw: dom.floor,
    yearBuiltRaw: dom.yearBuilt,
    heatingTypeRaw: dom.heatingType,
    conditionRaw: null, // not reliably available in DOM
    energyCertificateRaw: dom.energyCertificate,
    operatingCostRaw: null, // not reliably available in DOM
    latRaw: dom.lat,
    lonRaw: dom.lng,
    balconyAreaRaw: null,
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
    images: dom.images,
    contactName: dom.contactName,
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

// ── Shared helpers ───────────────────────────────────────────────────────────

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

  // For DOM-rendered pages, check if content is present (means it is available)
  if (/<h1[^>]*>/.test(html) && /Kaufpreis|Wohnfl/.test(decodeHtmlEntities(html))) {
    return { status: 'available' };
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
 * Normalize Austrian price format to plain integer string.
 * "460.000" -> "460000", "460.000,50" -> "460000.50", "1250" -> "1250"
 */
function normalizeAustrianPrice(value: string): string {
  const trimmed = value.trim();
  // Austrian format uses dots as thousand separators and comma for decimals
  if (trimmed.includes(',')) {
    // Has decimal comma: "460.000,50" -> "460000.50"
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  // No comma: dots are thousand separators: "460.000" -> "460000"
  return trimmed.replace(/\./g, '');
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
    'landstra\u00DFe': 3,
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
    'rudolfsheim-f\u00FCnfhaus': 15,
    'rudolfsheim-fuenfhaus': 15,
    'ottakring': 16,
    'hernals': 17,
    'w\u00E4hring': 18,
    'waehring': 18,
    'd\u00F6bling': 19,
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

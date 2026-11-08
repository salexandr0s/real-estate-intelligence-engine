import type { DetailCapture, SourceAvailability } from '@immoradar/contracts';
import { headlineNotices, headlineText, isChallengePage } from '@immoradar/scraper-core';
import type { RemaxDetailDTO, RemaxDataLayer } from './dto.js';

/**
 * RE/MAX Austria detail pages provide data through three channels:
 *  1. JSON-LD `@graph` scripts: the listing as `RealEstateListing`, often next to a `Product`
 *     node, with name, description and image. Its `offers` may only name a separate Offer node
 *     by `@id`, and an Apartment or House node carries rooms, floor size and coordinates.
 *  2. `dataLayer.push({...})`: immoId, immoType, transaction, location
 *  3. HTML sections: "Daten & Fakten" list, energy, agent, costs
 *
 * We use JSON-LD as primary, dataLayer for enrichment, and HTML as fallback. Rooms and living
 * area are the exception: the HTML factsheet wins and the Apartment or House node fills gaps.
 */

// -- Internal JSON-LD shapes (typed loosely to work with JSON.parse) ----------

interface JsonLdOffer {
  /** An entry with only an `@id` points to the Offer node with that id */
  '@id'?: string;
  price?: string | number;
  priceCurrency?: string;
  availability?: string;
}

interface JsonLdGeo {
  latitude?: number | string;
  longitude?: number | string;
}

/** The Apartment or House node: the property itself, described apart from the listing */
interface JsonLdAccommodation {
  numberOfRooms?: number | string;
  /** A QuantitativeValue such as `{ "value": 75, "unitCode": "MTK" }` */
  floorSize?: { value?: number | string };
  geo?: JsonLdGeo;
}

interface JsonLdProduct {
  name?: string;
  description?: string;
  /** One URL or a list of them */
  image?: string | string[];
  /** One Offer or a list of them */
  offers?: JsonLdOffer | JsonLdOffer[];
  geo?: JsonLdGeo;
}

const DATA_LAYER_RE = /dataLayer(?:\.push\(|\s*=)\s*(\{[\s\S]*?\})/g;
const DATA_LAYER_KEYS = [
  'immoId',
  'immoType',
  'immoTransaction',
  'immoPostcode',
  'immoLocation',
  'immoRegion',
  'maklerId',
  'maklerName',
] as const;

interface JsonLdAgent {
  name?: string;
  worksFor?: { name?: string };
  telephone?: string;
  email?: string;
}

export function parseDetailPage(
  html: string,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<RemaxDetailDTO> {
  const jsonLdBlocks = parseJsonLdBlocks(html);
  const product =
    findJsonLdByType<JsonLdProduct>(jsonLdBlocks, 'RealEstateListing') ??
    findJsonLdByType<JsonLdProduct>(jsonLdBlocks, 'Product');
  const accommodation =
    findJsonLdByType<JsonLdAccommodation>(jsonLdBlocks, 'Apartment') ??
    findJsonLdByType<JsonLdAccommodation>(jsonLdBlocks, 'House') ??
    findJsonLdByType<JsonLdAccommodation>(jsonLdBlocks, 'Accommodation');
  const agent = findJsonLdByType<JsonLdAgent>(jsonLdBlocks, 'RealEstateAgent');
  const dataLayer = parseDataLayer(html);

  // Extract ID from URL query param `id=NNNNN`
  const remaxId = extractIdFromUrl(url) ?? '';

  // Don't bail — HTML fallbacks (H1, factsheet table) may still provide data
  // even when JSON-LD and dataLayer are absent.

  // -- JSON-LD Product data --------------------------------------------------
  const offer = offersOf(product, jsonLdBlocks)[0] ?? null;
  const priceFromLd = ldPrice(offer?.price);
  const imagesFromLd = toStringList(product?.image);
  // Latitude and longitude come as a pair from one node: the listing's own geo, else the
  // Apartment or House.
  const geo = coordinatesOf(product?.geo) ?? coordinatesOf(accommodation?.geo);

  // -- HTML-parsed data ------------------------------------------------------
  const facts = parseDatenUndFakten(html);
  const energy = parseEnergySection(html);
  const htmlAgent = parseAgentSection(html);
  const description = parseDescription(html);
  const costs = parseCostsSection(html);
  const features = parseFeaturesSection(html);
  const commission = parseCommission(html);

  // -- Merge sources ---------------------------------------------------------
  const titleRaw = product?.name ?? extractH1(html) ?? null;

  const priceRaw =
    priceFromLd ?? (facts['Kaufpreis'] ? parseAustrianPrice(facts['Kaufpreis']) : null);

  // The factsheet wins for rooms and living area; the Apartment or House node fills gaps.
  const roomsRaw = facts['Zimmer'] ?? ldNumber(accommodation?.numberOfRooms);

  const livingAreaRaw = facts['Wohnfl\u00E4che'] ?? facts['Wohnflaeche'] ?? null;
  const livingAreaNorm =
    (livingAreaRaw ? normalizeAreaValue(livingAreaRaw) : null) ??
    ldNumber(accommodation?.floorSize?.value);

  const usableAreaRaw = facts['Nutzfl\u00E4che'] ?? facts['Nutzflaeche'] ?? null;
  const usableAreaNorm = usableAreaRaw ? normalizeAreaValue(usableAreaRaw) : null;

  const balconyRaw = facts['Balkon'] ?? null;
  const balconyAreaRaw = balconyRaw ? normalizeAreaValue(balconyRaw) : null;

  const floorRaw = facts['Stockwerk'] ? extractFloorNumber(facts['Stockwerk']) : null;

  const yearBuiltRaw = facts['Baujahr'] ?? null;
  const heatingTypeRaw = facts['Heizung'] ?? null;
  const conditionRaw = facts['Zustand'] ?? null;

  const postalCodeRaw = dataLayer?.immoPostcode ?? null;
  const cityRaw = dataLayer?.immoLocation ?? null;
  const districtRaw = parseDistrictFromAddress(html);
  const streetRaw = parseStreetFromAddress(html);
  const federalStateRaw = dataLayer?.immoRegion ?? null;

  const propertyTypeRaw = dataLayer?.immoType ?? null;
  const operationTypeRaw = dataLayer?.immoTransaction
    ? mapOperationType(dataLayer.immoTransaction)
    : null;

  const immoId = dataLayer?.immoId ?? null;

  const contactName = agent?.name ?? htmlAgent.name ?? dataLayer?.maklerName ?? null;
  const agentCompany = agent?.worksFor?.name ?? htmlAgent.company ?? null;
  const agentPhone = agent?.telephone ?? htmlAgent.phone ?? null;
  const agentEmail = agent?.email ?? htmlAgent.email ?? null;

  const operatingCostRaw = costs['Betriebskosten']
    ? parseAustrianPrice(costs['Betriebskosten'])
    : null;
  const reserveFundRaw = costs['R\u00FCcklagenfonds'] ?? costs['Ruecklagenfonds'] ?? null;
  const reserveFundNorm = reserveFundRaw ? parseAustrianPrice(reserveFundRaw) : null;

  const energyCertificateRaw = energy['Energieklasse'] ?? null;

  // Gallery images: prefer JSON-LD, fall back to HTML gallery
  const images = imagesFromLd.length > 0 ? imagesFromLd : parseGalleryImages(html);

  const payload: RemaxDetailDTO = {
    remaxId,
    immoId,
    titleRaw,
    descriptionRaw: product?.description ?? description ?? null,
    priceRaw,
    livingAreaRaw: livingAreaNorm,
    usableAreaRaw: usableAreaNorm,
    roomsRaw,
    addressRaw: streetRaw ? `${streetRaw}, ${postalCodeRaw ?? ''} ${cityRaw ?? ''}`.trim() : null,
    postalCodeRaw,
    districtRaw,
    cityRaw,
    federalStateRaw,
    streetRaw,
    floorRaw,
    yearBuiltRaw,
    propertyTypeRaw,
    operationTypeRaw,
    statusRaw: 'available',
    heatingTypeRaw,
    conditionRaw,
    energyCertificateRaw,
    balconyAreaRaw,
    operatingCostRaw,
    reserveFundRaw: reserveFundNorm,
    commissionRaw: commission,
    latRaw: geo?.lat ?? null,
    lonRaw: geo?.lon ?? null,
    attributesRaw: {},
    mediaRaw: [],
    images,
    contactName,
    agentCompany,
    agentPhone,
    agentEmail,
    features,
  };

  return {
    sourceCode,
    sourceListingKeyCandidate: remaxId,
    externalId: remaxId,
    canonicalUrl: url.split('?')[0] ?? url,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload,
    parserVersion,
    extractionStatus: payload.titleRaw ? 'captured' : 'parse_failed',
  };
}

// -- Availability detection --------------------------------------------------

/**
 * Detects listing availability from the detail page HTML: the listing's JSON-LD offer first,
 * then German-language notices in the title and h1.
 */
export function detectDetailAvailability(html: string): SourceAvailability {
  // 1. The listing's offer, when it states an availability
  const jsonLdBlocks = parseJsonLdBlocks(html);
  const listing =
    findJsonLdByType<JsonLdProduct>(jsonLdBlocks, 'RealEstateListing') ??
    findJsonLdByType<JsonLdProduct>(jsonLdBlocks, 'Product');

  const availability =
    offersOf(listing, jsonLdBlocks)
      .map((offer) => offer.availability)
      .find((value): value is string => typeof value === 'string') ?? '';
  if (/SoldOut/i.test(availability)) return { status: 'sold' };
  if (/InStock/i.test(availability)) return { status: 'available' };
  if (/Discontinued/i.test(availability)) return { status: 'removed' };

  // 2. German-language notices. Similar-listing teasers and footers on live pages also say
  // "verkauft" or "vermietet", so only the title and h1 count.
  const headline = headlineText(html);
  if (/nicht\s+verf[u\u00FC]gbar|nicht\s+gefunden/i.test(headline)) return { status: 'not_found' };
  const notices = headlineNotices(headline);
  if (notices.has('sold')) return { status: 'sold' };
  if (notices.has('reserved')) return { status: 'reserved' };
  if (notices.has('rented')) return { status: 'rented' };

  // 3. A challenge page carries no listing data, so only a page without any is checked
  if (!listing && isChallengePage(html)) return { status: 'blocked' };

  // Without a stated availability or a notice, the page says nothing either way.
  return { status: 'unknown' };
}

// -- Parsing helpers ---------------------------------------------------------

/** Parse all JSON-LD nodes from the page, unwrapping `@graph` and top-level arrays */
function parseJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const regex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    if (!match[1]) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue; // skip malformed JSON-LD blocks
    }
    const roots: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const root of roots) {
      const graph =
        typeof root === 'object' && root !== null && '@graph' in root ? root['@graph'] : null;
      if (Array.isArray(graph)) {
        blocks.push(...graph);
      } else {
        blocks.push(root);
      }
    }
  }

  return blocks;
}

/** Find a JSON-LD node whose @type is the given name, or a list that contains it */
function findJsonLdByType<T>(blocks: unknown[], typeName: string): T | null {
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null || !('@type' in block)) continue;
    const type = block['@type'];
    if (type === typeName || (Array.isArray(type) && type.includes(typeName))) {
      return block as T;
    }
  }
  return null;
}

/**
 * `offers` is one Offer or a list of them. An entry with only an `@id` stands for the Offer node
 * with that id, which live pages put next to the listing in `@graph`.
 */
function offersOf(node: JsonLdProduct | null, blocks: unknown[]): JsonLdOffer[] {
  const offers: unknown = node?.offers;
  const entries: unknown[] = Array.isArray(offers) ? offers : [offers];
  const result: JsonLdOffer[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const offer = entry as JsonLdOffer;
    const id = offer['@id'];
    const referenced =
      typeof id === 'string' && offer.price == null && offer.availability == null
        ? findJsonLdById<JsonLdOffer>(blocks, id)
        : null;
    result.push(referenced ?? offer);
  }
  return result;
}

/** Find the JSON-LD node with the given `@id` */
function findJsonLdById<T>(blocks: unknown[], id: string): T | null {
  for (const block of blocks) {
    if (typeof block === 'object' && block !== null && '@id' in block && block['@id'] === id) {
      return block as T;
    }
  }
  return null;
}

/** `image` is one URL or a list of them */
function toStringList(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : [value];
  return list.filter((item): item is string => typeof item === 'string');
}

/**
 * A JSON-LD price as text. A string keeps its separators, because normalization tells
 * "389.000" from "389000.00" and dropping them would read the second as 38,900,000. A price
 * of 0 is not a real price, so it counts as missing.
 */
function ldPrice(price: unknown): string | null {
  const text =
    typeof price === 'number' && Number.isFinite(price)
      ? formatLdNumber(price)
      : typeof price === 'string'
        ? price.trim()
        : '';
  return /[1-9]/.test(text) ? text : null;
}

/** A JSON-LD number, or a string holding one, as a raw number string for normalization */
function ldNumber(value: unknown): string | null {
  const n = ldDecimal(value);
  return n === null ? null : formatLdNumber(n);
}

/**
 * A JSON-LD number, or a string holding one. JSON-LD is machine format, so the single `.` or `,`
 * in a string is its decimal mark: "72,125" is 72.125.
 */
function ldDecimal(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^-?\d+(?:[.,]\d+)?$/.test(text) ? Number(text.replace(',', '.')) : null;
}

/**
 * A JSON number as a raw string. Normalization reads three digits after a dot as a thousands
 * group, so a fraction gets two decimals: 72.125 becomes "72.13", not "72.125".
 */
function formatLdNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Latitude and longitude from one GeoCoordinates node, only when both are numbers. They keep
 * every decimal: normalization reads them with parseFloat, and two decimals would move a point
 * by up to about 550 m.
 */
function coordinatesOf(geo: JsonLdGeo | undefined): { lat: string; lon: string } | null {
  const lat = ldDecimal(geo?.latitude);
  const lon = ldDecimal(geo?.longitude);
  return lat !== null && lon !== null ? { lat: String(lat), lon: String(lon) } : null;
}

/**
 * Read the listing fields from `dataLayer.push({ immoId: "1000/2000", ... })`. The argument is
 * a JavaScript object literal with bare keys, not JSON, so each key is matched on its own.
 */
function parseDataLayer(html: string): RemaxDataLayer | null {
  for (const call of html.matchAll(DATA_LAYER_RE)) {
    const literal = call[1] ?? '';
    const dataLayer: RemaxDataLayer = {};
    for (const key of DATA_LAYER_KEYS) {
      const value = new RegExp(`[{,\\s]["']?${key}["']?\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(
        literal,
      )?.[1];
      if (value !== undefined) dataLayer[key] = unescapeJsString(value);
    }
    if (Object.keys(dataLayer).length > 0) return dataLayer;
  }
  return null;
}

/** Decode backslash escapes in a double-quoted value, keeping the raw text when that fails */
function unescapeJsString(raw: string): string {
  try {
    const decoded: unknown = JSON.parse(`"${raw}"`);
    return typeof decoded === 'string' ? decoded : raw;
  } catch {
    return raw;
  }
}

/** Parse "Daten & Fakten" from table.factsheet or legacy section.facts */
function parseDatenUndFakten(html: string): Record<string, string> {
  const result: Record<string, string> = {};

  // New layout: table.factsheet with <td>Label</td><td>Value</td>
  const tableMatch = html.match(/<table[^>]*class="[^"]*factsheet[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (tableMatch?.[1]) {
    const tdRegex = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRegex.exec(tableMatch[1])) !== null) {
      const key = decodeEntities((tdMatch[1] ?? '').replace(/<[^>]+>/g, '').trim()).replace(
        /:$/,
        '',
      );
      const value = decodeEntities((tdMatch[2] ?? '').replace(/<[^>]+>/g, '').trim());
      if (key && value) result[key] = value;
    }
    return result;
  }

  // Legacy: <section class="facts"> with <li><strong>Key:</strong> Value</li>
  const sectionMatch = html.match(/<section[^>]*class="facts"[^>]*>([\s\S]*?)<\/section>/);
  if (!sectionMatch?.[1]) return result;

  const liRegex = /<li>\s*<strong>([\s\S]*?):?\s*<\/strong>\s*([\s\S]*?)\s*<\/li>/g;
  let liMatch: RegExpExecArray | null;

  while ((liMatch = liRegex.exec(sectionMatch[1])) !== null) {
    const key = decodeEntities(liMatch[1]?.trim() ?? '').replace(/:$/, '');
    const value = decodeEntities(liMatch[2]?.trim() ?? '');
    if (key && value) result[key] = value;
  }

  return result;
}

/** Parse the energy certificate section */
function parseEnergySection(html: string): Record<string, string> {
  const result: Record<string, string> = {};

  const sectionMatch = html.match(/<section[^>]*class="energy-section"[^>]*>([\s\S]*?)<\/section>/);
  if (!sectionMatch?.[1]) return result;

  const liRegex = /<li>\s*<strong>([\s\S]*?):?\s*<\/strong>\s*([\s\S]*?)\s*<\/li>/g;
  let liMatch: RegExpExecArray | null;

  while ((liMatch = liRegex.exec(sectionMatch[1])) !== null) {
    const key = decodeEntities(liMatch[1]?.trim() ?? '').replace(/:$/, '');
    const value = decodeEntities(liMatch[2]?.trim() ?? '');
    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

/** Parse costs section */
function parseCostsSection(html: string): Record<string, string> {
  const result: Record<string, string> = {};

  const sectionMatch = html.match(/<section[^>]*class="costs-section"[^>]*>([\s\S]*?)<\/section>/);
  if (!sectionMatch?.[1]) return result;

  const liRegex = /<li>\s*<strong>([\s\S]*?):?\s*<\/strong>\s*([\s\S]*?)\s*<\/li>/g;
  let liMatch: RegExpExecArray | null;

  while ((liMatch = liRegex.exec(sectionMatch[1])) !== null) {
    const key = decodeEntities(liMatch[1]?.trim() ?? '').replace(/:$/, '');
    const value = decodeEntities(liMatch[2]?.trim() ?? '');
    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

/** Parse features list */
function parseFeaturesSection(html: string): string[] {
  const features: string[] = [];

  const sectionMatch = html.match(
    /<section[^>]*class="features-section"[^>]*>([\s\S]*?)<\/section>/,
  );
  if (!sectionMatch?.[1]) return features;

  const liRegex = /<li>([\s\S]*?)<\/li>/g;
  let liMatch: RegExpExecArray | null;

  while ((liMatch = liRegex.exec(sectionMatch[1])) !== null) {
    const text = decodeEntities(liMatch[1]?.trim() ?? '');
    if (text) features.push(text);
  }

  return features;
}

/** Parse agent section from HTML */
function parseAgentSection(html: string): {
  name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
} {
  const sectionMatch = html.match(/<section[^>]*class="agent-section"[^>]*>([\s\S]*?)<\/section>/);
  if (!sectionMatch?.[1]) {
    return { name: null, company: null, phone: null, email: null };
  }

  const block = sectionMatch[1];
  const nameMatch = block.match(/<span\s+class="agent-name">([\s\S]*?)<\/span>/);
  const companyMatch = block.match(/<span\s+class="agent-company">([\s\S]*?)<\/span>/);
  const phoneMatch = block.match(/<span\s+class="agent-phone">([\s\S]*?)<\/span>/);
  const emailMatch = block.match(/href="mailto:([^"]+)"/);

  return {
    name: nameMatch?.[1]?.trim() ?? null,
    company: companyMatch?.[1]?.trim() ?? null,
    phone: phoneMatch?.[1]?.trim() ?? null,
    email: emailMatch?.[1]?.trim() ?? null,
  };
}

/** Parse description from HTML */
function parseDescription(html: string): string | null {
  const sectionMatch = html.match(
    /<section[^>]*class="description-section"[^>]*>([\s\S]*?)<\/section>/,
  );
  if (!sectionMatch?.[1]) return null;

  const pMatch = sectionMatch[1].match(/<p>([\s\S]*?)<\/p>/);
  return pMatch?.[1] ? decodeEntities(pMatch[1].trim()) : null;
}

/** Parse commission info */
function parseCommission(html: string): string | null {
  const sectionMatch = html.match(
    /<section[^>]*class="commission-section"[^>]*>([\s\S]*?)<\/section>/,
  );
  if (!sectionMatch?.[1]) return null;

  const pMatch = sectionMatch[1].match(/<p>([\s\S]*?)<\/p>/);
  return pMatch?.[1] ? decodeEntities(pMatch[1].trim()) : null;
}

/** Extract <h1> text (handles attributes on the tag) */
function extractH1(html: string): string | null {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (!match?.[1]) return null;
  return decodeEntities(match[1].replace(/<[^>]+>/g, '').trim()) || null;
}

/** Parse gallery images from HTML */
function parseGalleryImages(html: string): string[] {
  const images: string[] = [];
  const sectionMatch = html.match(/<section[^>]*class="gallery"[^>]*>([\s\S]*?)<\/section>/);
  if (!sectionMatch?.[1]) return images;

  const imgRegex = /<img\s+src="([^"]+)"/g;
  let imgMatch: RegExpExecArray | null;

  while ((imgMatch = imgRegex.exec(sectionMatch[1])) !== null) {
    if (imgMatch[1]) images.push(imgMatch[1]);
  }

  return images;
}

/** Parse district from address section text */
function parseDistrictFromAddress(html: string): string | null {
  const sectionMatch = html.match(
    /<section[^>]*class="address-section"[^>]*>([\s\S]*?)<\/section>/,
  );
  if (!sectionMatch?.[1]) return null;

  const pMatch = sectionMatch[1].match(/<p>([\s\S]*?)<\/p>/);
  if (!pMatch?.[1]) return null;

  const text = decodeEntities(pMatch[1].trim());
  // Format: "Taborstrasse 76, 1020 Wien, Leopoldstadt"
  const parts = text.split(',').map((s) => s.trim());
  return parts[2] ?? null; // Third part is the district
}

/** Parse street from address section text */
function parseStreetFromAddress(html: string): string | null {
  const sectionMatch = html.match(
    /<section[^>]*class="address-section"[^>]*>([\s\S]*?)<\/section>/,
  );
  if (!sectionMatch?.[1]) return null;

  const pMatch = sectionMatch[1].match(/<p>([\s\S]*?)<\/p>/);
  if (!pMatch?.[1]) return null;

  const text = decodeEntities(pMatch[1].trim());
  // Format: "Taborstrasse 76, 1020 Wien, Leopoldstadt"
  const parts = text.split(',').map((s) => s.trim());
  return parts[0] ?? null; // First part is the street
}

/**
 * Extract a numeric property ID from a RE/MAX URL.
 * Patterns: ?id=350755, &id=350755, /id350755
 */
function extractIdFromUrl(url: string): string | null {
  // Pattern: ?id=350755 or &id=350755 in query string
  const queryMatch = url.match(/[?&]id=(\d+)/);
  if (queryMatch?.[1]) return queryMatch[1];

  // Pattern: /id350755 at end of URL path
  const idSuffixMatch = url.match(/\/id(\d+)/);
  if (idSuffixMatch?.[1]) return idSuffixMatch[1];

  // Fallback: last numeric segment of 4+ digits
  const numericMatch = url.match(/(\d{4,})/);
  return numericMatch?.[1] ?? null;
}

/**
 * Parse Austrian price format: "EUR 315.000,00" -> "315000"
 * Also handles: "EUR 245,00 / Monat" -> "245"
 */
function parseAustrianPrice(text: string): string | null {
  const match = text.match(/(?:EUR\s*)?([\d.,]+)/);
  if (!match?.[1]) return null;

  const raw = match[1];
  // Austrian format: dots are thousands separators, comma is decimal separator
  // Strip dots (thousands), replace comma with dot (decimal)
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  if (isNaN(num)) return null;

  // Return integer string for whole numbers, decimal string otherwise
  return Number.isInteger(num) ? String(num) : String(num);
}

/**
 * The area in a factsheet value with its separators as written, as in "68,7 m²" or
 * "1.250,50 m²". Normalization reads both forms.
 */
function normalizeAreaValue(text: string): string | null {
  const match = text.match(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*m/);
  return match?.[1] ?? null;
}

/** Extract floor number from text like "2. OG" -> "2" */
function extractFloorNumber(text: string): string | null {
  const match = text.match(/(\d+)/);
  return match?.[1] ?? null;
}

function mapOperationType(transactionType: string): string {
  const lower = transactionType.toLowerCase();
  if (lower.includes('kauf') || lower.includes('eigentum') || lower === 'sale') return 'sale';
  if (lower.includes('miet') || lower === 'rent') return 'rent';
  return 'sale';
}

/** Decode common HTML entities */
function decodeEntities(text: string): string {
  return text
    .replace(/&#228;/g, '\u00E4') // a-umlaut
    .replace(/&#246;/g, '\u00F6') // o-umlaut
    .replace(/&#252;/g, '\u00FC') // u-umlaut
    .replace(/&#223;/g, '\u00DF') // eszett
    .replace(/&#178;/g, '\u00B2') // superscript 2
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

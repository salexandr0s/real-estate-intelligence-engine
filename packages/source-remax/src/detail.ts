import type { DetailCapture, SourceAvailability } from '@immoradar/contracts';
import type { RemaxDetailDTO, RemaxDataLayer } from './dto.js';

/**
 * RE/MAX Austria detail pages provide data through three channels:
 *  1. JSON-LD `Product` block -- name, images, price, geo coordinates
 *  2. `window.dataLayer` object -- immoId, immoType, transaction, location
 *  3. HTML sections -- "Daten & Fakten" list, energy, agent, costs
 *
 * We use JSON-LD as primary, dataLayer for enrichment, and HTML as fallback.
 */

// -- Internal JSON-LD shapes (typed loosely to work with JSON.parse) ----------

interface JsonLdOffer {
  price?: string;
  priceCurrency?: string;
  availability?: string;
}

interface JsonLdGeo {
  latitude?: number;
  longitude?: number;
}

interface JsonLdProduct {
  name?: string;
  description?: string;
  image?: string[];
  offers?: JsonLdOffer[];
  geo?: JsonLdGeo;
}

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
  const agent = findJsonLdByType<JsonLdAgent>(jsonLdBlocks, 'RealEstateAgent');
  const dataLayer = parseDataLayer(html);

  // Extract ID from URL query param `id=NNNNN`
  const remaxId = extractIdFromUrl(url) ?? '';

  // Don't bail — HTML fallbacks (H1, factsheet table) may still provide data
  // even when JSON-LD and dataLayer are absent.

  // -- JSON-LD Product data --------------------------------------------------
  const offer = product?.offers?.[0] ?? null;
  const priceFromLd = offer?.price ?? null;
  const imagesFromLd = product?.image ?? [];
  const geoLat = product?.geo?.latitude ?? null;
  const geoLon = product?.geo?.longitude ?? null;

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

  const priceRaw = priceFromLd
    ? priceFromLd.replace(/[.,]/g, '') // "315000" already clean from JSON-LD
    : facts['Kaufpreis']
      ? parseAustrianPrice(facts['Kaufpreis'])
      : null;

  const roomsRaw = facts['Zimmer'] ?? null;

  const livingAreaRaw = facts['Wohnfl\u00E4che'] ?? facts['Wohnflaeche'] ?? null;
  const livingAreaNorm = livingAreaRaw ? normalizeAreaValue(livingAreaRaw) : null;

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
    latRaw: geoLat != null ? String(geoLat) : null,
    lonRaw: geoLon != null ? String(geoLon) : null,
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
 * Detects listing availability from the detail page HTML.
 * Checks JSON-LD Product availability, German-language markers, and missing data.
 */
export function detectDetailAvailability(html: string): SourceAvailability {
  // 1. Check JSON-LD Product for availability field
  const jsonLdBlocks = parseJsonLdBlocks(html);
  const product = findJsonLdByType<JsonLdProduct>(jsonLdBlocks, 'Product');

  if (product) {
    const availability = product.offers?.[0]?.availability ?? '';
    if (/SoldOut/i.test(availability)) return { status: 'sold' };
    if (/InStock/i.test(availability)) return { status: 'available' };
    if (/Discontinued/i.test(availability)) return { status: 'removed' };
  }

  // 2. Check for German-language unavailability markers
  if (/nicht\s+verf[u\u00FC]gbar/i.test(html)) return { status: 'not_found' };
  if (/verkauft/i.test(html) && !product) return { status: 'sold' };
  if (/reserviert/i.test(html)) return { status: 'reserved' };
  if (/vermietet/i.test(html)) return { status: 'rented' };
  if (/captcha|blocked|challenge/i.test(html)) return { status: 'blocked' };

  // 3. If no JSON-LD product at all, probably not found
  if (!product) return { status: 'not_found' };

  return { status: 'unknown' };
}

// -- Parsing helpers ---------------------------------------------------------

/** Parse all JSON-LD blocks from the page as unknown objects */
function parseJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const regex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    if (!match[1]) continue;
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      // skip malformed JSON-LD blocks
    }
  }

  return blocks;
}

/** Find a JSON-LD block by its @type field */
function findJsonLdByType<T>(blocks: unknown[], typeName: string): T | null {
  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      '@type' in block &&
      (block as Record<string, unknown>)['@type'] === typeName
    ) {
      return block as T;
    }
  }
  return null;
}

/** Parse window.dataLayer from a script block */
function parseDataLayer(html: string): RemaxDataLayer | null {
  const match = html.match(/window\.dataLayer\s*=\s*(\{[\s\S]*?\});/);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]) as RemaxDataLayer;
  } catch {
    return null;
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
 * Normalize area value: "68,7 m2" -> "68.7", "73,2 m2" -> "73.2"
 */
function normalizeAreaValue(text: string): string | null {
  const match = text.match(/(\d+[.,]?\d*)\s*m/);
  if (!match?.[1]) return null;
  return match[1].replace(',', '.');
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

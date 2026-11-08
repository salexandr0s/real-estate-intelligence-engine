import type { DetailCapture, SourceAvailability } from '@immoradar/contracts';
import { headlineText, isChallengePage } from '@immoradar/scraper-core';
import type {
  Immoscout24DetailDTO,
  IS24Product,
  IS24ProductOffer,
  IS24RealEstateAgent,
} from './dto.js';

const BASE_URL = 'https://www.immobilienscout24.at';

/**
 * IS24 detail pages describe the page (WebPage), the listing (Product with an Offer) and an
 * ItemList in JSON-LD. Live pages put all three in one `@graph` script; one script per node is
 * read the same way. The ItemList entries are RealEstateListing nodes for other listings, so
 * only top-level nodes count.
 *
 * Property data (rooms, area, address) is embedded in the description text
 * and in specific HTML elements with data-testid attributes.
 */

const JSON_LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
const PRICE_TESTID_RE = /data-testid="primary-price"[^>]*>[\s\S]*?(\d[\d.,]*)/;
const SOLD_MARKER_RE = /\b(?:verkauft|sold)\b/i;
const NOT_FOUND_MARKER_RE = /nicht\s+gefunden|nicht\s+mehr\s+verf[u\u00fc]gbar|not\s+found/i;

type JsonLdNode = Record<string, unknown>;

export function parseDetailPage(
  html: string,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<Immoscout24DetailDTO> {
  const nodes = extractJsonLdNodes(html);
  const product = findListingNode(nodes);
  const agent = findNode<IS24RealEstateAgent>(nodes, 'RealEstateAgent');

  if (!product) {
    return buildFailedCapture(url, sourceCode, parserVersion);
  }

  const immoscout24Id = extractIdFromUrl(url) ?? '';
  const images = toStringList(product.image);
  const rawDescription = product.description ?? '';
  const descriptionText = stripHtml(rawDescription);

  // Prefer the Offer price. Live pages send 0 there, so the visible price is the usual source.
  // A string price keeps its separators for normalization, which reads "455.000" as 455,000.
  let priceRaw: string | null = null;
  const offerPrice = firstOffer(product)?.price;
  const offerText =
    typeof offerPrice === 'number' && Number.isFinite(offerPrice)
      ? String(offerPrice)
      : typeof offerPrice === 'string'
        ? offerPrice.trim()
        : '';
  if (/[1-9]/.test(offerText)) {
    priceRaw = offerText;
  } else {
    // Fallback: extract from data-testid="primary-price"
    const priceMatch = html.match(PRICE_TESTID_RE);
    if (priceMatch?.[1]) {
      priceRaw = normalizeDecimal(priceMatch[1].replace(/\./g, ''));
    }
  }

  // Extract structured data from description text
  const livingAreaRaw = parseArea(descriptionText);
  const roomsRaw = parseRooms(descriptionText);
  const balconyAreaRaw = parseBalconyArea(descriptionText);
  const floorRaw = parseFloor(descriptionText);
  const yearBuiltRaw = parseYearBuilt(descriptionText);
  const addressParsed = parseAddress(descriptionText);

  const payload: Immoscout24DetailDTO = {
    immoscout24Id,
    titleRaw: product.name ?? null,
    descriptionRaw: descriptionText || null,
    priceRaw,
    livingAreaRaw,
    usableAreaRaw: null,
    roomsRaw,
    addressRaw: addressParsed.addressDisplay,
    postalCodeRaw: addressParsed.postalCode,
    districtRaw: deriveDistrict(addressParsed.postalCode),
    cityRaw: addressParsed.city,
    federalStateRaw: null,
    streetRaw: addressParsed.street,
    floorRaw,
    yearBuiltRaw,
    propertyTypeRaw: null,
    operationTypeRaw: 'sale',
    statusRaw: 'active',
    heatingTypeRaw: null,
    conditionRaw: null,
    energyCertificateRaw: null,
    balconyAreaRaw,
    terraceAreaRaw: null,
    gardenAreaRaw: null,
    commissionRaw: null,
    operatingCostRaw: null,
    reserveFundRaw: null,
    latRaw: null,
    lonRaw: null,
    attributesRaw: {},
    mediaRaw: [],
    images,
    contactName: agent?.name ?? null,
    brokerName: agent?.name ?? null,
  };

  // Extract document/attachment URLs (best-effort, never fails the capture)
  const attachmentUrls = extractAttachmentUrls(html);

  return {
    sourceCode,
    sourceListingKeyCandidate: immoscout24Id,
    externalId: immoscout24Id,
    canonicalUrl: `${BASE_URL}/expose/${immoscout24Id}`,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload,
    parserVersion,
    extractionStatus: payload.titleRaw ? 'captured' : 'parse_failed',
    ...(attachmentUrls.length > 0 ? { attachmentUrls } : {}),
  };
}

function buildFailedCapture(
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<Immoscout24DetailDTO> {
  return {
    sourceCode,
    sourceListingKeyCandidate: extractIdFromUrl(url) ?? '',
    externalId: extractIdFromUrl(url),
    canonicalUrl: url.split('?')[0] ?? url,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload: {
      immoscout24Id: extractIdFromUrl(url) ?? '',
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
      brokerName: null,
    },
    parserVersion,
    extractionStatus: 'parse_failed',
  };
}

export function detectDetailAvailability(html: string): SourceAvailability {
  const listing = findListingNode(extractJsonLdNodes(html));

  const offer = listing ? firstOffer(listing) : undefined;
  const availability = typeof offer?.availability === 'string' ? offer.availability : '';
  if (availability.includes('SoldOut') || availability.includes('Discontinued')) {
    return { status: 'sold' };
  }
  if (availability.includes('InStock') || availability.includes('OnlineOnly')) {
    return { status: 'available' };
  }

  // Similar-listing teasers, scripts and footers on live pages also say "verkauft", so text
  // markers count only in the title and h1.
  const headline = headlineText(html);
  if (SOLD_MARKER_RE.test(headline)) return { status: 'sold' };
  if (NOT_FOUND_MARKER_RE.test(headline)) return { status: 'not_found' };
  // A challenge page carries no listing data, so only a page without any is checked.
  if (!listing && isChallengePage(html)) return { status: 'blocked' };

  // A listing node without a recognizable availability is still a live listing.
  return { status: listing ? 'available' : 'unknown' };
}

/**
 * Extract expose ID from URL. Supports both hex hashes and numeric IDs.
 * /expose/abc123def456789012345678 -> "abc123def456789012345678"
 * /expose/12345678 -> "12345678"
 */
export function extractIdFromUrl(url: string): string | null {
  const m = url.match(/\/expose\/([a-f0-9]+)/);
  if (m?.[1]) return m[1];
  return url.match(/([a-f0-9]{24})\/?$/)?.[1] ?? null;
}

// -- Internal helpers ---------------------------------------------------------

/**
 * Top-level JSON-LD nodes. A script holds one node, an array of nodes or a `@graph` wrapper.
 * Nodes nested in other nodes (ItemList entries, providers) describe other things.
 */
function extractJsonLdNodes(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  for (const match of html.matchAll(JSON_LD_RE)) {
    if (!match[1]) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue; // skip invalid JSON
    }
    const roots: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const root of roots) {
      if (!isJsonLdNode(root)) continue;
      const graph = root['@graph'];
      if (Array.isArray(graph)) {
        nodes.push(...graph.filter(isJsonLdNode));
      } else {
        nodes.push(root);
      }
    }
  }
  return nodes;
}

function isJsonLdNode(value: unknown): value is JsonLdNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First node of the given type. `@type` is a string or a list of types. */
function findNode<T>(nodes: JsonLdNode[], type: string): T | undefined {
  const node: unknown = nodes.find((candidate) => {
    const value = candidate['@type'];
    return value === type || (Array.isArray(value) && value.includes(type));
  });
  return node as T | undefined;
}

/** The listing itself: a Product, or a RealEstateListing on pages that type it that way. */
function findListingNode(nodes: JsonLdNode[]): IS24Product | undefined {
  return (
    findNode<IS24Product>(nodes, 'Product') ?? findNode<IS24Product>(nodes, 'RealEstateListing')
  );
}

/** `offers` is one Offer or a list of them. */
function firstOffer(listing: IS24Product): IS24ProductOffer | undefined {
  return Array.isArray(listing.offers) ? listing.offers[0] : listing.offers;
}

/** `image` is one URL or a list of them. */
function toStringList(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : [value];
  return list.filter((item): item is string => typeof item === 'string');
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize Austrian decimal format to standard format.
 * "65,20" -> "65.20", "1.250,50" -> "1250.50"
 */
function normalizeDecimal(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed;
}

/** Parse area from text: "65,20 m2" or "65.20 m2" -> "65.20" */
function parseArea(text: string): string | null {
  const m =
    text.match(/Wohnfl[a\u00e4]che:\s*([\d.,]+)\s*m\u00b2/i) ?? text.match(/([\d.,]+)\s*m\u00b2/);
  if (!m?.[1]) return null;
  return normalizeDecimal(m[1]);
}

/** Parse rooms from text: "3 Zimmer" -> "3" */
function parseRooms(text: string): string | null {
  const m = text.match(/(\d+)\s*Zimmer/);
  return m?.[1] ?? null;
}

/** Parse balcony area from text: "Balkon 4,50 m2" -> "4.50" */
function parseBalconyArea(text: string): string | null {
  const m = text.match(/Balkon\s*([\d.,]+)\s*m\u00b2/i);
  if (!m?.[1]) return null;
  return normalizeDecimal(m[1]);
}

/** Parse floor from text: "3. Stock" -> "3" */
function parseFloor(text: string): string | null {
  const m = text.match(/(\d+)\.\s*(?:Stock|OG|Obergeschoss)/i);
  return m?.[1] ?? null;
}

/** Parse year built from text: "Baujahr 1905" -> "1905" */
function parseYearBuilt(text: string): string | null {
  const m = text.match(/Baujahr\s*(\d{4})/i);
  return m?.[1] ?? null;
}

interface ParsedAddress {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  addressDisplay: string | null;
}

/** Parse address from text: "Taborstrasse 42, 1020 Wien" */
function parseAddress(text: string): ParsedAddress {
  // Try to match "Street Name Number, PostalCode City"
  const m = text.match(/Adresse:\s*([^,]+?),\s*(\d{4})\s+(\w+)/i);
  if (m) {
    const street = m[1]?.trim() ?? null;
    const postalCode = m[2] ?? null;
    const city = m[3] ?? null;
    const parts = [street, postalCode, city].filter(Boolean);
    return {
      street,
      postalCode,
      city,
      addressDisplay: parts.length > 0 ? parts.join(', ') : null,
    };
  }

  // Fallback: try "PostalCode City" anywhere
  const fallback = text.match(
    /(\d{4})\s+(Wien|Graz|Linz|Salzburg|Innsbruck|Klagenfurt|Villach|Wels|St\.\s*P[o\u00f6]lten)/i,
  );
  if (fallback) {
    return {
      street: null,
      postalCode: fallback[1] ?? null,
      city: fallback[2] ?? null,
      addressDisplay: `${fallback[1]} ${fallback[2]}`,
    };
  }

  return { street: null, postalCode: null, city: null, addressDisplay: null };
}

/**
 * Derive district info from Vienna postcode.
 * 1020 -> "2. Bezirk", 1100 -> "10. Bezirk"
 */
function deriveDistrict(postcode: string | null): string | null {
  if (!postcode) return null;
  const m = postcode.match(/^1(\d{2})0$/);
  if (m?.[1]) {
    const districtNo = parseInt(m[1], 10);
    if (districtNo >= 1 && districtNo <= 23) {
      return `${districtNo}. Bezirk`;
    }
  }
  return null;
}

/**
 * Extract document/PDF attachment URLs from the HTML.
 * Looks for anchor tags linking to PDFs, downloads, or document endpoints.
 * Best-effort: returns empty array on any error.
 */
function extractAttachmentUrls(
  html: string,
): Array<{ url: string; label?: string; type?: string }> {
  try {
    const results: Array<{ url: string; label?: string; type?: string }> = [];
    const seen = new Set<string>();

    // Match <a> tags whose href points to PDF/document resources
    const anchorRe = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorRe.exec(html)) !== null) {
      const href = match[1];
      const innerHtml = match[2];
      if (!href) continue;

      const hrefLower = href.toLowerCase();
      const isPdf =
        hrefLower.endsWith('.pdf') ||
        hrefLower.includes('/download/') ||
        hrefLower.includes('/document/') ||
        hrefLower.includes('/dokument/') ||
        hrefLower.includes('/expose-pdf') ||
        hrefLower.includes('filetype=pdf');

      if (!isPdf) continue;

      // Resolve relative URLs
      const resolvedUrl = href.startsWith('http')
        ? href
        : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;

      if (seen.has(resolvedUrl)) continue;
      seen.add(resolvedUrl);

      const label = innerHtml ? stripHtml(innerHtml).substring(0, 200) || undefined : undefined;

      const type = hrefLower.endsWith('.pdf') ? 'pdf' : 'document';

      results.push({ url: resolvedUrl, ...(label ? { label } : {}), type });
    }

    return results;
  } catch {
    return [];
  }
}

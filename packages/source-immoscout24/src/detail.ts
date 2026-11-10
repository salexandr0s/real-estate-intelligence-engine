import type { DetailCapture, SourceAvailability } from '@immoradar/contracts';
import { headlineNotices, headlineText, isChallengePage } from '@immoradar/scraper-core';
import type {
  Immoscout24DetailDTO,
  IS24Product,
  IS24ProductOffer,
  IS24RealEstateAgent,
} from './dto.js';
import {
  field,
  isRecord,
  numberText,
  positiveNumberText,
  readEmbeddedState,
  text,
} from './embedded-state.js';

const BASE_URL = 'https://www.immobilienscout24.at';

/**
 * IS24 detail pages describe the page (WebPage), the listing (Product with an Offer) and an
 * ItemList in JSON-LD. Live pages put all three in one `@graph` script; one script per node is
 * read the same way. The ItemList entries are RealEstateListing nodes for other listings, so
 * only top-level nodes count.
 *
 * The page also embeds the listing as an `Expose` record in `window.__APOLLO_STATE__`, with the
 * price, areas, rooms, address and estate type as separate fields. Those fields win over the
 * description text, which fills a field only where it labels the value ("Wohnfläche: 72 m²").
 */

const JSON_LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
/** The opening tag of the element that shows the price; group 1 is its tag name. */
const PRICE_ELEMENT_RE =
  /<([a-z][a-z0-9-]*)(?=[\s/>])[^>]*\bdata-testid=["']primary-price["'][^>]*>/i;
const CURRENCY = String.raw`(?:€|(?<![a-z])EURO?(?![a-z]))`;
/** "389.000", "389 000", "1.250,50" or "389000", and not part of a longer number. */
const AMOUNT = String.raw`(?:\d{1,3}(?:[. ]\d{3})+|\d+)(?:,\d{1,2})?(?![\d.,]?\d)`;
/**
 * A euro amount with the currency on either side: "389.000 €", "€ 1.250,50", "EUR 299.000",
 * "389.000,- €", or "€ ab 389.000" for the lowest price of a range.
 */
const EURO_AMOUNT_RE = new RegExp(
  String.raw`${CURRENCY}\s*(?:ab\s+)?(${AMOUNT})|(?<![\d.,]|\d )(${AMOUNT})(?:,-{1,2})?\s*${CURRENCY}`,
  'i',
);
/** "ab" before the amount marks the lowest price of a range. */
const FROM_PRICE_RE = /(?<!\p{L})ab(?!\p{L})/iu;
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
  const facts = readExposeFacts(html, immoscout24Id);
  const images = toStringList(product.image);
  const rawDescription = product.description ?? '';
  const descriptionText = stripHtml(rawDescription);

  const { priceRaw, priceFromRaw } = readPrice(facts, product, html);

  // A developer project is not one flat: its record can carry one unit's area and rooms, and its
  // text quotes ranges across all units. It gets no area, rooms, outdoor space or floor.
  const isProject = facts?.isProject === true;
  const textAddress = parseAddress(descriptionText);
  const street = facts?.street ?? textAddress.street;
  const postalCode = facts?.postalCode ?? textAddress.postalCode;
  const city = facts?.city ?? textAddress.city;
  const addressRaw =
    facts?.street || facts?.postalCode
      ? formatAddress(street, postalCode, city)
      : textAddress.addressDisplay;

  const payload: Immoscout24DetailDTO = {
    immoscout24Id,
    titleRaw: product.name ?? null,
    descriptionRaw: descriptionText || null,
    priceRaw,
    // A "from" price (a project's cheapest unit, "ab 389.000 €") is not an asking price.
    priceFromRaw,
    // The description text fills what the Expose record leaves out, and only through labelled
    // values ("Wohnfläche: 72 m²"): a bare "8 m²" can be the balcony and "2 bis 4 Zimmer" a range.
    livingAreaRaw: isProject ? null : (facts?.livingAreaRaw ?? parseArea(descriptionText)),
    usableAreaRaw: null,
    roomsRaw: isProject ? null : (facts?.roomsRaw ?? parseRooms(descriptionText)),
    addressRaw,
    postalCodeRaw: postalCode,
    districtRaw: deriveDistrict(postalCode),
    cityRaw: city,
    federalStateRaw: null,
    streetRaw: street,
    floorRaw: isProject ? null : parseFloor(descriptionText),
    yearBuiltRaw: facts?.yearBuiltRaw ?? parseYearBuilt(descriptionText),
    propertyTypeRaw: null,
    estateTypeRaw: facts?.estateTypeRaw ?? null,
    operationTypeRaw: facts?.operationTypeRaw ?? 'sale',
    statusRaw: 'active',
    heatingTypeRaw: null,
    conditionRaw: null,
    energyCertificateRaw: null,
    balconyAreaRaw: isProject ? null : (facts?.balconyAreaRaw ?? parseBalconyArea(descriptionText)),
    terraceAreaRaw: null,
    gardenAreaRaw: isProject ? null : (facts?.gardenAreaRaw ?? null),
    commissionRaw: null,
    operatingCostRaw: null,
    reserveFundRaw: null,
    latRaw: null,
    lonRaw: null,
    // Only the Expose record says whether the listing is a project.
    isProjectRaw: facts ? isProject : null,
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
  // markers count only as notices in the title and h1.
  const headline = headlineText(html);
  const notices = headlineNotices(headline);
  if (notices.has('sold')) return { status: 'sold' };
  if (notices.has('rented')) return { status: 'rented' };
  if (notices.has('reserved')) return { status: 'reserved' };
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

/** Listing facts from the page's `Expose` record. */
interface ExposeFacts {
  priceRaw: string | null;
  livingAreaRaw: string | null;
  roomsRaw: string | null;
  balconyAreaRaw: string | null;
  gardenAreaRaw: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  estateTypeRaw: string | null;
  operationTypeRaw: 'sale' | 'rent' | null;
  yearBuiltRaw: string | null;
  /** A developer project: a listing whose units are listings of their own. */
  isProject: boolean;
}

/**
 * The `Expose` record for this listing in `window.__APOLLO_STATE__`, keyed `Expose:<id>`. A page
 * with a single Expose record uses it even when the URL carries no ID. Null without one.
 * A developer project's primaryPrice is its cheapest unit's price, and its area and rooms, when
 * present, describe one unit rather than the project.
 */
function readExposeFacts(html: string, exposeId: string): ExposeFacts | null {
  const state = readEmbeddedState(html, '__APOLLO_STATE__');
  if (!isRecord(state)) return null;
  const keys = Object.keys(state).filter((key) => key.startsWith('Expose:'));
  const key = keys.includes(`Expose:${exposeId}`)
    ? `Expose:${exposeId}`
    : keys.length === 1
      ? keys[0]
      : undefined;
  const expose = key ? state[key] : undefined;
  if (!isRecord(expose)) return null;

  const street = text(field(expose, 'localization', 'address', 'street'));
  const streetNumber = text(field(expose, 'localization', 'address', 'streetNumber'));
  const transferType = text(field(expose, 'type', 'transferType'));
  const year = field(expose, 'condition', 'yearOfConstruction');
  const yearText = typeof year === 'number' ? numberText(year) : text(year);

  return {
    priceRaw: positiveNumberText(field(expose, 'priceInformation', 'primaryPrice')),
    livingAreaRaw:
      positiveNumberText(field(expose, 'area', 'livingArea')) ??
      positiveNumberText(field(expose, 'area', 'primaryArea')),
    roomsRaw: positiveNumberText(field(expose, 'area', 'numberOfRooms')),
    balconyAreaRaw: positiveNumberText(field(expose, 'area', 'balconyArea')),
    gardenAreaRaw: positiveNumberText(field(expose, 'area', 'gardenArea')),
    street: street && streetNumber ? `${street} ${streetNumber}` : street,
    postalCode: text(field(expose, 'localization', 'address', 'zip')),
    city: text(field(expose, 'localization', 'address', 'city')),
    estateTypeRaw: text(field(expose, 'type', 'estateType')),
    operationTypeRaw: transferType === 'BUY' ? 'sale' : transferType === 'RENT' ? 'rent' : null,
    yearBuiltRaw: yearText && /^\d{4}$/.test(yearText) ? yearText : null,
    isProject: field(expose, 'meta', 'hasChildren') === true,
  };
}

/** "Musterstraße 12, 1150 Wien" from whichever parts exist. */
function formatAddress(
  street: string | null,
  postalCode: string | null,
  city: string | null,
): string | null {
  const locality = [postalCode, city].filter(Boolean).join(' ');
  return [street, locality].filter(Boolean).join(', ') || null;
}

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

interface ListingPrice {
  priceRaw: string | null;
  /** The lowest price of a range, such as a developer project's cheapest unit. */
  priceFromRaw: string | null;
}

/**
 * The asking price, with a "from" price kept apart from it.
 *
 * An Expose record is the only source when the page has one. A missing primaryPrice (IS24 sends 0
 * for "price on request") means no price, and a developer project's primaryPrice is its cheapest
 * unit, which changes as units sell. Without the record, the Offer price comes first. Live pages
 * send 0 there, so the visible price is the last source. A string price keeps its separators for
 * normalization, which reads "455.000" as 455,000.
 */
function readPrice(facts: ExposeFacts | null, product: IS24Product, html: string): ListingPrice {
  if (facts) {
    return facts.isProject
      ? { priceRaw: null, priceFromRaw: facts.priceRaw }
      : { priceRaw: facts.priceRaw, priceFromRaw: null };
  }
  const offerPrice = offerPriceText(firstOffer(product)?.price);
  if (offerPrice !== null) return { priceRaw: offerPrice, priceFromRaw: null };
  const visible = readVisiblePrice(html);
  if (!visible) return { priceRaw: null, priceFromRaw: null };
  return visible.isFrom
    ? { priceRaw: null, priceFromRaw: visible.amount }
    : { priceRaw: visible.amount, priceFromRaw: null };
}

/** The Offer price as a raw string, or null when it is missing or 0. */
function offerPriceText(price: unknown): string | null {
  if (typeof price === 'number') return positiveNumberText(price);
  const sent = text(price);
  return sent !== null && /[1-9]/.test(sent) ? sent : null;
}

interface VisiblePrice {
  /** Without thousands separators: "389000", "1250.50". */
  amount: string;
  /** Shown as "ab 389.000 \u20ac". */
  isFrom: boolean;
}

/**
 * The euro amount in the `primary-price` element's own text. Null when the element is missing,
 * says "auf Anfrage" or shows no euro amount, so text after the element never reads as a price.
 */
function readVisiblePrice(html: string): VisiblePrice | null {
  const inner = elementInnerHtml(html, PRICE_ELEMENT_RE);
  if (inner === null) return null;
  const shown = stripHtml(
    inner.replace(/&(?:nbsp|#160|#xa0);/gi, ' ').replace(/&(?:euro|#8364|#x20ac);/gi, '\u20ac'),
  );
  if (/auf\s+anfrage/i.test(shown)) return null;
  const match = EURO_AMOUNT_RE.exec(shown);
  const digits = match?.[1] ?? match?.[2];
  if (!match || !digits) return null;
  // "ab" can come before the currency or between the currency and the amount.
  const amountStart = match.index + match[0].indexOf(digits);
  return {
    amount: normalizeDecimal(digits.replace(/[. ]/g, '')),
    isFrom: FROM_PRICE_RE.test(shown.slice(0, amountStart)),
  };
}

/**
 * The markup inside the first element whose opening tag matches `openTag` (group 1 is the tag
 * name), up to that element's own closing tag. Null when the element or its end is missing.
 */
function elementInnerHtml(html: string, openTag: RegExp): string | null {
  const open = openTag.exec(html);
  const tagName = open?.[1];
  if (!open || !tagName) return null;
  const start = open.index + open[0].length;
  const tags = new RegExp(`<(/?)${tagName}(?=[\\s/>])[^>]*>`, 'gi');
  tags.lastIndex = start;
  let depth = 1;
  let tag: RegExpExecArray | null;
  while ((tag = tags.exec(html)) !== null) {
    depth += tag[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start, tag.index);
  }
  return null;
}

/**
 * Labelled values in the description text: the label, a colon, then the value. `(?<!\p{L})` keeps
 * compounds such as "Gesamtwohnfl\u00e4che" or "Schlafzimmer" out, and an area needs m\u00b2 right after its
 * number, so "45 bis 120 m\u00b2" matches nothing.
 */
const LIVING_AREA_LABEL_RE = /(?<!\p{L})Wohnfl[a\u00e4]che\s*:\s*(\d+(?:[.,]\d+)*)\s*m\u00b2/iu;
const ROOMS_LABEL_RE =
  /(?<!\p{L})Zimmer\s*:\s*(\d+(?:[.,]\d)?)(?!\d|[.,]\d|\s*(?:-|\u2013|bis)\s*\d)/iu;
const BALCONY_LABEL_RE = /(?<!\p{L})Balkon\s*:\s*(\d+(?:[.,]\d+)*)\s*m\u00b2/iu;

/**
 * Living area from "Wohnfl\u00e4che: 65,20 m\u00b2" -> "65,20", with its separators as written.
 * Normalization reads Austrian separators, and "72,125" rewritten as "72.125" would read as 72125.
 */
function parseArea(text: string): string | null {
  return text.match(LIVING_AREA_LABEL_RE)?.[1] ?? null;
}

/** Rooms from "Zimmer: 3" -> "3". A range such as "Zimmer: 2 bis 4" gives null. */
function parseRooms(text: string): string | null {
  const m = text.match(ROOMS_LABEL_RE);
  return m?.[1] ? normalizeDecimal(m[1]) : null;
}

/** Balcony area from "Balkon: 4,50 m\u00b2" -> "4,50", with its separators as written. */
function parseBalconyArea(text: string): string | null {
  return text.match(BALCONY_LABEL_RE)?.[1] ?? null;
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

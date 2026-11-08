import { stripTags } from './text.js';

/**
 * Detail pages describe the listing in a JSON-LD RealEstateListing and show further facts as
 * label and value pairs (`sc-metadata-label`, `sc-metadata-value`). Reading only these keeps
 * numbers from icons, the page title and similar-listing teasers out of the listing's fields.
 */

export interface ListingJsonLd {
  id: string | null;
  title: string | null;
  description: string | null;
  /** The asking price; null when the page gives none or 0. */
  price: number | null;
  floorSize: number | null;
  rooms: number | null;
  /** schema.org type of the property, e.g. "Apartment". */
  propertyType: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  images: string[];
  /** Names of the amenities the page marks as present. */
  amenities: string[];
  /** additionalProperty entries by name, e.g. "Zustand" or "Heizwärmebedarf (HWB) Klasse". */
  properties: ReadonlyMap<string, string>;
  /** The advertiser's name. */
  offeredBy: string | null;
}

const JSON_LD_SCRIPT =
  /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const FACT =
  /<span\s[^>]*class="[^"]*\bsc-metadata-label\b[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<span\s[^>]*class="[^"]*\bsc-metadata-value\b[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/li>/gi;

/** The page's RealEstateListing, or null when it has none. */
export function readListingJsonLd(html: string): ListingJsonLd | null {
  for (const match of html.matchAll(JSON_LD_SCRIPT)) {
    const listing = findListing(parseJson(match[1] ?? ''));
    if (listing) return toListing(listing);
  }
  return null;
}

/** Label and value text of each fact on the page; the first value wins for a repeated label. */
export function readFacts(html: string): ReadonlyMap<string, string> {
  const facts = new Map<string, string>();
  for (const match of html.matchAll(FACT)) {
    const label = stripTags(match[1] ?? '');
    const value = stripTags(match[2] ?? '');
    if (label && value && !facts.has(label)) facts.set(label, value);
  }
  return facts;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function findListing(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const listing = findListing(entry);
      if (listing) return listing;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (hasType(value, 'RealEstateListing')) return value;
  return findListing(value['@graph']);
}

function toListing(listing: Record<string, unknown>): ListingJsonLd {
  const entity = record(listing['mainEntity']);
  const address = record(entity?.['address']);
  const offer = record(Array.isArray(listing['offers']) ? listing['offers'][0] : listing['offers']);

  return {
    id: text(listing['identifier']),
    title: text(listing['name']),
    description: text(listing['description']),
    price: positiveNumber(offer?.['price']),
    floorSize: positiveNumber(record(entity?.['floorSize'])?.['value']),
    rooms: positiveNumber(entity?.['numberOfRooms']),
    propertyType: text(entity?.['@type']),
    street: text(address?.['streetAddress']),
    postalCode: text(address?.['postalCode']),
    city: text(address?.['addressLocality']),
    images: list(listing['image'])
      .map((image) => text(image) ?? text(record(image)?.['url']))
      .filter((url): url is string => url !== null),
    amenities: list(entity?.['amenityFeature'])
      .map(record)
      .filter((feature) => feature?.['value'] === true)
      .map((feature) => text(feature?.['name']))
      .filter((name): name is string => name !== null),
    properties: new Map(
      list(entity?.['additionalProperty'])
        .map(record)
        .map((property) => [text(property?.['name']), text(property?.['value'])] as const)
        .filter(
          (entry): entry is readonly [string, string] => entry[0] !== null && entry[1] !== null,
        ),
    ),
    offeredBy: text(record(offer?.['offeredBy'])?.['name']),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function hasType(value: Record<string, unknown>, type: string): boolean {
  return list(value['@type']).includes(type);
}

/** A non-empty trimmed string, or a number as a string; null otherwise. */
function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function positiveNumber(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null;
}

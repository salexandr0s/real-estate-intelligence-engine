import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@rei/contracts';
import type { FindMyHomeDiscoveryItem } from './dto.js';

const BASE_URL = 'https://www.findmyhome.at';

/**
 * findmyhome.at serves discovery listings as Bootstrap HTML cards separated by
 * `<!-- **** IMMO LIST ***** -->` comment markers. Each card contains:
 * - ID from `<a href="/{numericId}">` links
 * - Title from `<a class="btnHeadlineErgebnisliste">` text
 * - Location from `<strong>Ort: {PLZ}</strong> {City}`
 * - Price from `<strong>Kaufpreis:</strong><br>{price}` or `<strong>Mieten:</strong><br>{price}`
 * - Area from `<strong>Flaeche:</strong><br>{X} m2`
 * - Rooms from `<strong>Zimmer:</strong><br>{X}`
 */
export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<FindMyHomeDiscoveryItem> {
  const items: DiscoveryItem<FindMyHomeDiscoveryItem>[] = [];

  const cards = splitCards(html);

  for (const card of cards) {
    const parsed = parseCard(card, sourceCode);
    if (parsed) {
      items.push(parsed);
    }
  }

  const pageNum = Number(requestPlan.metadata?.['page']) || 1;
  const totalEstimate = extractTotalEstimate(html);
  const hasNextPage = detectNextPage(html);

  const hasMore = hasNextPage || (items.length > 0 && totalEstimate !== null && pageNum * 20 < totalEstimate);

  const nextPagePlan: RequestPlan | null = hasMore
    ? {
        ...requestPlan,
        url: buildNextPageUrl(requestPlan.url, pageNum + 1),
        metadata: { ...requestPlan.metadata, page: pageNum + 1 },
      }
    : null;

  return {
    items,
    nextPagePlan,
    totalEstimate,
    pageNumber: pageNum,
  };
}

/**
 * Split HTML into individual listing card chunks using the IMMO LIST comment markers.
 * Falls back to splitting on `<h3 class="obj_list">` blocks if no comment markers found.
 */
function splitCards(html: string): string[] {
  // Primary: split at comment markers
  const commentParts = html.split(/<!--\s*\*+\s*IMMO LIST\s*\*+\s*-->/i);

  if (commentParts.length > 1) {
    // First part is the content before the first marker -- skip it
    return commentParts.slice(1);
  }

  // Fallback: split at h3.obj_list headings
  const h3Parts = html.split(/<h3\s+class="obj_list"/i);
  if (h3Parts.length > 1) {
    return h3Parts.slice(1).map((part) => `<h3 class="obj_list"${part}`);
  }

  return [];
}

/**
 * Parse a single card HTML chunk into a DiscoveryItem.
 */
function parseCard(
  cardHtml: string,
  sourceCode: string,
): DiscoveryItem<FindMyHomeDiscoveryItem> | null {
  const id = extractId(cardHtml);
  if (!id) return null;

  const detailUrl = `${BASE_URL}/${id}`;
  const title = extractTitle(cardHtml);
  const location = extractLocation(cardHtml);
  const price = extractPrice(cardHtml);
  const area = extractArea(cardHtml);
  const rooms = extractRooms(cardHtml);

  return {
    detailUrl,
    canonicalUrl: detailUrl,
    externalId: id,
    sourceCode,
    discoveredAt: new Date().toISOString(),
    summaryPayload: {
      findmyhomeId: id,
      detailUrl,
      titleRaw: title,
      priceRaw: price,
      locationRaw: location,
      roomsRaw: rooms,
      areaRaw: area,
    },
  };
}

// ── Field extractors ────────────────────────────────────────────────────────

/**
 * Extract numeric listing ID from href attributes.
 * Handles both `/5487804` and `/5487804?tl=1` patterns.
 */
function extractId(cardHtml: string): string | null {
  // Look for the headline link first (most reliable)
  const headlineMatch = cardHtml.match(
    /class="btnHeadlineErgebnisliste"[^>]*href="\/(\d+)(?:\?[^"]*)?"/,
  );
  if (headlineMatch?.[1]) return headlineMatch[1];

  // Fallback: href="btnHeadlineErgebnisliste" with href before class
  const hrefMatch = cardHtml.match(
    /href="\/(\d+)(?:\?[^"]*)?"\s[^>]*class="btnHeadlineErgebnisliste"/,
  );
  if (hrefMatch?.[1]) return hrefMatch[1];

  // General fallback: any link with numeric-only path
  const anyMatch = cardHtml.match(/href="\/(\d+)(?:\?[^"]*)?"/)
  if (anyMatch?.[1]) return anyMatch[1];

  return null;
}

/**
 * Extract title from `<a class="btnHeadlineErgebnisliste">` text.
 */
function extractTitle(cardHtml: string): string | null {
  const match = cardHtml.match(
    /class="btnHeadlineErgebnisliste"[^>]*>([^<]+)</,
  );
  if (match?.[1]) return decodeHtmlEntities(match[1].trim());

  // Fallback: href before class
  const fallback = cardHtml.match(
    /href="[^"]*"[^>]*class="btnHeadlineErgebnisliste"[^>]*>([^<]+)</,
  );
  if (fallback?.[1]) return decodeHtmlEntities(fallback[1].trim());

  return null;
}

/**
 * Extract location from `<strong>Ort: {PLZ}</strong> {City}`.
 */
function extractLocation(cardHtml: string): string | null {
  const match = cardHtml.match(/<strong>Ort:\s*(\d{4})<\/strong>\s*([\w\s\u00c0-\u00ff-]+)/);
  if (match?.[1] && match[2]) {
    return `${match[1]} ${match[2].trim()}`;
  }
  return null;
}

/**
 * Extract and normalize price from `<strong>Kaufpreis:</strong><br>{price}`
 * or `<strong>Mieten:</strong><br>{price}`.
 * Normalizes Austrian format: "310.000,- EUR" -> "310000"
 */
function extractPrice(cardHtml: string): string | null {
  const match = cardHtml.match(
    /<strong>(?:Kaufpreis|Mieten?)[^<]*<\/strong><br>\s*([\d.,]+)/,
  );
  if (!match?.[1]) return null;

  return normalizeAustrianPrice(match[1]);
}

/**
 * Extract area from `<strong>Flaeche:</strong><br>{X} m2`.
 * Handles raw entity `Fl&auml;che`, decoded umlaut `Fläche`, and ASCII `Flaeche`.
 */
function extractArea(cardHtml: string): string | null {
  const match = cardHtml.match(
    /<strong>Fl(?:&auml;|\u00e4|ae?)che[^<]*<\/strong><br>\s*([\d.,]+)\s*m/i,
  );
  if (!match?.[1]) return null;
  return match[1];
}

/**
 * Extract rooms from `<strong>Zimmer:</strong><br>{X}`.
 */
function extractRooms(cardHtml: string): string | null {
  const match = cardHtml.match(
    /<strong>Zimmer[^<]*<\/strong><br>\s*([\d.,]+)/,
  );
  if (!match?.[1]) return null;
  return match[1];
}

// ── Page-level extractors ───────────────────────────────────────────────────

/**
 * Extract total listing count from "Wir haben {N} Immobilien" text.
 */
function extractTotalEstimate(html: string): number | null {
  const match = html.match(/Wir haben\s+(\d+)\s+Immobilien/);
  if (match?.[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Detect if a next page link exists by looking for `seite=` pagination links.
 */
function detectNextPage(html: string): boolean {
  return /[?&]seite=\d+/.test(html);
}

/** Build next page URL using the `seite` query parameter. */
function buildNextPageUrl(currentUrl: string, nextPage: number): string {
  const parsed = new URL(currentUrl);
  parsed.searchParams.set('seite', String(nextPage));
  return parsed.toString();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize Austrian price format to a plain numeric string.
 * "310.000,-" -> "310000"
 * "310.000,50" -> "310000.50"
 * "245.000" -> "245000"
 */
function normalizeAustrianPrice(raw: string): string {
  const trimmed = raw.trim();

  // Remove trailing ",- " or ",-" (no cents indicator) and trailing comma
  const withoutDash = trimmed.replace(/,-?\s*$/, '').replace(/,\s*$/, '');

  // If there's a comma with digits after it (actual decimal), handle it
  if (/,\d+$/.test(withoutDash)) {
    // Austrian format: dots are thousands, comma is decimal
    return withoutDash.replace(/\./g, '').replace(',', '.');
  }

  // No comma or comma already removed -- dots are thousands separators
  return withoutDash.replace(/\./g, '');
}

/**
 * Decode common HTML entities found in German text.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ouml;/g, '\u00f6')
    .replace(/&uuml;/g, '\u00fc')
    .replace(/&auml;/g, '\u00e4')
    .replace(/&Ouml;/g, '\u00d6')
    .replace(/&Uuml;/g, '\u00dc')
    .replace(/&Auml;/g, '\u00c4')
    .replace(/&szlig;/g, '\u00df')
    .replace(/&euro;/g, '\u20ac')
    .replace(/&nbsp;/g, ' ')
    .replace(/&sup2;/g, '\u00b2');
}

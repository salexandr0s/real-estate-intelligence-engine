import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@immoradar/contracts';
import type { WohnnetDiscoveryItem } from './dto.js';

/**
 * Wohnnet discovery pages do NOT contain JSON-LD. Listings are rendered as
 * HTML `<a>` tags with `data-id` and `data-title` attributes. Each card
 * contains area, rooms, price, location, and feature badges.
 *
 * Strategy: Find all `<a ... data-id="..." ...>` blocks and regex-extract
 * fields from the card HTML within each anchor.
 */

const BASE_URL = 'https://www.wohnnet.at';

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<WohnnetDiscoveryItem> {
  const items = parseHtmlCards(html, sourceCode);

  const pageNum = Number(requestPlan.metadata?.['page']) || 1;
  const hasNextPage = detectNextPage(html, pageNum);

  const nextPagePlan: RequestPlan | null = hasNextPage
    ? {
        ...requestPlan,
        url: buildNextPageUrl(requestPlan.url, pageNum),
        metadata: { ...requestPlan.metadata, page: pageNum + 1 },
      }
    : null;

  const totalEstimate = extractTotalEstimate(html);

  return {
    items,
    nextPagePlan,
    totalEstimate,
    pageNumber: pageNum,
  };
}

// -- HTML Card Parsing --------------------------------------------------------

/**
 * Extracts listing cards from `<a>` tags with `data-id` attributes.
 *
 * The regex captures the full opening tag (to get href, data-id, data-title)
 * and the inner content (to extract area, rooms, price, location, features).
 */
function parseHtmlCards(html: string, sourceCode: string): DiscoveryItem<WohnnetDiscoveryItem>[] {
  const items: DiscoveryItem<WohnnetDiscoveryItem>[] = [];

  // Match <a ... data-id="..." ...> ... </a> blocks
  const cardPattern = /<a\s[^>]*data-id="(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let cardMatch: RegExpExecArray | null;

  while ((cardMatch = cardPattern.exec(html)) !== null) {
    const dataId = cardMatch[1];
    const fullTag = cardMatch[0];
    const cardBody = cardMatch[2];
    if (!dataId || !cardBody) continue;

    // Extract href from the opening <a> tag
    const hrefMatch = fullTag.match(/href="([^"]*)"/);
    const detailUrl = hrefMatch?.[1] ?? `/immobilien/${dataId}`;

    // Extract data-title from the opening <a> tag
    const titleFromAttr = fullTag.match(/data-title="([^"]*)"/)?.[1] ?? null;

    // Extract title from <p class="h4"> inside the card
    const titleFromH4 =
      cardBody.match(/<p\s+class="h4"[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.trim() ?? null;
    const titleRaw = titleFromH4 ?? titleFromAttr;

    // Extract area: <b ...>NUMBER</b> followed by " m" (handles m2, m&sup2;, etc.)
    const areaMatch = cardBody.match(/<b[^>]*>([\d.,]+)<\/b>\s*m/i);
    const areaRaw = areaMatch?.[1] ?? null;

    // Extract rooms: <b ...>NUMBER</b> followed by " Zimmer"
    const roomsMatch = cardBody.match(/<b[^>]*>([\d.,]+)<\/b>\s*Zimmer/i);
    const roomsRaw = roomsMatch?.[1] ?? null;

    // Extract price: <b ...>NUMBER &euro;</b> or <b ...>NUMBER EUR</b>
    // Price is in the text-right column, format like "615.900 &euro;" or "1.250.000 &euro;"
    const priceMatch = cardBody.match(/<b[^>]*>([\d.]+)\s*(?:&euro;|€|EUR)<\/b>/i);
    const priceRaw = priceMatch?.[1] ? normalizePrice(priceMatch[1]) : null;

    // Extract location: text after map-marker icon, pattern "NNNN Wien"
    const locationMatch = cardBody.match(/fa-map-marker-alt[^>]*><\/i>\s*(\d{4}\s+Wien(?:[^<]*))/i);
    const locationRaw = locationMatch?.[1]?.trim() ?? null;

    // Extract features from badge-secondary spans
    const features: string[] = [];
    const badgePattern = /<span\s+class="badge\s+badge-secondary"[^>]*>([^<]+)<\/span>/gi;
    let badgeMatch: RegExpExecArray | null;
    while ((badgeMatch = badgePattern.exec(cardBody)) !== null) {
      const value = badgeMatch[1]?.trim();
      if (value) features.push(value);
    }

    items.push({
      detailUrl,
      canonicalUrl: `${BASE_URL}${detailUrl}`,
      externalId: dataId,
      sourceCode,
      discoveredAt: new Date().toISOString(),
      summaryPayload: {
        wohnnetId: dataId,
        detailUrl,
        titleRaw,
        priceRaw,
        locationRaw,
        roomsRaw,
        areaRaw,
        features,
      },
    });
  }

  return items;
}

// -- Pagination ---------------------------------------------------------------

/**
 * Check if a next page exists by looking for `seite=N+1` links in pagination.
 */
function detectNextPage(html: string, currentPage: number): boolean {
  const nextPage = currentPage + 1;
  const pattern = new RegExp(`seite=${nextPage}`, 'i');
  return pattern.test(html);
}

/**
 * Build the next page URL by updating the seite= parameter.
 */
function buildNextPageUrl(currentUrl: string, currentPage: number): string {
  const nextPage = currentPage + 1;
  if (currentUrl.includes('seite=')) {
    return currentUrl.replace(/seite=\d+/, `seite=${nextPage}`);
  }
  const separator = currentUrl.includes('?') ? '&' : '?';
  return `${currentUrl}${separator}seite=${nextPage}`;
}

/**
 * Try to extract total results count from the page text.
 * Looks for patterns like "1.247 Ergebnisse" or "1.247 Objekte".
 */
function extractTotalEstimate(html: string): number | null {
  const match =
    html.match(/([\d.]+)\s*Ergebnisse/i) ??
    html.match(/([\d.]+)\s*Objekte/i) ??
    html.match(/([\d.]+)\s*Treffer/i);
  if (!match?.[1]) return null;
  const num = parseInt(match[1].replace(/\./g, ''), 10);
  return Number.isFinite(num) ? num : null;
}

// -- Helpers ------------------------------------------------------------------

/**
 * Extract the trailing numeric ID from a wohnnet URL.
 * e.g., "/immobilien/eigentumswohnung-...-296210602" -> "296210602"
 */
export function extractIdFromUrl(url: string): string | null {
  const m = url.match(/-(\d+)\/?$/);
  return m?.[1] ?? url.match(/\/(\d+)\/?$/)?.[1] ?? null;
}

/**
 * Normalize Austrian price format: "615.900" -> "615900", "1.250.000" -> "1250000"
 */
function normalizePrice(value: string): string {
  return value.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
}

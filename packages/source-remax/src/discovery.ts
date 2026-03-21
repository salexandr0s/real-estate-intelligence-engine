import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@rei/contracts';
import type { RemaxDiscoveryItem } from './dto.js';

const BASE_URL = 'https://www.remax.at';

/**
 * RE/MAX Austria serves discovery pages with HTML property cards.
 * There is no embedded JSON for listings -- the real site uses
 * `<div class="property-card">` elements with HTMX lazy loading.
 *
 * Exclusive (login-walled) cards have class "exclusive" and are skipped.
 */

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<RemaxDiscoveryItem> {
  const items: DiscoveryItem<RemaxDiscoveryItem>[] = [];

  // Match all property-card divs. Use a regex that captures the full block.
  // We iterate over card blocks and skip those with the "exclusive" class.
  const cards = splitPropertyCards(html);

  for (const card of cards) {
    // Skip exclusive listings (login-walled)
    if (/class="property-card\s+exclusive"/.test(card) || /class="property-card exclusive"/.test(card)) {
      continue;
    }

    // Extract URL and id from the <a href="...id=NNNNN...">
    const hrefMatch = card.match(/<a\s+href="([^"]+)"/);
    if (!hrefMatch?.[1]) continue;

    const href = hrefMatch[1];
    const idMatch = href.match(/[?&]id=(\d+)/);
    if (!idMatch?.[1]) continue;

    const remaxId = idMatch[1];

    // Extract title from <h3>
    const titleMatch = card.match(/<h3>([\s\S]*?)<\/h3>/);
    const titleRaw = titleMatch?.[1]
      ? decodeHtmlEntities(titleMatch[1].trim())
      : null;

    // Extract rooms from <span class="rooms">
    const roomsSpanMatch = card.match(/<span\s+class="rooms">([\s\S]*?)<\/span>/);
    const roomsText = roomsSpanMatch?.[1] ?? '';
    const roomsNumMatch = roomsText.match(/(\d+)\s*Zimmer/);
    const roomsRaw = roomsNumMatch?.[1] ?? null;

    // Extract area from <span class="area">
    const areaSpanMatch = card.match(/<span\s+class="area">([\s\S]*?)<\/span>/);
    const areaText = areaSpanMatch?.[1] ?? '';
    const areaNumMatch = areaText.match(/(\d+[.,]?\d*)m/);
    const areaRaw = areaNumMatch?.[1]
      ? areaNumMatch[1].replace(',', '.')
      : null;

    // Extract price from <span class="price">
    const priceSpanMatch = card.match(/<span\s+class="price">([\s\S]*?)<\/span>/);
    const priceText = priceSpanMatch?.[1] ?? '';
    const priceNumMatch = priceText.match(/EUR\s*([\d.,]+)/);
    const priceRaw = priceNumMatch?.[1]
      ? priceNumMatch[1].replace(/\./g, '').replace(',', '')
      : null;

    // Extract agent info from .agent-info spans
    const agentBlockMatch = card.match(/<div\s+class="agent-info">([\s\S]*?)<\/div>/);
    const agentBlock = agentBlockMatch?.[1] ?? '';
    const agentSpans = [...agentBlock.matchAll(/<span>([\s\S]*?)<\/span>/g)];
    const agentName = agentSpans[0]?.[1]?.trim() ?? null;
    const agentCompany = agentSpans[1]?.[1]?.trim() ?? null;

    // Build detail URL
    const detailUrl = href.startsWith('http')
      ? href
      : `${BASE_URL}${href}`;

    items.push({
      detailUrl,
      canonicalUrl: detailUrl,
      externalId: remaxId,
      sourceCode,
      discoveredAt: new Date().toISOString(),
      summaryPayload: {
        remaxId,
        detailUrl,
        titleRaw,
        priceRaw,
        locationRaw: null, // Not available in card HTML; resolved from detail page
        roomsRaw,
        areaRaw,
        agentName,
        agentCompany,
      },
    });
  }

  const pageNum = Number(requestPlan.metadata?.['page']) || 1;

  // RE/MAX uses HTMX lazy loading -- no traditional pagination data in HTML.
  // The caller (worker) handles pagination via scroll/HTMX triggers.
  // We signal "has more" if we found any items (the worker will attempt next page).
  const nextPagePlan: RequestPlan | null =
    items.length > 0
      ? {
          ...requestPlan,
          url: requestPlan.url.replace(/page=\d+/, `page=${pageNum + 1}`),
          metadata: { ...requestPlan.metadata, page: pageNum + 1 },
        }
      : null;

  return {
    items,
    nextPagePlan,
    totalEstimate: null, // Not available in HTML cards
    pageNumber: pageNum,
  };
}

/**
 * Split the HTML into individual property-card blocks.
 * Each block starts with `<div class="property-card` and includes
 * nested content up to the closing boundary.
 */
function splitPropertyCards(html: string): string[] {
  const cards: string[] = [];
  const marker = '<div class="property-card';
  let searchFrom = 0;

  while (true) {
    const start = html.indexOf(marker, searchFrom);
    if (start === -1) break;

    // Find the next card start or end of document
    const nextStart = html.indexOf(marker, start + marker.length);
    const end = nextStart === -1 ? html.length : nextStart;
    cards.push(html.slice(start, end));
    searchFrom = end;
  }

  return cards;
}

/** Decode common HTML entities in card text */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#228;/g, 'ae')
    .replace(/&#246;/g, 'oe')
    .replace(/&#252;/g, 'ue')
    .replace(/&#223;/g, 'ss')
    .replace(/&#178;/g, '\u00B2')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

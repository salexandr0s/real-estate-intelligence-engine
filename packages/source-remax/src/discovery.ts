import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@immoradar/contracts';
import type { RemaxDiscoveryItem } from './dto.js';

const BASE_URL = 'https://www.remax.at';

/**
 * RE/MAX Austria serves discovery pages with `<div class="real-estate-wrapper">`
 * card elements. Each card contains:
 * - Title in `.inner.inner-h4 h2.h4`
 * - Detail URL in the first `<a href="...id=NNNNN...">`
 * - Price/rooms/area in `div.d-flex.flex-column` groups with label spans
 * - Location in `span.inner-title-info` with `Lage:` label
 * - Listing ID in `a.favorite-button-little[data-id]`
 *
 * Exclusive (MyRE/MAX only) cards are skipped — they have hidden price/details.
 */

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<RemaxDiscoveryItem> {
  const items: DiscoveryItem<RemaxDiscoveryItem>[] = [];

  const cards = splitCards(html);

  for (const card of cards) {
    // Skip exclusive/login-walled listings
    if (/Exklusiv\s+f[uü]r\s+MyRE/i.test(card)) continue;

    // Extract listing ID from data-id attribute
    const dataIdMatch = card.match(/data-id="(\d+)"/);
    const remaxId = dataIdMatch?.[1] ?? null;

    // Extract detail URL from first anchor with id= param (handles &amp; encoding)
    const hrefMatch = card.match(/<a\s[^>]*href="([^"]*(?:[?&]|&amp;)id=\d+[^"]*)"/);
    if (!hrefMatch?.[1] || !remaxId) continue;

    const href = hrefMatch[1].replace(/&amp;/g, '&');

    // Extract title from h2.h4
    const titleMatch = card.match(/<h2\s[^>]*class="h4"[^>]*>([\s\S]*?)<\/h2>/);
    const titleRaw = titleMatch?.[1]
      ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim())
      : null;

    // Extract rooms, area, price from flex columns
    // Pattern: <span>{value}</span><span class="small">{label}</span>
    const flexCols = [...card.matchAll(/<div\s+class="d-flex flex-column">([\s\S]*?)<\/div>/gi)];
    let roomsRaw: string | null = null;
    let areaRaw: string | null = null;
    let priceRaw: string | null = null;

    for (const col of flexCols) {
      const colHtml = col[1] ?? '';
      const label =
        colHtml
          .match(/<span\s+class="small">([\s\S]*?)<\/span>/i)?.[1]
          ?.replace(/<[^>]+>/g, '')
          .trim()
          .toLowerCase() ?? '';
      const valueSpan = colHtml.match(/<span>([^<]*)<\/span>/)?.[1]?.trim() ?? '';

      if (label.includes('zimmer')) {
        roomsRaw = valueSpan.match(/(\d+)/)?.[1] ?? null;
      } else if (label.includes('wohnfl') || label.includes('fl')) {
        const areaMatch = valueSpan.match(/([\d.,]+)\s*m/);
        areaRaw = areaMatch?.[1]?.replace(',', '.') ?? null;
      } else if (label.includes('kaufpreis') || label.includes('miete')) {
        const priceMatch = valueSpan.match(/EUR\s*([\d.,]+)/i) ?? valueSpan.match(/([\d.,]+)/);
        priceRaw = priceMatch?.[1]?.replace(/\./g, '').replace(',', '') ?? null;
      }
    }

    // Extract location from inner-title-info span with "Lage:"
    const locationMatch = card.match(/Lage:<\/strong>\s*([\s\S]*?)<\/span>/i);
    const locationRaw = locationMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;

    // Extract agent from broker-wrapper
    const agentNameMatch = card.match(/<a\s[^>]*rel="author"[^>]*>([\s\S]*?)<\/a>/);
    const agentName = agentNameMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;

    const detailUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

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
        locationRaw,
        roomsRaw,
        areaRaw,
        agentName,
        agentCompany: null,
      },
    });
  }

  const pageNum = Number(requestPlan.metadata?.['page']) || 1;

  // RE/MAX shows all results on one page (no traditional pagination).
  // Signal no more pages.
  return {
    items,
    nextPagePlan: null,
    totalEstimate: null,
    pageNumber: pageNum,
  };
}

/**
 * Split HTML into individual real-estate-wrapper card blocks.
 */
function splitCards(html: string): string[] {
  const cards: string[] = [];
  const marker = '<div class="real-estate-wrapper';
  let searchFrom = 0;

  while (true) {
    const start = html.indexOf(marker, searchFrom);
    if (start === -1) break;

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

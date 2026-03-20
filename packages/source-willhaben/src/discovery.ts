import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@rei/contracts';
import type { WillhabenDiscoveryItem } from './dto.js';

/**
 * Parses a discovery/search results page HTML to extract listing cards.
 * Uses simple regex-based extraction from structured data attributes.
 */
export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<WillhabenDiscoveryItem> {
  const items: DiscoveryItem<WillhabenDiscoveryItem>[] = [];

  // Extract listing cards using data-testid pattern
  const cardPattern = /data-testid="search-result-entry"[^>]*data-ad-id="(\d+)"([\s\S]*?)(?=data-testid="search-result-entry"|$)/g;
  let match;

  while ((match = cardPattern.exec(html)) !== null) {
    const adId = match[1]!;
    const cardHtml = match[2]!;

    const title = extractText(cardHtml, /data-testid="search-result-entry-header-link"[^>]*>(.*?)<\/a>/);
    const price = extractText(cardHtml, /data-testid="search-result-entry-price"[^>]*>(.*?)<\//);
    const location = extractText(cardHtml, /data-testid="search-result-entry-location"[^>]*>(.*?)<\//);
    const rooms = extractText(cardHtml, /data-testid="search-result-entry-rooms"[^>]*>(.*?)<\//);
    const area = extractText(cardHtml, /data-testid="search-result-entry-area"[^>]*>(.*?)<\//);
    const detailUrl = extractAttribute(cardHtml, /href="(\/iad\/immobilien\/[^"]+)"/);

    if (adId && detailUrl) {
      items.push({
        detailUrl,
        canonicalUrl: `https://www.willhaben.at${detailUrl}`,
        externalId: adId,
        sourceCode,
        discoveredAt: new Date().toISOString(),
        summaryPayload: {
          listingId: adId,
          detailUrl,
          titleRaw: title,
          priceRaw: price,
          locationRaw: location,
          roomsRaw: rooms,
          areaRaw: area,
        },
      });
    }
  }

  // Detect next page
  const hasNext = /data-testid="pagination-next"/.test(html) && !/disabled/.test(html.match(/data-testid="pagination-next"[^>]*/)?.[0] ?? '');
  const pageNum = requestPlan.metadata?.page as number ?? 1;

  return {
    items,
    nextPagePlan: hasNext ? {
      ...requestPlan,
      url: requestPlan.url.replace(/page=\d+/, `page=${pageNum + 1}`),
      metadata: { ...requestPlan.metadata, page: pageNum + 1 },
    } : null,
    totalEstimate: null,
    pageNumber: pageNum,
  };
}

function extractText(html: string, pattern: RegExp): string | null {
  const m = html.match(pattern);
  return m?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;
}

function extractAttribute(html: string, pattern: RegExp): string | null {
  return html.match(pattern)?.[1] ?? null;
}

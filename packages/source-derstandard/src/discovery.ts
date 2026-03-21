import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@rei/contracts';
import type { DerStandardDiscoveryItem } from './dto.js';

const BASE_URL = 'https://immobilien.derstandard.at';

/**
 * derstandard.at renders listing cards as plain HTML <a> elements.
 * Each card links to /detail/{ID}/{slug} and contains:
 *   <h2> title
 *   <p>  location + type info (e.g. "1070 Wien Wohnung, Kauf, Sonstige Wohnungen")
 *   <span> with area ("Wohnfläche 87 m²"), rooms ("Zimmer 3"), price ("Kaufpreis € 460.000")
 */

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<DerStandardDiscoveryItem> {
  const items: DiscoveryItem<DerStandardDiscoveryItem>[] = [];

  // Match all <a href="/detail/{id}/{slug}...">...</a> card blocks
  const cardPattern = /<a\s[^>]*href="(\/detail\/(\d+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let cardMatch: RegExpExecArray | null;

  while ((cardMatch = cardPattern.exec(html)) !== null) {
    const href = cardMatch[1]!;
    const id = cardMatch[2]!;
    const cardBody = cardMatch[3]!;

    const item = parseCardBody(id, href, cardBody, sourceCode);
    if (item) {
      items.push(item);
    }
  }

  const pageNum = Number(requestPlan.metadata?.page) || 1;

  // Detect pagination: check for a "page=N" link where N > current page
  const nextPageMatch = html.match(/href="[^"]*[?&]page=(\d+)[^"]*"/gi);
  let hasNextPage = false;
  if (nextPageMatch) {
    for (const link of nextPageMatch) {
      const pageMatch = link.match(/page=(\d+)/);
      if (pageMatch?.[1] && Number(pageMatch[1]) > pageNum) {
        hasNextPage = true;
        break;
      }
    }
  }

  const nextPagePlan: RequestPlan | null =
    hasNextPage && items.length > 0
      ? {
          ...requestPlan,
          url: requestPlan.url.includes('page=')
            ? requestPlan.url.replace(/page=\d+/, `page=${pageNum + 1}`)
            : `${requestPlan.url}${requestPlan.url.includes('?') ? '&' : '?'}page=${pageNum + 1}`,
          metadata: { ...requestPlan.metadata, page: pageNum + 1 },
        }
      : null;

  return {
    items,
    nextPagePlan,
    totalEstimate: null,
    pageNumber: pageNum,
  };
}

function parseCardBody(
  id: string,
  href: string,
  cardBody: string,
  sourceCode: string,
): DiscoveryItem<DerStandardDiscoveryItem> | null {
  if (!id) return null;

  // Strip query params from href for the clean detail URL
  const detailUrl = href.split('?')[0] ?? href;

  // Extract title from <h2>
  const titleMatch = cardBody.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const titleRaw = titleMatch?.[1]?.trim() ?? null;

  // Extract location+type from <p> (e.g. "1070 Wien Wohnung, Kauf, Sonstige Wohnungen")
  const locationMatch = cardBody.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const locationRaw = locationMatch?.[1]?.trim() ?? null;

  // Extract area from span text: "Wohnfläche 87 m²" or "Wohnfläche 52,3 m²"
  const areaMatch = cardBody.match(/Wohnfl[aä]che\s+([\d.,]+)\s*m/i);
  const areaRaw = areaMatch?.[1] ? normalizeNumericString(areaMatch[1]) : null;

  // Extract rooms from span text: "Zimmer 3"
  const roomsMatch = cardBody.match(/Zimmer\s+(\d+)/i);
  const roomsRaw = roomsMatch?.[1] ?? null;

  // Extract price from span text: "Kaufpreis € 460.000"
  const priceMatch = cardBody.match(/Kaufpreis\s*€?\s*([\d.,]+)/i);
  const priceRaw = priceMatch?.[1] ? normalizePrice(priceMatch[1]) : null;

  return {
    detailUrl,
    canonicalUrl: `${BASE_URL}${detailUrl}`,
    externalId: id,
    sourceCode,
    discoveredAt: new Date().toISOString(),
    summaryPayload: {
      standardId: id,
      detailUrl,
      titleRaw,
      priceRaw,
      locationRaw,
      roomsRaw,
      areaRaw,
    },
  };
}

/**
 * Normalize Austrian numeric format to standard decimal.
 * "52,3" -> "52.3", "1.250,50" -> "1250.50", "87" -> "87"
 */
function normalizeNumericString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    // Austrian format: dots are thousands separators, comma is decimal
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed;
}

/**
 * Normalize Austrian price format to plain integer string.
 * "460.000" -> "460000", "219.000" -> "219000", "1.250.000" -> "1250000"
 */
function normalizePrice(value: string): string {
  // Remove dots (thousands separators) and commas
  return value.replace(/\./g, '').replace(',', '');
}

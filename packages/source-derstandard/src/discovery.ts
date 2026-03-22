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

  // Match full <li class="box resultitem ...">...</li> card blocks
  const cardPattern = /<li\s[^>]*class="[^"]*resultitem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let cardMatch: RegExpExecArray | null;

  while ((cardMatch = cardPattern.exec(html)) !== null) {
    const cardBody = cardMatch[1]!;

    // Extract the detail URL from any <a> linking to /detail/{id}/{slug}
    const linkMatch = cardBody.match(/href="(\/detail\/(\d+)\/[^"]*)"/i);
    if (!linkMatch) continue;

    const href = linkMatch[1]!;
    const id = linkMatch[2]!;

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

  // Extract location from <span class="adress"> (e.g. "1090 Wien")
  const locationMatch = cardBody.match(/<span\s[^>]*class="adress"[^>]*>([\s\S]*?)<\/span>/i);
  const locationRaw = locationMatch?.[1]?.trim() ?? null;

  // Extract area: "<span>Wohnfläche</span>103 m²" or "Wohnfläche 87 m²"
  const areaMatch =
    cardBody.match(/Wohnfl[aä&;#228]che<\/span>\s*([\d.,]+)\s*m/i) ??
    cardBody.match(/Wohnfl[aä]che\s+([\d.,]+)\s*m/i);
  const areaRaw = areaMatch?.[1] ? normalizeNumericString(areaMatch[1]) : null;

  // Extract rooms: "<span>Zimmer</span> 3" or "Zimmer 3"
  const roomsMatch = cardBody.match(/Zimmer<\/span>\s*(\d+)/i) ?? cardBody.match(/Zimmer\s+(\d+)/i);
  const roomsRaw = roomsMatch?.[1] ?? null;

  // Extract price from span text: "Kaufpreis</span>€ 1.200.000" or "Kaufpreis € 460.000"
  const priceMatch =
    cardBody.match(/Kaufpreis<\/span>\s*€?\s*([\d.,]+)/i) ??
    cardBody.match(/Kaufpreis\s*€?\s*([\d.,]+)/i);
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
  // Austrian format: dots are thousands separators, comma is decimal
  const trimmed = value.trim();
  if (/,\d+$/.test(trimmed)) {
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed.replace(/\./g, '');
}

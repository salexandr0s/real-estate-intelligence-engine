import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@rei/contracts';
import type { OpenImmoDiscoveryItem, OpenImmoSearchData } from './dto.js';

/**
 * openimmo.at serves listing data via embedded JSON in a
 * `<script type="application/json" id="search-data">` tag.
 * The JSON follows the OpenImmo-inspired schema with German field names.
 *
 * Also supports `<script type="application/ld+json">` as a fallback
 * if the primary script tag is not found.
 */

const SEARCH_DATA_RE = /<script[^>]+id="search-data"[^>]*>([\s\S]*?)<\/script>/;
const LD_JSON_RE = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/;

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<OpenImmoDiscoveryItem> {
  const items: DiscoveryItem<OpenImmoDiscoveryItem>[] = [];

  const scriptMatch = html.match(SEARCH_DATA_RE) ?? html.match(LD_JSON_RE);
  if (!scriptMatch?.[1]) {
    return { items, nextPagePlan: null, totalEstimate: null, pageNumber: 1 };
  }

  let searchData: OpenImmoSearchData;
  try {
    const parsed = JSON.parse(scriptMatch[1]) as unknown;
    if (!isSearchData(parsed)) {
      return { items, nextPagePlan: null, totalEstimate: null, pageNumber: 1 };
    }
    searchData = parsed;
  } catch {
    return { items, nextPagePlan: null, totalEstimate: null, pageNumber: 1 };
  }

  const results = searchData.results ?? [];
  const now = new Date().toISOString();

  for (const result of results) {
    if (!result.objektNr || !result.detailUrl) continue;

    const locationParts: string[] = [];
    if (result.plz) locationParts.push(result.plz);
    if (result.ort) locationParts.push(result.ort);
    if (result.stadtteil) locationParts.push(result.stadtteil);

    items.push({
      detailUrl: result.detailUrl,
      canonicalUrl: result.detailUrl.startsWith('http')
        ? result.detailUrl
        : `https://www.openimmo.at${result.detailUrl}`,
      externalId: result.objektNr,
      sourceCode,
      discoveredAt: now,
      summaryPayload: {
        openimmoId: result.objektNr,
        detailUrl: result.detailUrl,
        titleRaw: result.titel ?? null,
        priceRaw: result.kaufpreis != null ? String(result.kaufpreis) : null,
        locationRaw: locationParts.length > 0 ? locationParts.join(' ') : null,
        roomsRaw: result.anzahlZimmer != null ? String(result.anzahlZimmer) : null,
        areaRaw: result.wohnflaeche != null ? String(result.wohnflaeche) : null,
      },
    });
  }

  const pageNum = Number(requestPlan.metadata?.page) || searchData.meta.page || 1;
  const totalEstimate = searchData.meta.totalCount ?? null;
  const pageSize = searchData.meta.pageSize || 20;
  const hasMore = items.length > 0 && (totalEstimate === null || pageNum * pageSize < totalEstimate);

  const nextPagePlan: RequestPlan | null = hasMore
    ? {
        ...requestPlan,
        url: requestPlan.url.replace(/seite=\d+/, `seite=${pageNum + 1}`),
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

function isSearchData(data: unknown): data is OpenImmoSearchData {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj['meta'] === 'object' &&
    obj['meta'] !== null &&
    Array.isArray(obj['results'])
  );
}

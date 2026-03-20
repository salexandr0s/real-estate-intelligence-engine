import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@rei/contracts';
import type { WillhabenDiscoveryItem } from './dto.js';

/**
 * Willhaben serves listing data via Next.js __NEXT_DATA__ JSON embedded in HTML.
 * Structure: props.pageProps.searchResult.advertSummaryList.advertSummary[]
 * Each ad has id, description, attributes.attribute[] (name/values pairs), contextLinkList, etc.
 */

interface WillhabenAttribute {
  name: string;
  values: string[];
}

interface WillhabenAdSummary {
  id: string;
  description: string;
  attributes: { attribute: WillhabenAttribute[] };
  contextLinkList?: { contextLink: Array<{ id: string; uri: string; relativePath: string }> };
}

interface WillhabenSearchResult {
  rowsFound: number;
  rowsReturned: number;
  pageRequested: number;
  advertSummaryList: { advertSummary: WillhabenAdSummary[] };
}

function getAttr(attrs: WillhabenAttribute[], name: string): string | null {
  return attrs.find((a) => a.name === name)?.values?.[0] ?? null;
}

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<WillhabenDiscoveryItem> {
  const items: DiscoveryItem<WillhabenDiscoveryItem>[] = [];

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch?.[1]) {
    return { items, nextPagePlan: null, totalEstimate: null, pageNumber: 1 };
  }

  let searchResult: WillhabenSearchResult;
  try {
    const data = JSON.parse(nextDataMatch[1]) as {
      props?: { pageProps?: { searchResult?: WillhabenSearchResult } };
    };
    if (!data.props?.pageProps?.searchResult) {
      return { items, nextPagePlan: null, totalEstimate: null, pageNumber: 1 };
    }
    searchResult = data.props.pageProps.searchResult;
  } catch {
    return { items, nextPagePlan: null, totalEstimate: null, pageNumber: 1 };
  }

  const ads = searchResult.advertSummaryList?.advertSummary ?? [];

  for (const ad of ads) {
    const attrs = ad.attributes?.attribute ?? [];
    const seoUrl = getAttr(attrs, 'SEO_URL');
    const detailUrl = seoUrl ? `/iad/${seoUrl}` : null;

    if (!ad.id || !detailUrl) continue;

    items.push({
      detailUrl,
      canonicalUrl: `https://www.willhaben.at${detailUrl}`,
      externalId: ad.id,
      sourceCode,
      discoveredAt: new Date().toISOString(),
      summaryPayload: {
        listingId: ad.id,
        detailUrl,
        titleRaw: getAttr(attrs, 'HEADING') ?? ad.description ?? null,
        priceRaw: getAttr(attrs, 'ESTATE_PRICE/PRICE_SUGGESTION') ?? getAttr(attrs, 'PRICE'),
        locationRaw: getAttr(attrs, 'LOCATION'),
        roomsRaw: getAttr(attrs, 'NUMBER_OF_ROOMS'),
        areaRaw: getAttr(attrs, 'ESTATE_SIZE/LIVING_AREA'),
      },
    });
  }

  // Pagination: if we got results, assume there's a next page if items > 0
  const pageNum = (requestPlan.metadata?.page as number) ?? 1;
  const totalEstimate = searchResult.rowsFound ?? null;
  const hasMore = ads.length > 0 && (totalEstimate === null || pageNum * 25 < totalEstimate);

  const nextPagePlan: RequestPlan | null = hasMore
    ? {
        ...requestPlan,
        url: requestPlan.url.replace(/page=\d+/, `page=${pageNum + 1}`),
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

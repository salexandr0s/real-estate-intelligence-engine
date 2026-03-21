import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@rei/contracts';
import type { FindMyHomeDiscoveryItem, JsonLdItemList, JsonLdListItem } from './dto.js';

const JSON_LD_REGEX = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

/**
 * findmyhome.at serves listing data via JSON-LD ItemList embedded in HTML.
 * Structure: { "@type": "ItemList", "itemListElement": [{ "@type": "ListItem", "item": {...} }] }
 */
export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<FindMyHomeDiscoveryItem> {
  const items: DiscoveryItem<FindMyHomeDiscoveryItem>[] = [];

  const itemList = extractItemList(html);
  if (!itemList) {
    return { items, nextPagePlan: null, totalEstimate: null, pageNumber: 1 };
  }

  const elements = itemList.itemListElement ?? [];

  for (const element of elements) {
    const listItem = element as JsonLdListItem;
    if (listItem['@type'] !== 'ListItem' || !listItem.item) continue;

    const apartment = listItem.item;
    const id = apartment.identifier ?? extractIdFromAtId(apartment['@id']);
    const detailUrl = apartment['@id'] ?? '';

    if (!id || !detailUrl) continue;

    const locationParts: string[] = [];
    if (apartment.address?.postalCode) locationParts.push(apartment.address.postalCode);
    if (apartment.address?.addressLocality) locationParts.push(apartment.address.addressLocality);
    if (apartment.address?.addressRegion) locationParts.push(apartment.address.addressRegion);

    items.push({
      detailUrl,
      canonicalUrl: detailUrl,
      externalId: id,
      sourceCode,
      discoveredAt: new Date().toISOString(),
      summaryPayload: {
        findmyhomeId: id,
        detailUrl,
        titleRaw: apartment.name ?? null,
        priceRaw: apartment.offers?.price ?? null,
        locationRaw: locationParts.length > 0 ? locationParts.join(' ') : null,
        roomsRaw: apartment.numberOfRooms ?? null,
        areaRaw: apartment.floorSize?.value ?? null,
      },
    });
  }

  const pageNum = Number(requestPlan.metadata?.['page']) || 1;
  const totalEstimate = itemList.numberOfItems ?? null;
  const hasMore =
    items.length > 0 && (totalEstimate === null || pageNum * items.length < totalEstimate);

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

/**
 * Extracts the JSON-LD ItemList block from the HTML.
 * Scans all ld+json scripts and returns the first one with "@type": "ItemList".
 */
function extractItemList(html: string): JsonLdItemList | null {
  let match: RegExpExecArray | null;
  JSON_LD_REGEX.lastIndex = 0;

  while ((match = JSON_LD_REGEX.exec(html)) !== null) {
    const jsonStr = match[1];
    if (!jsonStr) continue;

    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      if (parsed['@type'] === 'ItemList') {
        return parsed as unknown as JsonLdItemList;
      }
    } catch {
      // skip malformed JSON-LD blocks
    }
  }

  return null;
}

/**
 * Extracts numeric ID from a JSON-LD @id URL.
 * Example: "https://www.findmyhome.at/kaufen/wohnung/wien/schoene-3-zimmer-wohnung-501234" -> "501234"
 */
function extractIdFromAtId(atId: string | undefined): string | null {
  if (!atId) return null;
  const match = atId.match(/-(\d+)$/);
  return match?.[1] ?? null;
}

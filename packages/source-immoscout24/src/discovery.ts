import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@rei/contracts';
import type { Immoscout24DiscoveryItem, IS24CollectionPage } from './dto.js';

const BASE_URL = 'https://www.immobilienscout24.at';

/**
 * IS24 serves listing data via a JSON-LD CollectionPage embedded in a
 * `<script data-testid="collection-page-structured-data">` tag.
 *
 * Each listing is a RealEstateListing with name, url, description, image[],
 * datePosted, provider, and mainEntity (Apartment with address).
 *
 * The description field encodes area + rooms + address as text:
 *   "65,20 m2 . 3 Zimmer . Taborstrasse 42, 1020 Wien"
 */

const COLLECTION_RE =
  /<script[^>]*data-testid="collection-page-structured-data"[^>]*>([\s\S]*?)<\/script>/;

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<Immoscout24DiscoveryItem> {
  const items: DiscoveryItem<Immoscout24DiscoveryItem>[] = [];

  const scriptMatch = html.match(COLLECTION_RE);
  if (!scriptMatch?.[1]) {
    return { items, nextPagePlan: null, totalEstimate: null, pageNumber: 1 };
  }

  let collection: IS24CollectionPage;
  try {
    collection = JSON.parse(scriptMatch[1]) as IS24CollectionPage;
  } catch {
    return { items, nextPagePlan: null, totalEstimate: null, pageNumber: 1 };
  }

  const listItems = collection.mainEntity?.itemListElement ?? [];

  for (const listItem of listItems) {
    const listing = listItem.item;
    if (!listing?.url) continue;

    // Extract expose hash from URL: last path segment of /expose/{hash}
    const exposeId = extractExposeIdFromUrl(listing.url);
    if (!exposeId) continue;

    const detailUrl = `${BASE_URL}/expose/${exposeId}`;
    const desc = listing.description ?? '';

    // Parse description text for area, rooms, location
    const areaRaw = parseArea(desc);
    const roomsRaw = parseRooms(desc);
    const locationRaw = buildLocation(listing);

    items.push({
      detailUrl,
      canonicalUrl: detailUrl,
      externalId: exposeId,
      sourceCode,
      discoveredAt: new Date().toISOString(),
      summaryPayload: {
        exposeId,
        detailUrl,
        titleRaw: listing.name ?? null,
        priceRaw: null, // price is not in discovery JSON-LD
        locationRaw,
        roomsRaw,
        areaRaw,
      },
    });
  }

  const pageNum = Number(requestPlan.metadata?.['page']) || 1;
  const numberOfItems = collection.mainEntity?.numberOfItems ?? 0;

  // Detect pagination: check for pagination section in HTML
  const hasPagination = html.includes('data-testid="pagination-section"');
  const hasMore = items.length > 0 && hasPagination && (numberOfItems > items.length || pageNum === 1);

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
    totalEstimate: numberOfItems > 0 ? numberOfItems : null,
    pageNumber: pageNum,
  };
}

/** Extract hex hash expose ID from a URL like /expose/abc123def456789012345678 */
function extractExposeIdFromUrl(url: string): string | null {
  const m = url.match(/\/expose\/([a-f0-9]{24})/);
  return m?.[1] ?? null;
}

/** Parse area from description text: "65,20 m2" -> "65.20" */
function parseArea(desc: string): string | null {
  const m = desc.match(/([\d.,]+)\s*m\u00b2/);
  if (!m?.[1]) return null;
  return normalizeDecimal(m[1]);
}

/** Parse rooms from description text: "3 Zimmer" -> "3" */
function parseRooms(desc: string): string | null {
  const m = desc.match(/(\d+)\s*Zimmer/);
  return m?.[1] ?? null;
}

/** Build location string from JSON-LD address data */
function buildLocation(listing: { mainEntity?: { address?: { postalCode?: string; addressLocality?: string } } }): string | null {
  const addr = listing.mainEntity?.address;
  if (!addr) return null;
  const parts: string[] = [];
  if (addr.postalCode) parts.push(addr.postalCode);
  if (addr.addressLocality) parts.push(addr.addressLocality);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Build next page URL by replacing or appending /seite-N path segment. */
function buildNextPageUrl(currentUrl: string, nextPage: number): string {
  const parsed = new URL(currentUrl);
  parsed.pathname = parsed.pathname.replace(/\/seite-\d+$/, '');
  parsed.pathname = `${parsed.pathname}/seite-${nextPage}`;
  return parsed.toString();
}

/**
 * Normalize Austrian decimal format to standard format.
 * "65,20" -> "65.20", "1.250,50" -> "1250.50"
 */
function normalizeDecimal(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed;
}

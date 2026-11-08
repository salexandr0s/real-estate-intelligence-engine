import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@immoradar/contracts';
import type { Immoscout24DiscoveryItem, IS24CollectionPage } from './dto.js';
import { field, positiveNumberText, readEmbeddedState, text } from './embedded-state.js';

const BASE_URL = 'https://www.immobilienscout24.at';

/**
 * IS24 search pages carry their results in two places:
 *
 * - `window.__INITIAL_STATE__`, the app state, lists the page's hits under
 *   `reduxAsyncConnect.pageData.results` with expose ID, headline, price, area, rooms and
 *   address, next to the pagination. Every results page has it.
 * - A JSON-LD CollectionPage in `<script data-testid="collection-page-structured-data">` lists
 *   RealEstateListing nodes whose description encodes area, rooms and address as text:
 *   "65,20 m2 . 3 Zimmer . Taborstrasse 42, 1020 Wien". Only the first page has it.
 *
 * The app state is read first and the JSON-LD is the fallback.
 */

const COLLECTION_RE =
  /<script[^>]*data-testid="collection-page-structured-data"[^>]*>([\s\S]*?)<\/script>/;
const EXPOSE_ID_RE = /^[a-f0-9]{24}$/;

type DiscoverySummary = Omit<Immoscout24DiscoveryItem, 'exposeId' | 'detailUrl'>;

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<Immoscout24DiscoveryItem> {
  const pageNum = Number(requestPlan.metadata?.['page']) || 1;
  return (
    parseSearchState(html, sourceCode, requestPlan, pageNum) ??
    parseCollectionPage(html, sourceCode, requestPlan, pageNum)
  );
}

/** Reads the hits in `window.__INITIAL_STATE__`. Null when the page has none. */
function parseSearchState(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
  pageNum: number,
): DiscoveryPageResult<Immoscout24DiscoveryItem> | null {
  const results = field(
    readEmbeddedState(html, '__INITIAL_STATE__'),
    'reduxAsyncConnect',
    'pageData',
    'results',
  );
  const hits = field(results, 'hits');
  if (!Array.isArray(hits)) return null;

  const items: DiscoveryItem<Immoscout24DiscoveryItem>[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const exposeId = hitExposeId(hit);
    if (!exposeId || seen.has(exposeId)) continue;
    seen.add(exposeId);
    // Developer projects send price 0 and no area or rooms; those stay null.
    items.push(
      buildItem(sourceCode, exposeId, {
        titleRaw: text(field(hit, 'headline')),
        priceRaw: positiveNumberText(field(hit, 'primaryPrice')),
        locationRaw: text(field(hit, 'addressString')),
        roomsRaw: positiveNumberText(field(hit, 'numberOfRooms')),
        areaRaw: positiveNumberText(field(hit, 'primaryArea')),
      }),
    );
  }
  if (items.length === 0) return null;

  const nextUrl = text(field(results, 'pagination', 'nextURL'));
  const totalPages = Number(field(results, 'pagination', 'totalPages'));
  const hasMore = nextUrl !== null || (Number.isFinite(totalPages) && pageNum < totalPages);
  const totalHits = Number(field(results, 'totalHits'));

  return {
    items,
    nextPagePlan: hasMore ? buildNextPagePlan(requestPlan, pageNum) : null,
    totalEstimate: Number.isFinite(totalHits) && totalHits > 0 ? totalHits : null,
    pageNumber: pageNum,
  };
}

/** Reads the JSON-LD CollectionPage that the first results page carries. */
function parseCollectionPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
  pageNum: number,
): DiscoveryPageResult<Immoscout24DiscoveryItem> {
  const items: DiscoveryItem<Immoscout24DiscoveryItem>[] = [];
  const empty = { items, nextPagePlan: null, totalEstimate: null, pageNumber: pageNum };

  const scriptMatch = html.match(COLLECTION_RE);
  if (!scriptMatch?.[1]) return empty;

  let collection: IS24CollectionPage;
  try {
    collection = JSON.parse(scriptMatch[1]) as IS24CollectionPage;
  } catch {
    return empty;
  }

  for (const listItem of collection.mainEntity?.itemListElement ?? []) {
    const listing = listItem.item;
    if (!listing?.url) continue;

    const exposeId = extractExposeIdFromUrl(listing.url);
    if (!exposeId) continue;

    const desc = listing.description ?? '';
    items.push(
      buildItem(sourceCode, exposeId, {
        titleRaw: listing.name ?? null,
        priceRaw: null, // price is not in discovery JSON-LD
        locationRaw: buildLocation(listing),
        roomsRaw: parseRooms(desc),
        areaRaw: parseArea(desc),
      }),
    );
  }

  const numberOfItems = collection.mainEntity?.numberOfItems ?? 0;

  // Multi-strategy pagination detection (resilient to HTML changes)
  const hasPaginationMarker = html.includes('data-testid="pagination-section"');
  const hasSeiteLinks = /\/seite-\d+/.test(html);
  const hasTotalCountRoom = numberOfItems > 0 && pageNum * items.length < numberOfItems;

  const hasMore = items.length > 0 && (hasPaginationMarker || hasSeiteLinks || hasTotalCountRoom);

  return {
    items,
    nextPagePlan: hasMore ? buildNextPagePlan(requestPlan, pageNum) : null,
    totalEstimate: numberOfItems > 0 ? numberOfItems : null,
    pageNumber: pageNum,
  };
}

function buildItem(
  sourceCode: string,
  exposeId: string,
  summary: DiscoverySummary,
): DiscoveryItem<Immoscout24DiscoveryItem> {
  const detailUrl = `${BASE_URL}/expose/${exposeId}`;
  return {
    detailUrl,
    canonicalUrl: detailUrl,
    externalId: exposeId,
    sourceCode,
    discoveredAt: new Date().toISOString(),
    summaryPayload: { exposeId, detailUrl, ...summary },
  };
}

function buildNextPagePlan(requestPlan: RequestPlan, pageNum: number): RequestPlan {
  return {
    ...requestPlan,
    url: buildNextPageUrl(requestPlan.url, pageNum + 1),
    metadata: { ...requestPlan.metadata, page: pageNum + 1 },
  };
}

/** The hit's expose ID, from its own field or else its link. */
function hitExposeId(hit: unknown): string | null {
  const id = text(field(hit, 'exposeId'));
  if (id && EXPOSE_ID_RE.test(id)) return id;
  const url = text(field(hit, 'links', 'targetURL')) ?? text(field(hit, 'links', 'absoluteURL'));
  return url ? extractExposeIdFromUrl(url) : null;
}

/** Extract hex hash expose ID from a URL like /expose/abc123def456789012345678 */
function extractExposeIdFromUrl(url: string): string | null {
  const m = url.match(/\/expose\/([a-f0-9]{24})/);
  return m?.[1] ?? null;
}

/** Parse area from description text: "65,20 m2" -> "65.20" */
function parseArea(desc: string): string | null {
  const m = desc.match(/([\d.,]+)\s*m²/);
  if (!m?.[1]) return null;
  return normalizeDecimal(m[1]);
}

/** Parse rooms from description text: "3 Zimmer" -> "3" */
function parseRooms(desc: string): string | null {
  const m = desc.match(/(\d+)\s*Zimmer/);
  return m?.[1] ?? null;
}

/** Build location string from JSON-LD address data */
function buildLocation(listing: {
  mainEntity?: { address?: { postalCode?: string; addressLocality?: string } };
}): string | null {
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

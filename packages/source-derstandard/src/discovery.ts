import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@immoradar/contracts';
import type { DerStandardDiscoveryItem } from './dto.js';

const BASE_URL = 'https://immobilien.derstandard.at';

/**
 * derstandard.at links each listing as /detail/{ID}/{slug}, relative or as a full
 * immobilien.derstandard.at URL. A result card is usually an <li> holding:
 *   <h2> title
 *   <span class="adress"> location (e.g. "1070 Wien")
 *   area ("Wohnfläche 87 m²"), rooms ("Zimmer 3"), price ("Kaufpreis € 460.000")
 */

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<DerStandardDiscoveryItem> {
  const items: DiscoveryItem<DerStandardDiscoveryItem>[] = [];

  for (const link of findDetailLinks(html)) {
    const item = parseCardBody(link.id, link.path, link.scope, sourceCode);
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

interface DetailLink {
  id: string;
  /** Path without query, e.g. /detail/15086452/innenhof-idylle */
  path: string;
  /** Markup the fields are read from: the enclosing <li>, else the link's own content. */
  scope: string;
  inListItem: boolean;
}

interface Span {
  start: number;
  end: number;
}

/**
 * Each listing linked from the page once, in page order. When a listing is linked
 * both inside and outside a list item, the list item supplies its fields.
 */
function findDetailLinks(html: string): DetailLink[] {
  const listItems = listItemSpans(html);
  const links = new Map<string, DetailLink>();
  // Relative, protocol-relative or absolute on immobilien.derstandard.at; other hosts don't count.
  const linkPattern =
    /<a\s(?:[^>]*?\s)?href=(["'])((?:https?:)?(?:\/\/immobilien\.derstandard\.at)?\/detail\/(\d+)(?:[/?#][^"']*)?)\1[^>]*>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkPattern.exec(html)) !== null) {
    const href = m[2];
    const id = m[3];
    if (!href || !id || links.get(id)?.inListItem) continue;

    const listItem = innermostSpan(listItems, m.index);
    if (!listItem && links.has(id)) continue;

    links.set(id, {
      id,
      path: new URL(href, BASE_URL).pathname,
      scope: listItem
        ? html.slice(listItem.start, listItem.end)
        : linkContent(html, m.index + m[0].length),
      inListItem: listItem !== null,
    });
  }

  return [...links.values()];
}

/** Every <li> on the page, nested ones included, from its open tag to its close tag. */
function listItemSpans(html: string): Span[] {
  const spans: Span[] = [];
  const open: number[] = [];
  const tag = /<(\/?)li\b[^>]*>/gi;
  let m: RegExpExecArray | null;

  while ((m = tag.exec(html)) !== null) {
    if (!m[1]) {
      open.push(m.index);
      continue;
    }
    const start = open.pop();
    if (start !== undefined) spans.push({ start, end: m.index });
  }
  // An item that is never closed runs to the end of the page.
  for (const start of open) spans.push({ start, end: html.length });

  return spans;
}

function innermostSpan(spans: Span[], at: number): Span | null {
  let innermost: Span | null = null;
  for (const span of spans) {
    if (span.start < at && at < span.end && (innermost === null || span.start > innermost.start)) {
      innermost = span;
    }
  }
  return innermost;
}

/** The markup between a link's opening tag and its </a>. */
function linkContent(html: string, from: number): string {
  const close = /<\/a\s*>/gi;
  close.lastIndex = from;
  const end = close.exec(html)?.index ?? html.length;
  return html.slice(from, end);
}

function parseCardBody(
  id: string,
  detailUrl: string,
  cardBody: string,
  sourceCode: string,
): DiscoveryItem<DerStandardDiscoveryItem> | null {
  if (!id) return null;

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

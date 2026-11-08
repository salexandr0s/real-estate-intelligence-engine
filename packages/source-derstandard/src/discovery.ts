import type { DiscoveryItem, DiscoveryPageResult, RequestPlan } from '@immoradar/contracts';
import { stripTags } from './text.js';
import type { DerStandardDiscoveryItem } from './dto.js';

const BASE_URL = 'https://immobilien.derstandard.at';

/**
 * derstandard.at links each listing as /detail/{ID}/{slug}, relative or as a full
 * immobilien.derstandard.at URL. A result card is an <li class="sc-listing-card"> holding:
 *   <span class="property-address-zip-city"> postcode and city ("1070 Wien"), followed by
 *     <span class="property-address-rest"> when the advertiser gives street or area
 *   a price span ("€ 460.000")
 *   <h2> title
 *   footer items: area ("87 m²"), rooms ("3 Zimmer")
 *
 * A developer project's card links its title to the project page, which is not a listing. Some of
 * its units are links of their own, each with that unit's area, rooms and price. The card's own
 * figures start with "ab" and come from different units, so they never describe one listing.
 *
 * Older cards used <span class="adress"> and labelled values ("Wohnfläche 87 m²", "Zimmer 3",
 * "Kaufpreis € 460.000"). Those are still read when a card has neither footer items nor a price span.
 */

const PRICE_SPAN = /<span\s[^>]*class="[^"]*propertyPrice[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
const FOOTER_ITEM =
  /<div\s[^>]*class="[^"]*\bsc-listing-card-footer-item\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
const UNIT_ROW = /class="[^"]*\bsc-listing-card-sub-item\b/i;
const UNIT_VALUE = /<div\b[^>]*>([\s\S]*?)<\/div>/gi;

// Whole values only: "ab 46,72 m²" is a project's range, not a listing's area.
const AREA = /^([\d.,]+)\s*m²$/i;
const ROOMS = /^(\d+(?:,\d+)?)\s*Zimmer$/i;
const PRICE = /^€\s*([\d.]+(?:,\d+)?)$/;

export function parseDiscoveryPage(
  html: string,
  sourceCode: string,
  requestPlan: RequestPlan,
): DiscoveryPageResult<DerStandardDiscoveryItem> {
  const items = findDetailLinks(html).map((link) => parseCard(link, sourceCode));
  const pageNum = Number(requestPlan.metadata?.page) || 1;

  const nextPagePlan: RequestPlan | null =
    items.length > 0 && hasNextPage(html, pageNum)
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

/**
 * The pager is a row of buttons, one per page number, with the current page disabled. Older pages
 * linked each page as ?page=N instead.
 */
function hasNextPage(html: string, pageNum: number): boolean {
  const pager =
    /<nav\s[^>]*class="[^"]*\bpagination\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1] ?? '';
  const pages = [
    ...pager.matchAll(/<button\b[^>]*>\s*(\d+)\s*<\/button>/gi),
    ...html.matchAll(/href="[^"]*[?&]page=(\d+)[^"]*"/gi),
  ];
  return pages.some((m) => Number(m[1]) > pageNum);
}

interface DetailLink {
  id: string;
  /** Path without query, e.g. /detail/15086452/innenhof-idylle */
  path: string;
  /** Markup the fields are read from: the enclosing <li>, else the link's own content. */
  scope: string;
  /** The markup between the link's tags. */
  content: string;
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

    const content = linkContent(html, m.index + m[0].length);
    links.set(id, {
      id,
      path: new URL(href, BASE_URL).pathname,
      scope: listItem ? html.slice(listItem.start, listItem.end) : content,
      content,
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

function parseCard(link: DetailLink, sourceCode: string): DiscoveryItem<DerStandardDiscoveryItem> {
  const card = link.scope;
  // A project unit's figures are its own row. Without a row value the field stays empty.
  const figures = UNIT_ROW.test(link.content)
    ? figuresFrom(elementTexts(link.content, UNIT_VALUE))
    : cardFigures(card);

  return {
    detailUrl: link.path,
    canonicalUrl: `${BASE_URL}${link.path}`,
    externalId: link.id,
    sourceCode,
    discoveredAt: new Date().toISOString(),
    summaryPayload: {
      standardId: link.id,
      detailUrl: link.path,
      titleRaw: elementText(card, /<h2\b[^>]*>([\s\S]*?)<\/h2>/i),
      locationRaw: cardLocation(card),
      ...figures,
    },
  };
}

interface Figures {
  priceRaw: string | null;
  areaRaw: string | null;
  roomsRaw: string | null;
}

function cardFigures(card: string): Figures {
  const values = [...elementTexts(card, PRICE_SPAN), ...elementTexts(card, FOOTER_ITEM)];
  return values.length > 0 ? figuresFrom(values) : labelledFigures(card);
}

function figuresFrom(values: string[]): Figures {
  return {
    priceRaw: firstValue(values, PRICE, normalizePrice),
    areaRaw: firstValue(values, AREA, normalizeNumericString),
    roomsRaw: firstValue(values, ROOMS, normalizeNumericString),
  };
}

/** Older cards: "<span>Wohnfläche</span>103 m²", "Zimmer 3", "Kaufpreis € 460.000". */
function labelledFigures(card: string): Figures {
  const area =
    card.match(/Wohnfl[aä&;#228]che<\/span>\s*([\d.,]+)\s*m/i) ??
    card.match(/Wohnfl[aä]che\s+([\d.,]+)\s*m/i);
  const rooms = card.match(/Zimmer<\/span>\s*(\d+)/i) ?? card.match(/Zimmer\s+(\d+)/i);
  const price =
    card.match(/Kaufpreis<\/span>\s*€?\s*([\d.,]+)/i) ?? card.match(/Kaufpreis\s*€?\s*([\d.,]+)/i);

  return {
    priceRaw: price?.[1] ? normalizePrice(price[1]) : null,
    areaRaw: area?.[1] ? normalizeNumericString(area[1]) : null,
    roomsRaw: rooms?.[1] ?? null,
  };
}

/** "1190 Wien, Musterstraße, Döbling", or just "1190 Wien" when that is all the card gives. */
function cardLocation(card: string): string | null {
  const zipCity = elementText(
    card,
    /<span\s[^>]*class="[^"]*\bproperty-address-zip-city\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  );
  if (zipCity) {
    const rest = elementText(
      card,
      /<span\s[^>]*class="[^"]*\bproperty-address-rest\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    return [zipCity.replace(/\s*,\s*$/, ''), rest].filter(Boolean).join(', ');
  }
  return elementText(card, /<span\s[^>]*class="adress"[^>]*>([\s\S]*?)<\/span>/i);
}

function elementText(markup: string, pattern: RegExp): string | null {
  const inner = pattern.exec(markup)?.[1];
  return inner === undefined ? null : stripTags(inner) || null;
}

function elementTexts(markup: string, pattern: RegExp): string[] {
  return [...markup.matchAll(pattern)].map((m) => stripTags(m[1] ?? ''));
}

function firstValue(
  values: string[],
  pattern: RegExp,
  normalize: (value: string) => string,
): string | null {
  for (const text of values) {
    const value = pattern.exec(text)?.[1];
    if (value) return normalize(value);
  }
  return null;
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

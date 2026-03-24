import type {
  CrawlProfile,
  DiscoveryContext,
  DiscoveryPageResult,
  RequestPlan,
} from '@immoradar/contracts';
import { interactionDelay } from '@immoradar/scraper-core';
import type { EdikteDiscoveryItem } from './dto.js';
import { BASE_URL, EX_DB_PATH, SELECTORS, BUNDESLAND_CODES } from './constants.js';

/**
 * Playwright Page interface — minimal shape to avoid importing playwright as a dependency.
 */
interface PlaywrightPage {
  url(): string;
  content(): Promise<string>;
  locator(selector: string): {
    first(): {
      isVisible(): Promise<boolean>;
      click(): Promise<void>;
      fill(value: string): Promise<void>;
      selectOption(value: string): Promise<void>;
      textContent(): Promise<string | null>;
    };
    count(): Promise<number>;
    nth(index: number): {
      textContent(): Promise<string | null>;
      getAttribute(name: string): Promise<string | null>;
      locator(selector: string): {
        first(): {
          textContent(): Promise<string | null>;
          getAttribute(name: string): Promise<string | null>;
        };
      };
    };
  };
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  evaluate<R>(fn: (() => R) | string): Promise<R>;
}

/**
 * Extracts discovery items from the Domino search form / results page.
 *
 * On the first page, this fills and submits the search form.
 * On subsequent pages, the pipeline navigates to the nextPagePlan URL.
 */
export async function extractDiscoveryPage(
  ctx: DiscoveryContext,
  sourceCode: string,
): Promise<DiscoveryPageResult<EdikteDiscoveryItem>> {
  const page = ctx.page as PlaywrightPage;
  const isFirstPage = ctx.requestPlan.metadata?.['isFirstPage'] === true;

  if (isFirstPage) {
    await submitSearchForm(page, ctx.profile);
  }

  return parseResultsPage(page, ctx.requestPlan, sourceCode);
}

/**
 * Fills and submits the Domino search form.
 *
 * The form submits to /submitSuche with:
 * - BL (select): Bundesland code (Wien = "0")
 * - VKat (select): Property category code
 * - VOrt (input): Location text
 * - VPLZ (input): Postal code
 * - sebut (submit): Search button
 */
async function submitSearchForm(page: PlaywrightPage, profile: CrawlProfile): Promise<void> {
  // Select Bundesland — use numeric code (Wien = "0")
  const region = profile.regions?.[0] ?? 'wien';
  const regionKey = region.charAt(0).toUpperCase() + region.slice(1);
  const bundeslandCode = BUNDESLAND_CODES[regionKey] ?? BUNDESLAND_CODES.Wien ?? '0';

  try {
    const selectEl = page.locator(SELECTORS.bundeslandSelect).first();
    const isVisible = await selectEl.isVisible();
    if (isVisible) {
      await selectEl.selectOption(bundeslandCode);
      await interactionDelay();
    }
  } catch {
    // Fallback: try filling the Ort field
    try {
      const ortInput = page.locator(SELECTORS.ortInput).first();
      if (await ortInput.isVisible()) {
        await ortInput.fill('Wien');
        await interactionDelay();
      }
    } catch {
      // Neither worked
    }
  }

  // Submit the form via the sebut button
  try {
    const submitBtn = page.locator(SELECTORS.submitButton).first();
    const isVisible = await submitBtn.isVisible();
    if (isVisible) {
      await submitBtn.click();
      await interactionDelay();
    }
  } catch {
    // Fallback: try submitting the form directly
    try {
      await page.evaluate('document.querySelector(\'form[action*="submitSuche"]\')?.submit()');
    } catch {
      // Form submission failed
    }
  }

  // Wait for results to load — might be a table or a new page
  try {
    await page.waitForSelector(SELECTORS.resultsContainer, { timeout: 15_000 });
  } catch {
    // Results may already be loaded or use different container
  }
}

/**
 * Parses the search results page into discovery items.
 */
async function parseResultsPage(
  page: PlaywrightPage,
  requestPlan: RequestPlan,
  sourceCode: string,
): Promise<DiscoveryPageResult<EdikteDiscoveryItem>> {
  const html = await page.content();
  const items = parseResultsHtml(html, sourceCode);

  // Look for a "next page" link
  const nextPagePlan = await findNextPagePlan(page, requestPlan);

  const pageNumber = (requestPlan.metadata?.['pageNumber'] as number) ?? 1;

  return {
    items,
    nextPagePlan,
    totalEstimate: null,
    pageNumber,
  };
}

/**
 * Parse discovery items from the results HTML.
 *
 * Domino search results are typically rendered as HTML tables or
 * view entries. The exact structure will be determined by the recon script.
 *
 * This implementation uses a generic approach that extracts links
 * and surrounding text from the results page.
 */
function parseResultsHtml(
  html: string,
  sourceCode: string,
): Array<import('@immoradar/contracts').DiscoveryItem<EdikteDiscoveryItem>> {
  const items: Array<import('@immoradar/contracts').DiscoveryItem<EdikteDiscoveryItem>> = [];

  // Match links to edict detail pages
  // Real URL pattern: alldoc/<32-char-hex-UNID>!OpenDocument
  const linkPattern = /href="([^"]*alldoc\/[0-9a-f]{32}!OpenDocument[^"]*)"/gi;
  let match: RegExpExecArray | null;

  const seen = new Set<string>();

  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1] ?? '';
    const detailUrl = href.startsWith('http') ? href : `${BASE_URL}${EX_DB_PATH}/${href}`;

    // Extract Domino UNID from URL (32-char hex before !OpenDocument)
    const unidMatch = href.match(/\/([0-9a-f]{32})!/i);
    const ediktId = unidMatch?.[1] ?? href;

    if (seen.has(ediktId)) continue;
    seen.add(ediktId);

    // Try to extract surrounding context (text near the link)
    const linkPos = match.index;
    const contextStart = Math.max(0, linkPos - 500);
    const contextEnd = Math.min(html.length, linkPos + 500);
    const context = html.slice(contextStart, contextEnd);

    // Extract text snippets from context
    const titleRaw = extractTextNearLink(context, href);
    const locationRaw = extractLocationFromContext(context);

    items.push({
      detailUrl,
      canonicalUrl: detailUrl,
      externalId: ediktId,
      summaryPayload: {
        ediktId,
        detailUrl,
        titleRaw,
        courtName: extractCourtFromContext(context),
        caseNumber: extractCaseNumberFromContext(context),
        publicationDate: extractDateFromContext(context),
        propertyCategory: extractCategoryFromContext(context),
        locationRaw,
      },
      discoveredAt: new Date().toISOString(),
      sourceCode,
    });
  }

  return items;
}

// ── Context extraction helpers ─────────────────────────────────────────

function extractTextNearLink(context: string, _href: string): string | null {
  // Strip HTML tags to get plain text around the link
  const plain = context
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 0 ? plain.slice(0, 200) : null;
}

function extractLocationFromContext(context: string): string | null {
  // Look for Vienna postal codes or location patterns
  const locationMatch = context.match(/(\d{4})\s+(Wien|vienna)/i);
  if (locationMatch) return `${locationMatch[1]} ${locationMatch[2]}`;

  const plzMatch = context.match(/\b(1\d{3}0)\b/);
  if (plzMatch) return plzMatch[1] ?? null;

  return null;
}

function extractCourtFromContext(context: string): string | null {
  const courtMatch = context.match(/(?:BG|Bezirksgericht|LG|Landesgericht)\s+[^<,;]{3,40}/i);
  return courtMatch ? courtMatch[0].trim() : null;
}

function extractCaseNumberFromContext(context: string): string | null {
  // Austrian case number pattern: "10 E 1234/25z" or similar
  const caseMatch = context.match(/\d{1,3}\s+E\s+\d+\/\d{2}[a-z]?/i);
  return caseMatch ? caseMatch[0].trim() : null;
}

function extractDateFromContext(context: string): string | null {
  const dateMatch = context.match(/\d{2}\.\d{2}\.\d{4}/);
  return dateMatch ? dateMatch[0] : null;
}

function extractCategoryFromContext(context: string): string | null {
  const categories = [
    'Einfamilienhaus',
    'Wohnungseigentumsobjekt',
    'Zinshaus',
    'Mietwohnhaus',
    'Geschäftsobjekt',
    'Betriebsobjekt',
    'Grundstück',
    'Liegenschaft',
  ];
  for (const cat of categories) {
    if (context.includes(cat)) return cat;
  }
  return null;
}

/**
 * Look for a "next page" navigation element on the results page.
 */
async function findNextPagePlan(
  page: PlaywrightPage,
  currentPlan: RequestPlan,
): Promise<RequestPlan | null> {
  try {
    // Domino views often use "Next" or "Nächste" links
    // or numeric pagination links
    const html = await page.content();

    // Look for next page links — common Domino patterns
    const nextMatch = html.match(/href="([^"]*(?:Start=\d+|start=\d+|page=\d+)[^"]*)"/i);

    if (nextMatch) {
      const nextUrl = nextMatch[1]?.startsWith('http')
        ? nextMatch[1]
        : `${BASE_URL}${EX_DB_PATH}/${nextMatch[1]}`;

      const currentPage = (currentPlan.metadata?.['pageNumber'] as number) ?? 1;

      return {
        url: nextUrl,
        waitForSelector: SELECTORS.resultsContainer,
        metadata: {
          ...currentPlan.metadata,
          isFirstPage: false,
          pageNumber: currentPage + 1,
        },
      };
    }
  } catch {
    // No pagination found
  }

  return null;
}

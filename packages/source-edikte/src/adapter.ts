import type {
  CrawlProfile,
  DetailCapture,
  DetailContext,
  DiscoveryContext,
  DiscoveryItem,
  DiscoveryPageResult,
  RequestPlan,
  SourceAdapter,
  SourceAvailability,
} from '@immoradar/contracts';
import type { EdikteDiscoveryItem, EdikteDetailDTO } from './dto.js';
import { extractDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';
import {
  SOURCE_CODE,
  SOURCE_NAME,
  PARSER_VERSION,
  SEARCH_FORM_URL,
  SELECTORS,
} from './constants.js';

/**
 * Source adapter for Austrian forced real estate auctions (Zwangsversteigerungen)
 * published on edikte.justiz.gv.at.
 *
 * Key differences from standard adapters:
 * - Discovery uses Playwright form interaction (Lotus Notes/Domino)
 * - Detail extraction reads only the page HTML and lists attached PDFs in
 *   attachmentUrls for the documents pipeline
 */
export class EdikteAdapter implements SourceAdapter<EdikteDiscoveryItem, EdikteDetailDTO> {
  readonly sourceCode = SOURCE_CODE;
  readonly sourceName = SOURCE_NAME;
  readonly parserVersion = PARSER_VERSION;

  /**
   * Returns a single request plan pointing to the Domino search form.
   * The actual form interaction happens in extractDiscoveryPage.
   */
  async buildDiscoveryRequests(_profile: CrawlProfile): Promise<RequestPlan[]> {
    return [
      {
        url: SEARCH_FORM_URL,
        waitForSelector: SELECTORS.searchForm,
        waitForTimeout: 15_000,
        metadata: {
          isFirstPage: true,
          pageNumber: 1,
        },
      },
    ];
  }

  /**
   * Fills the Domino search form and extracts results.
   * Uses ctx.page (Playwright Page) for form interaction.
   */
  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<EdikteDiscoveryItem>> {
    return extractDiscoveryPage(ctx, this.sourceCode);
  }

  /**
   * Builds a detail page request from a discovery item.
   */
  async buildDetailRequest(item: DiscoveryItem<EdikteDiscoveryItem>): Promise<RequestPlan | null> {
    return {
      url: item.detailUrl,
      waitForSelector: SELECTORS.detailContent,
      waitForTimeout: 15_000,
    };
  }

  /**
   * Extracts structured data from an edict detail page's HTML.
   */
  async extractDetailPage(ctx: DetailContext): Promise<DetailCapture<EdikteDetailDTO>> {
    const canonicalUrl = this.canonicalizeUrl(ctx.requestPlan.url);
    const parsed = parseDetailPage(pageHtml(ctx), canonicalUrl);

    return {
      ...parsed,
      sourceCode: this.sourceCode,
      extractedAt: new Date().toISOString(),
      parserVersion: this.parserVersion,
      extractionStatus: 'captured',
    };
  }

  /**
   * Derives a deterministic key: "edikte:<ediktId>"
   */
  deriveSourceListingKey(detail: DetailCapture<EdikteDetailDTO>): string {
    const ediktId = detail.payload.ediktId;
    return `${this.sourceCode}:${ediktId}`;
  }

  /**
   * Strips Domino session parameters while preserving the document ID.
   */
  canonicalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove Domino session tokens and tracking params
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * Detects availability from the page content, including the auction date on it.
   */
  detectAvailability(ctx: DetailContext): SourceAvailability {
    return detectDetailAvailability(pageHtml(ctx));
  }
}

/** Callers pass the loaded page's HTML in the request metadata. */
function pageHtml(ctx: DetailContext): string {
  const html = ctx.requestPlan.metadata?.['html'];
  return typeof html === 'string' ? html : '';
}

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
import type { TemplateDiscoveryItem, TemplateDetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

// TODO: Replace these constants with your source's values
const SOURCE_CODE = 'template';
const SOURCE_NAME = 'template.example.com';
const BASE_URL = 'https://example.com';
const PARSER_VERSION = 1;

/**
 * Source adapter template.
 *
 * To create a new source:
 * 1. Copy this package to packages/source-<name>/
 * 2. Update SOURCE_CODE, SOURCE_NAME, BASE_URL
 * 3. Implement the discovery and detail parsers
 * 4. Register in apps/worker-scraper/src/adapter-registry.ts
 * 5. Add a normalization mapper in packages/normalization/src/sources/
 */
export class TemplateAdapter implements SourceAdapter<TemplateDiscoveryItem, TemplateDetailDTO> {
  readonly sourceCode = SOURCE_CODE;
  readonly sourceName = SOURCE_NAME;
  readonly parserVersion = PARSER_VERSION;

  /**
   * Builds the initial search page URLs for discovery crawling.
   * TODO: Construct search URLs with filters from the crawl profile.
   */
  async buildDiscoveryRequests(profile: CrawlProfile): Promise<RequestPlan[]> {
    // TODO: Build paginated search URLs based on the crawl profile
    // Example: return [{ url: `${BASE_URL}/search?page=1`, waitForSelector: '#results' }];
    return [
      {
        url: `${BASE_URL}/search`,
        waitForSelector: 'body',
        metadata: { profile: profile.name },
      },
    ];
  }

  /**
   * Extracts listing items from a discovery/search results page.
   */
  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<TemplateDiscoveryItem>> {
    const html = (ctx.requestPlan.metadata?.['html'] as string) ?? '';
    const page = new URL(ctx.requestPlan.url).searchParams.get('page') ?? '1';
    return parseDiscoveryPage(html, parseInt(page, 10), this.sourceCode);
  }

  /**
   * Builds the URL for fetching a specific listing's detail page.
   */
  async buildDetailRequest(
    item: DiscoveryItem<TemplateDiscoveryItem>,
  ): Promise<RequestPlan | null> {
    const url = item.detailUrl.startsWith('http') ? item.detailUrl : `${BASE_URL}${item.detailUrl}`;
    return { url, waitForSelector: 'body' };
  }

  /**
   * Extracts structured data from a listing detail page.
   */
  async extractDetailPage(ctx: DetailContext): Promise<DetailCapture<TemplateDetailDTO>> {
    const html = (ctx.requestPlan.metadata?.['html'] as string) ?? '';
    const canonicalUrl = this.canonicalizeUrl(ctx.requestPlan.url);
    const parsed = parseDetailPage(html, canonicalUrl, this.sourceCode);

    return {
      ...parsed,
      sourceCode: this.sourceCode,
      extractedAt: new Date().toISOString(),
      parserVersion: this.parserVersion,
      extractionStatus: 'captured',
    };
  }

  /**
   * Derives a deterministic source listing key from a detail capture.
   * Format: "<sourceCode>:<externalId>" or "<sourceCode>:<urlSlug>"
   * TODO: Use the source's native listing ID if available.
   */
  deriveSourceListingKey(detail: DetailCapture<TemplateDetailDTO>): string {
    if (detail.externalId) {
      return `${this.sourceCode}:${detail.externalId}`;
    }
    // Fallback: derive from URL
    const slug = new URL(detail.canonicalUrl).pathname.replace(/\//g, '_');
    return `${this.sourceCode}:${slug}`;
  }

  /**
   * Strips tracking parameters and normalizes the URL.
   */
  canonicalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * Detects listing availability from the detail page context.
   */
  detectAvailability(ctx: DetailContext): SourceAvailability {
    const html = (ctx.requestPlan.metadata?.['html'] as string) ?? '';
    return detectDetailAvailability(html, null);
  }
}

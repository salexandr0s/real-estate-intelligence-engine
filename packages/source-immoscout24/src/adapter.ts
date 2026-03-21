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
} from '@rei/contracts';
import type { Immoscout24DiscoveryItem, Immoscout24DetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

const BASE_URL = 'https://www.immobilienscout24.at';
const SEARCH_PATH = '/regional/oesterreich/immobilien';

export class Immoscout24Adapter
  implements SourceAdapter<Immoscout24DiscoveryItem, Immoscout24DetailDTO>
{
  readonly sourceCode = 'immoscout24';
  readonly sourceName = 'ImmobilienScout24.at';
  readonly parserVersion = 2;

  async buildDiscoveryRequests(profile: CrawlProfile): Promise<RequestPlan[]> {
    const maxPages = profile.maxPages ?? 5;
    const plans: RequestPlan[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(SEARCH_PATH, BASE_URL);
      url.searchParams.set('pagenumber', String(page));

      plans.push({
        url: url.toString(),
        waitForSelector: 'script[data-testid="collection-page-structured-data"]',
        waitForTimeout: 5000,
        metadata: { page },
      });
    }

    return plans;
  }

  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<Immoscout24DiscoveryItem>> {
    // In live mode, this would use ctx.page (Playwright Page)
    // For fixtures, we support passing HTML content through ctx.requestPlan.metadata
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as string | undefined;
    if (html) {
      return parseDiscoveryPage(html, ctx.profile.sourceCode, ctx.requestPlan);
    }

    // Live Playwright extraction would go here
    throw new Error('Live Playwright extraction not implemented -- use fixtures for testing');
  }

  async buildDetailRequest(
    item: DiscoveryItem<Immoscout24DiscoveryItem>,
  ): Promise<RequestPlan | null> {
    const exposeId = item.summaryPayload.exposeId;
    const url = `${BASE_URL}/expose/${exposeId}`;
    return {
      url,
      waitForSelector: 'script[type="application/ld+json"]',
      waitForTimeout: 5000,
    };
  }

  async extractDetailPage(
    ctx: DetailContext,
  ): Promise<DetailCapture<Immoscout24DetailDTO>> {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as string | undefined;
    if (html) {
      return parseDetailPage(html, ctx.requestPlan.url, ctx.sourceCode, this.parserVersion);
    }

    throw new Error('Live Playwright extraction not implemented -- use fixtures for testing');
  }

  deriveSourceListingKey(
    detail: DetailCapture<Immoscout24DetailDTO>,
  ): string {
    const id = detail.payload.immoscout24Id || detail.externalId || '';
    return `immoscout24:${id}`;
  }

  canonicalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove tracking params, keep core path
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  detectAvailability(ctx: DetailContext): SourceAvailability {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as string | undefined;
    if (html) {
      return detectDetailAvailability(html);
    }
    return { status: 'unknown' };
  }
}

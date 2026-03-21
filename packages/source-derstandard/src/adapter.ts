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
import type { DerStandardDiscoveryItem, DerStandardDetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

const BASE_URL = 'https://immobilien.derstandard.at';
const SEARCH_PATH = '/immobiliensuche/i/kaufen/wohnung/wien';

export class DerStandardAdapter
  implements SourceAdapter<DerStandardDiscoveryItem, DerStandardDetailDTO>
{
  readonly sourceCode = 'derstandard';
  readonly sourceName = 'derstandard.at Immobilien';
  readonly parserVersion = 2;

  async buildDiscoveryRequests(profile: CrawlProfile): Promise<RequestPlan[]> {
    const maxPages = profile.maxPages ?? 5;
    const plans: RequestPlan[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(SEARCH_PATH, BASE_URL);
      url.searchParams.set('page', String(page));

      plans.push({
        url: url.toString(),
        waitForSelector: '.results-container a[href*="/detail/"]',
        waitForTimeout: 5000,
        metadata: { page },
      });
    }

    return plans;
  }

  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<DerStandardDiscoveryItem>> {
    // In live mode, this would use ctx.page (Playwright Page)
    // For fixtures, we support passing HTML content through ctx.requestPlan.metadata
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.html as
      | string
      | undefined;
    if (html) {
      return parseDiscoveryPage(html, ctx.profile.sourceCode, ctx.requestPlan);
    }

    // Live Playwright extraction would go here
    throw new Error('Live Playwright extraction not implemented — use fixtures for testing');
  }

  async buildDetailRequest(
    item: DiscoveryItem<DerStandardDiscoveryItem>,
  ): Promise<RequestPlan | null> {
    return {
      url: item.detailUrl.startsWith('http')
        ? item.detailUrl
        : `${BASE_URL}${item.detailUrl}`,
      waitForSelector: '#listing-detail-data',
      waitForTimeout: 5000,
    };
  }

  async extractDetailPage(
    ctx: DetailContext,
  ): Promise<DetailCapture<DerStandardDetailDTO>> {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.html as
      | string
      | undefined;
    if (html) {
      return parseDetailPage(html, ctx.requestPlan.url, ctx.sourceCode, this.parserVersion);
    }

    throw new Error('Live Playwright extraction not implemented — use fixtures for testing');
  }

  deriveSourceListingKey(detail: DetailCapture<DerStandardDetailDTO>): string {
    const id = detail.payload.standardId || detail.externalId || '';
    return `derstandard:${id}`;
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
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.html as
      | string
      | undefined;
    if (html) {
      return detectDetailAvailability(html);
    }
    return { status: 'unknown' };
  }
}

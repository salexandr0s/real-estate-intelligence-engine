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
import type { DerStandardDiscoveryItem, DerStandardDetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

const BASE_URL = 'https://immobilien.derstandard.at';
// Apartments for sale in Vienna. The old /immobiliensuche/i/kaufen/wohnung/wien path answers 404.
const SEARCH_PATH = '/suche/wien/kaufen-wohnung';

export class DerStandardAdapter implements SourceAdapter<
  DerStandardDiscoveryItem,
  DerStandardDetailDTO
> {
  readonly sourceCode = 'derstandard';
  readonly sourceName = 'derstandard.at Immobilien';
  readonly parserVersion = 3;

  async buildDiscoveryRequests(_profile: CrawlProfile): Promise<RequestPlan[]> {
    const url = new URL(SEARCH_PATH, BASE_URL);
    url.searchParams.set('page', '1');

    // Only seed page 1 — the discovery worker follows nextPagePlan from parsers
    return [
      {
        url: url.toString(),
        waitForSelector: 'a[href*="/detail/"]',
        waitForTimeout: 5000,
        metadata: { page: 1 },
      },
    ];
  }

  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<DerStandardDiscoveryItem>> {
    // In live mode, this would use ctx.page (Playwright Page)
    // For fixtures, we support passing HTML content through ctx.requestPlan.metadata
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.html as string | undefined;
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
      url: item.detailUrl.startsWith('http') ? item.detailUrl : `${BASE_URL}${item.detailUrl}`,
      waitForSelector: 'h1',
      waitForTimeout: 5000,
    };
  }

  async extractDetailPage(ctx: DetailContext): Promise<DetailCapture<DerStandardDetailDTO>> {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.html as string | undefined;
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
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.html as string | undefined;
    if (html) {
      return detectDetailAvailability(html);
    }
    return { status: 'unknown' };
  }
}

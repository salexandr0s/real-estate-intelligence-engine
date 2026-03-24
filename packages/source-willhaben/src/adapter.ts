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
import type { WillhabenDiscoveryItem, WillhabenDetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

const BASE_URL = 'https://www.willhaben.at';
const BASE_SEARCH_PATH = '/iad/immobilien/eigentumswohnung';

export class WillhabenAdapter implements SourceAdapter<WillhabenDiscoveryItem, WillhabenDetailDTO> {
  readonly sourceCode = 'willhaben';
  readonly sourceName = 'willhaben.at';
  readonly parserVersion = 1;

  async buildDiscoveryRequests(profile: CrawlProfile): Promise<RequestPlan[]> {
    const regionSlug = profile.regions?.[0] ?? 'wien';
    const url = new URL(`${BASE_SEARCH_PATH}/${regionSlug}`, BASE_URL);
    url.searchParams.set('page', '1');
    url.searchParams.set('rows', '25');
    url.searchParams.set('sort', '1');

    // Only seed page 1 — the discovery worker follows nextPagePlan from parsers
    return [
      {
        url: url.toString(),
        waitForSelector: '#__NEXT_DATA__',
        waitForTimeout: 5000,
        metadata: { page: 1 },
      },
    ];
  }

  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<WillhabenDiscoveryItem>> {
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
    item: DiscoveryItem<WillhabenDiscoveryItem>,
  ): Promise<RequestPlan | null> {
    return {
      url: item.detailUrl.startsWith('http') ? item.detailUrl : `${BASE_URL}${item.detailUrl}`,
      waitForSelector: '#__NEXT_DATA__',
      waitForTimeout: 5000,
    };
  }

  async extractDetailPage(ctx: DetailContext): Promise<DetailCapture<WillhabenDetailDTO>> {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.html as string | undefined;
    if (html) {
      return parseDetailPage(html, ctx.requestPlan.url, ctx.sourceCode, this.parserVersion);
    }

    throw new Error('Live Playwright extraction not implemented — use fixtures for testing');
  }

  deriveSourceListingKey(detail: DetailCapture<WillhabenDetailDTO>): string {
    const id = detail.payload.willhabenId || detail.externalId || '';
    return `willhaben:${id}`;
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

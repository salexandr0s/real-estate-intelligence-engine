// NOTE: Site inaccessible as of 2026-03-21 (ECONNREFUSED). DNS resolves to 217.160.0.8 (IONOS)
// but the web server is not responding. Skeleton adapter with synthetic fixtures.
// Marked is_active=false in seed. Re-check periodically.

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
import type { OpenImmoDiscoveryItem, OpenImmoDetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

const BASE_URL = 'https://www.openimmo.at';
const SEARCH_PATH = '/suche';

export class OpenImmoAdapter implements SourceAdapter<OpenImmoDiscoveryItem, OpenImmoDetailDTO> {
  readonly sourceCode = 'openimmo';
  readonly sourceName = 'openimmo.at';
  readonly parserVersion = 1;

  async buildDiscoveryRequests(profile: CrawlProfile): Promise<RequestPlan[]> {
    const url = new URL(SEARCH_PATH, BASE_URL);
    url.searchParams.set('typ', 'wohnung');
    url.searchParams.set('aktion', 'kaufen');
    url.searchParams.set('ort', 'wien');
    url.searchParams.set('seite', '1');
    if (profile.regions?.length) url.searchParams.set('region', profile.regions[0]!);

    // Only seed page 1 — the discovery worker follows nextPagePlan from parsers
    return [
      {
        url: url.toString(),
        waitForSelector: '#search-data',
        waitForTimeout: 5000,
        metadata: { page: 1 },
      },
    ];
  }

  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<OpenImmoDiscoveryItem>> {
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
    item: DiscoveryItem<OpenImmoDiscoveryItem>,
  ): Promise<RequestPlan | null> {
    return {
      url: item.detailUrl.startsWith('http') ? item.detailUrl : `${BASE_URL}${item.detailUrl}`,
      waitForSelector: '#listing-data',
      waitForTimeout: 5000,
    };
  }

  async extractDetailPage(ctx: DetailContext): Promise<DetailCapture<OpenImmoDetailDTO>> {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.html as string | undefined;
    if (html) {
      return parseDetailPage(html, ctx.requestPlan.url, ctx.sourceCode, this.parserVersion);
    }

    throw new Error('Live Playwright extraction not implemented — use fixtures for testing');
  }

  deriveSourceListingKey(detail: DetailCapture<OpenImmoDetailDTO>): string {
    const id = detail.payload.openimmoId || detail.externalId || '';
    return `openimmo:${id}`;
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

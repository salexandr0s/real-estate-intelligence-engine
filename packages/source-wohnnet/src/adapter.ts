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
import type { WohnnetDiscoveryItem, WohnnetDetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

const BASE_URL = 'https://www.wohnnet.at';
const SEARCH_PATH = '/immobilien/eigentumswohnungen/wien';

export class WohnnetAdapter implements SourceAdapter<WohnnetDiscoveryItem, WohnnetDetailDTO> {
  readonly sourceCode = 'wohnnet';
  readonly sourceName = 'wohnnet.at';
  readonly parserVersion = 1;

  async buildDiscoveryRequests(_profile: CrawlProfile): Promise<RequestPlan[]> {
    const url = new URL(SEARCH_PATH, BASE_URL);
    url.searchParams.set('seite', '1');

    // Only seed page 1 — the discovery worker follows nextPagePlan from parsers
    return [
      {
        url: url.toString(),
        waitForSelector: '.realty-result',
        waitForTimeout: 5000,
        metadata: { page: 1 },
      },
    ];
  }

  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<WohnnetDiscoveryItem>> {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as
      | string
      | undefined;
    if (html) {
      return parseDiscoveryPage(html, ctx.profile.sourceCode, ctx.requestPlan);
    }

    // Live Playwright extraction would go here
    throw new Error('Live Playwright extraction not implemented — use fixtures for testing');
  }

  async buildDetailRequest(item: DiscoveryItem<WohnnetDiscoveryItem>): Promise<RequestPlan | null> {
    return {
      url: item.detailUrl.startsWith('http') ? item.detailUrl : `${BASE_URL}${item.detailUrl}`,
      waitForSelector: '.realty-eckdaten',
      waitForTimeout: 5000,
    };
  }

  async extractDetailPage(ctx: DetailContext): Promise<DetailCapture<WohnnetDetailDTO>> {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as
      | string
      | undefined;
    if (html) {
      return parseDetailPage(html, ctx.requestPlan.url, ctx.sourceCode, this.parserVersion);
    }

    throw new Error('Live Playwright extraction not implemented — use fixtures for testing');
  }

  deriveSourceListingKey(detail: DetailCapture<WohnnetDetailDTO>): string {
    const id = detail.payload.wohnnetId || detail.externalId || '';
    return `wohnnet:${id}`;
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
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as
      | string
      | undefined;
    if (html) {
      return detectDetailAvailability(html);
    }
    return { status: 'unknown' };
  }
}

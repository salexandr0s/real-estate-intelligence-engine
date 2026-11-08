// findmyhome.at source adapter (parser v3).
// Discovery parsing reads HTML cards with Bootstrap grid layout.
// Card structure: <h3 class="obj_list">, <strong>Ort/Flaeche/Zimmer</strong>, /{numericId} detail URLs.
// Detail pages are rendered in the DOM and carry no JSON-LD.

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
import type { FindMyHomeDiscoveryItem, FindMyHomeDetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

const BASE_URL = 'https://www.findmyhome.at';
const SEARCH_PATH = '/immo/wohnung-kaufen/wien';

export class FindMyHomeAdapter implements SourceAdapter<
  FindMyHomeDiscoveryItem,
  FindMyHomeDetailDTO
> {
  readonly sourceCode = 'findmyhome';
  readonly sourceName = 'findmyhome.at';
  readonly parserVersion = 3;

  async buildDiscoveryRequests(_profile: CrawlProfile): Promise<RequestPlan[]> {
    const url = new URL(SEARCH_PATH, BASE_URL);

    // Only seed page 1 — the discovery worker follows nextPagePlan from parsers
    return [
      {
        url: url.toString(),
        waitForSelector: 'h3.obj_list',
        waitForTimeout: 5000,
        metadata: { page: 1 },
      },
    ];
  }

  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<FindMyHomeDiscoveryItem>> {
    // In live mode, this would use ctx.page (Playwright Page)
    // For fixtures, we support passing HTML content through ctx.requestPlan.metadata
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as
      | string
      | undefined;
    if (html) {
      return parseDiscoveryPage(html, ctx.profile.sourceCode, ctx.requestPlan);
    }

    // Live Playwright extraction would go here
    throw new Error('Live Playwright extraction not implemented — use fixtures for testing');
  }

  async buildDetailRequest(
    item: DiscoveryItem<FindMyHomeDiscoveryItem>,
  ): Promise<RequestPlan | null> {
    return {
      url: item.detailUrl.startsWith('http') ? item.detailUrl : `${BASE_URL}${item.detailUrl}`,
      // Waiting for JSON-LD would use up the whole timeout, since these pages have none.
      waitForSelector: '.immo_header_value, h1',
      waitForTimeout: 5000,
    };
  }

  async extractDetailPage(ctx: DetailContext): Promise<DetailCapture<FindMyHomeDetailDTO>> {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as
      | string
      | undefined;
    if (html) {
      return parseDetailPage(html, ctx.requestPlan.url, ctx.sourceCode, this.parserVersion);
    }

    throw new Error('Live Playwright extraction not implemented — use fixtures for testing');
  }

  deriveSourceListingKey(detail: DetailCapture<FindMyHomeDetailDTO>): string {
    const id = detail.payload.findmyhomeId || detail.externalId || '';
    return `findmyhome:${id}`;
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

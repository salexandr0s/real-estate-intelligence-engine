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
import type { RemaxDiscoveryItem, RemaxDetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

const BASE_URL = 'https://www.remax.at';
const SEARCH_PATH = '/de/immobilien/immobilien-suchen';

export class RemaxAdapter
  implements SourceAdapter<RemaxDiscoveryItem, RemaxDetailDTO>
{
  readonly sourceCode = 'remax';
  readonly sourceName = 'RE/MAX Austria';
  readonly parserVersion = 2;

  async buildDiscoveryRequests(profile: CrawlProfile): Promise<RequestPlan[]> {
    const maxPages = profile.maxPages ?? 5;
    const plans: RequestPlan[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(SEARCH_PATH, BASE_URL);
      url.searchParams.set('page', String(page));
      if (profile.propertyType) url.searchParams.set('type', profile.propertyType);
      if (profile.regions?.length) url.searchParams.set('region', profile.regions[0]!);

      plans.push({
        url: url.toString(),
        waitForSelector: '.property-card',
        waitForTimeout: 5000,
        metadata: { page },
      });
    }

    return plans;
  }

  async extractDiscoveryPage(
    ctx: DiscoveryContext,
  ): Promise<DiscoveryPageResult<RemaxDiscoveryItem>> {
    // In live mode, this would use ctx.page (Playwright Page)
    // For fixtures, we support passing HTML content through ctx.requestPlan.metadata
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as
      | string
      | undefined;
    if (html) {
      return parseDiscoveryPage(html, ctx.profile.sourceCode, ctx.requestPlan);
    }

    // Live Playwright extraction would go here
    throw new Error('Live Playwright extraction not implemented -- use fixtures for testing');
  }

  async buildDetailRequest(
    item: DiscoveryItem<RemaxDiscoveryItem>,
  ): Promise<RequestPlan | null> {
    // Detail URLs from discovery are already full URLs with id= param
    const url = item.detailUrl.startsWith('http')
      ? item.detailUrl
      : `${BASE_URL}/index.php?page=objekt&t=1&srid=-1&s=1&id=${item.externalId ?? ''}&p=1&lang=de`;

    return {
      url,
      waitForSelector: 'h1',
      waitForTimeout: 5000,
    };
  }

  async extractDetailPage(
    ctx: DetailContext,
  ): Promise<DetailCapture<RemaxDetailDTO>> {
    const html = (ctx.requestPlan.metadata as Record<string, unknown>)?.['html'] as
      | string
      | undefined;
    if (html) {
      return parseDetailPage(html, ctx.requestPlan.url, ctx.sourceCode, this.parserVersion);
    }

    throw new Error('Live Playwright extraction not implemented -- use fixtures for testing');
  }

  deriveSourceListingKey(
    detail: DetailCapture<RemaxDetailDTO>,
  ): string {
    const id = detail.payload.remaxId || detail.externalId || '';
    return `remax:${id}`;
  }

  canonicalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // For id= query param URLs, keep the id param only
      const id = parsed.searchParams.get('id');
      if (id) {
        parsed.search = '';
        parsed.searchParams.set('id', id);
        parsed.hash = '';
        return parsed.toString();
      }
      // For path-based URLs, strip query and hash
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

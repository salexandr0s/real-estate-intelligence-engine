// NOTE: Site accessible as of 2026-03-21. Default search at /immobiliensuche shows results
// server-side (821 listings found). Card structure uses Bootstrap grid with
// <h3 class="obj_list">, <strong>Ort/Fläche/Zimmer</strong> fields, and /{numericId} detail URLs.
// Parser uses synthetic fixtures — needs rewrite to match real HTML card structure.
// Real HTML captured to /tmp/rei-captures/findmyhome/no-results.html.

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
import type { FindMyHomeDiscoveryItem, FindMyHomeDetailDTO } from './dto.js';
import { parseDiscoveryPage } from './discovery.js';
import { parseDetailPage, detectDetailAvailability } from './detail.js';

const BASE_URL = 'https://www.findmyhome.at';
const SEARCH_PATH = '/immobiliensuche';

export class FindMyHomeAdapter
  implements SourceAdapter<FindMyHomeDiscoveryItem, FindMyHomeDetailDTO>
{
  readonly sourceCode = 'findmyhome';
  readonly sourceName = 'findmyhome.at';
  readonly parserVersion = 1;

  async buildDiscoveryRequests(profile: CrawlProfile): Promise<RequestPlan[]> {
    const maxPages = profile.maxPages ?? 5;
    const plans: RequestPlan[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(SEARCH_PATH, BASE_URL);
      url.searchParams.set('page', String(page));
      if (profile.regions?.length) {
        url.searchParams.set('region', profile.regions[0]!);
      }

      plans.push({
        url: url.toString(),
        waitForSelector: 'script[type="application/ld+json"]',
        waitForTimeout: 5000,
        metadata: { page },
      });
    }

    return plans;
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
      waitForSelector: 'script[type="application/ld+json"]',
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

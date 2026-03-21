import type { DiscoveryPageResult, RequestPlan } from '@rei/contracts';
import type { TemplateDiscoveryItem } from './dto.js';

/**
 * Parses a discovery/search results page and extracts listing items.
 * TODO: Implement for your source's HTML/JSON structure.
 *
 * @param html - The raw HTML content of the search results page
 * @param currentPage - Current page number (1-indexed)
 * @param sourceCode - The source code identifier
 */
export function parseDiscoveryPage(
  html: string,
  currentPage: number,
  sourceCode: string,
): DiscoveryPageResult<TemplateDiscoveryItem> {
  // TODO: Parse the search results from the HTML
  // Extract listing items, build next page URL if more results exist

  throw new Error(`parseDiscoveryPage not implemented for ${sourceCode}`);
}

/**
 * Builds the URL for the next page of search results, or null if no more pages.
 * TODO: Implement pagination logic for your source.
 */
export function buildNextPagePlan(
  _currentPage: number,
  _totalEstimate: number | null,
  _baseUrl: string,
): RequestPlan | null {
  // TODO: Return a RequestPlan for the next page, or null if done
  return null;
}

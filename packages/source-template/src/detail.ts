import type { DetailCapture, SourceAvailability } from '@rei/contracts';
import type { TemplateDetailDTO } from './dto.js';

/**
 * Parses a listing detail page and extracts structured data.
 * TODO: Implement for your source's detail page HTML/JSON structure.
 *
 * @param html - The raw HTML content of the detail page
 * @param canonicalUrl - The canonical URL of the listing
 * @param sourceCode - The source code identifier
 */
export function parseDetailPage(
  html: string,
  canonicalUrl: string,
  sourceCode: string,
): Omit<DetailCapture<TemplateDetailDTO>, 'sourceCode' | 'extractedAt' | 'parserVersion' | 'extractionStatus'> {
  // TODO: Parse listing details from the HTML
  // Extract: title, price, area, rooms, address, coordinates, images, etc.

  throw new Error(`parseDetailPage not implemented for ${sourceCode}`);
}

/**
 * Detects the availability status of a listing from its detail page.
 * TODO: Implement for your source's sold/removed/reserved markers.
 */
export function detectDetailAvailability(
  html: string,
  _responseStatus: number | null,
): SourceAvailability {
  // TODO: Check for sold/removed/reserved indicators in the HTML
  // Common patterns:
  // - HTTP 404/410 → { status: 'removed' }
  // - "Verkauft" banner → { status: 'sold' }
  // - "Reserviert" banner → { status: 'reserved' }

  if (!html) return { status: 'not_found' };
  return { status: 'available' };
}

import type { SourceRawListingBase } from '@immoradar/contracts';
import type { FactExtraction } from '@immoradar/documents';

/**
 * Item extracted from the Domino search results table.
 */
export interface EdikteDiscoveryItem {
  /** Domino document ID (UNID or view entry key) */
  ediktId: string;
  /** URL to the edict detail page */
  detailUrl: string;
  /** Brief title or description from the search results */
  titleRaw: string | null;
  /** Court name (e.g., "BG Innere Stadt Wien") */
  courtName: string | null;
  /** Case number / Aktenzeichen (e.g., "10 E 1234/25z") */
  caseNumber: string | null;
  /** Publication date as raw string */
  publicationDate: string | null;
  /** Domino property category label */
  propertyCategory: string | null;
  /** Location text from search results */
  locationRaw: string | null;
}

/**
 * Structured data extracted from an edict detail page + attached PDFs.
 */
export interface EdikteDetailDTO extends SourceRawListingBase {
  /** Domino document ID */
  ediktId: string;
  /** Court name */
  courtName: string | null;
  /** Case number / Aktenzeichen */
  caseNumber: string | null;
  /** Raw auction date string (e.g., "15.04.2026 um 10:00 Uhr") */
  auctionDateRaw: string | null;
  /** Schätzwert — appraised market value (raw string) */
  appraisedValueRaw: string | null;
  /** Mindestgebot — minimum bid (raw string, often ⅔ of Schätzwert) */
  minimumBidRaw: string | null;
  /** Viewing dates as raw strings */
  viewingDatesRaw: string[];
  /** Legal notice text from the edict */
  legalNoticesRaw: string | null;
  /** PDF attachment URLs found on the detail page */
  attachmentPdfUrls: Array<{ url: string; label: string }>;
  /** Publication date */
  publicationDate: string | null;
  /** Domino property category label */
  sourcePropertyCategory: string | null;
  /** Facts extracted from PDF text or AI */
  pdfExtractedFacts: FactExtraction[];
  /** How the PDF was processed */
  pdfExtractionMethod: 'text' | 'ai' | 'none';
}

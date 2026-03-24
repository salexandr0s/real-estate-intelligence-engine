/**
 * PDF text extraction using pdf-parse (Mozilla pdf.js wrapper).
 *
 * Handles compressed streams, font encodings, and multi-page documents.
 * For scanned PDFs without a text layer, returns empty text —
 * callers should fall back to AI-based extraction.
 */

import pdfParse from 'pdf-parse';

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
}

const PDF_MAGIC = Buffer.from('%PDF');

/**
 * Extract text content from a PDF buffer.
 *
 * Uses pdf-parse (pdf.js) for robust extraction that handles
 * compressed streams, CIDFont encodings, and encrypted PDFs.
 * Returns empty text for scanned/image-only PDFs.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  // Verify PDF magic bytes
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(PDF_MAGIC)) {
    return { text: '', pageCount: 0 };
  }

  try {
    const result = await pdfParse(buffer, {
      // Limit to prevent OOM on huge documents
      max: 50,
    });

    const text = (result.text ?? '').replace(/\s+/g, ' ').trim();
    const pageCount = result.numpages ?? 0;

    return { text, pageCount };
  } catch {
    // pdf-parse can throw on malformed/encrypted PDFs — return empty gracefully
    return { text: '', pageCount: 0 };
  }
}

/**
 * Heuristic to detect if extracted text is too sparse to be useful.
 * Scanned PDFs often yield only a few garbage characters.
 */
export function isTextExtractionUseful(result: PdfExtractionResult): boolean {
  if (result.text.length === 0) return false;
  // At least 50 chars per page on average suggests real text content
  const charsPerPage = result.text.length / Math.max(result.pageCount, 1);
  return charsPerPage >= 50;
}

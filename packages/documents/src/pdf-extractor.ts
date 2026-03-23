/**
 * Simple PDF text extraction for text-layer PDFs.
 *
 * Uses basic regex-based extraction without external dependencies.
 * Suitable for PDFs with embedded text layers (e.g., real estate exposés).
 * For scanned PDFs, a proper OCR-based extractor should be added later.
 */

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
}

const PDF_MAGIC = Buffer.from('%PDF');

/**
 * Extract text content from a PDF buffer.
 *
 * Works by finding text-rendering operators in the PDF stream:
 * - Tj (show string)
 * - TJ (show strings array)
 * - Parenthesized text literals
 *
 * This is a best-effort approach for simple text-layer PDFs.
 * Returns empty text for binary/scanned PDFs.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  // Verify PDF magic bytes
  if (!buffer.subarray(0, 4).equals(PDF_MAGIC)) {
    return { text: '', pageCount: 0 };
  }

  const raw = buffer.toString('latin1');

  // Count pages by looking for /Type /Page entries (not /Pages)
  const pageMatches = raw.match(/\/Type\s*\/Page(?!s)\b/g);
  const pageCount = pageMatches?.length ?? 0;

  // Extract text between stream...endstream blocks
  const textChunks: string[] = [];
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let streamMatch: RegExpExecArray | null;

  while ((streamMatch = streamRegex.exec(raw)) !== null) {
    const streamContent = streamMatch[1] ?? '';

    // Extract parenthesized text literals from Tj/TJ operators
    const textRegex = /\(([^)]*)\)\s*T[jJ]/g;
    let textMatch: RegExpExecArray | null;

    while ((textMatch = textRegex.exec(streamContent)) !== null) {
      const decoded = decodePdfString(textMatch[1] ?? '');
      if (decoded.trim()) {
        textChunks.push(decoded);
      }
    }

    // Also extract BT...ET text blocks with parenthesized strings
    const btRegex = /BT\s([\s\S]*?)ET/g;
    let btMatch: RegExpExecArray | null;

    while ((btMatch = btRegex.exec(streamContent)) !== null) {
      const blockContent = btMatch[1] ?? '';
      const innerTextRegex = /\(([^)]*)\)/g;
      let innerMatch: RegExpExecArray | null;

      while ((innerMatch = innerTextRegex.exec(blockContent)) !== null) {
        const decoded = decodePdfString(innerMatch[1] ?? '');
        if (decoded.trim()) {
          textChunks.push(decoded);
        }
      }
    }
  }

  const text = textChunks.join(' ').replace(/\s+/g, ' ').trim();

  return { text, pageCount };
}

/**
 * Decode PDF escape sequences in a parenthesized string.
 */
function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

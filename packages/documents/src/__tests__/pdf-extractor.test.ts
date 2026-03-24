/**
 * Tests for extractPdfText — pdf-parse based PDF text extraction.
 *
 * Since pdf-parse requires properly structured PDFs, synthetic buffers
 * only test error handling. Real PDF extraction is tested via integration
 * tests with fixture files (see recon-edikte.ts output).
 */
import { describe, it, expect } from 'vitest';
import { extractPdfText, isTextExtractionUseful } from '../pdf-extractor.js';

// ── Invalid input ─────────────────────────────────────────────────────────

describe('invalid input', () => {
  it('returns empty result for empty buffer', async () => {
    const result = await extractPdfText(Buffer.alloc(0));
    expect(result.text).toBe('');
    expect(result.pageCount).toBe(0);
  });

  it('returns empty result for non-PDF buffer', async () => {
    const result = await extractPdfText(Buffer.from('This is not a PDF file'));
    expect(result.text).toBe('');
    expect(result.pageCount).toBe(0);
  });

  it('returns empty result for buffer with wrong magic bytes', async () => {
    const result = await extractPdfText(Buffer.from('%PNG\x89\x50\x4E\x47'));
    expect(result.text).toBe('');
    expect(result.pageCount).toBe(0);
  });

  it('returns empty result for very short buffer (< 4 bytes)', async () => {
    const result = await extractPdfText(Buffer.from('%PD'));
    expect(result.text).toBe('');
    expect(result.pageCount).toBe(0);
  });

  it('returns empty result for truncated PDF', async () => {
    // Has magic bytes but no valid structure
    const result = await extractPdfText(Buffer.from('%PDF-1.4\ngarbage'));
    expect(result.text).toBe('');
    expect(result.pageCount).toBe(0);
  });
});

// ── Return type structure ─────────────────────────────────────────────────

describe('return type structure', () => {
  it('returns PdfExtractionResult with text and pageCount', async () => {
    const result = await extractPdfText(Buffer.alloc(0));
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('pageCount');
    expect(typeof result.text).toBe('string');
    expect(typeof result.pageCount).toBe('number');
  });
});

// ── isTextExtractionUseful ───────────────────────────────────────────────

describe('isTextExtractionUseful', () => {
  it('returns false for empty text', () => {
    expect(isTextExtractionUseful({ text: '', pageCount: 0 })).toBe(false);
  });

  it('returns false for very sparse text (< 50 chars per page)', () => {
    expect(isTextExtractionUseful({ text: 'short', pageCount: 1 })).toBe(false);
  });

  it('returns true for substantial text (>= 50 chars per page)', () => {
    const text = 'Schätzwert EUR 250.000 Wohnfläche 75m² Bezirksgericht Innere Stadt Wien';
    expect(isTextExtractionUseful({ text, pageCount: 1 })).toBe(true);
  });

  it('evaluates chars per page for multi-page documents', () => {
    // 100 chars across 5 pages = 20 chars/page → not useful
    const shortText = 'x'.repeat(100);
    expect(isTextExtractionUseful({ text: shortText, pageCount: 5 })).toBe(false);

    // 500 chars across 5 pages = 100 chars/page → useful
    const longText = 'x'.repeat(500);
    expect(isTextExtractionUseful({ text: longText, pageCount: 5 })).toBe(true);
  });

  it('handles 0 pages gracefully', () => {
    const text = 'Some extracted text that is long enough to pass the threshold';
    expect(isTextExtractionUseful({ text, pageCount: 0 })).toBe(true);
  });
});

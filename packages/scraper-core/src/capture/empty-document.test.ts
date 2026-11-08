import { describe, expect, it } from 'vitest';
import { isEmptyDocument } from './empty-document.js';

describe('isEmptyDocument', () => {
  // A blank capture counted as a fetch without a listing moves a live listing toward expiry.
  it('recognises the blank document and nothing with content', () => {
    expect(isEmptyDocument('<html><head></head><body></body></html>')).toBe(true);
    expect(
      isEmptyDocument('<html><head><title>x</title></head><body> <!-- --> </body></html>'),
    ).toBe(true);

    expect(isEmptyDocument('<html><body><div class="loader"></div></body></html>')).toBe(false);
    expect(isEmptyDocument('<html><body>Diese Seite gibt es nicht mehr</body></html>')).toBe(false);
  });
});

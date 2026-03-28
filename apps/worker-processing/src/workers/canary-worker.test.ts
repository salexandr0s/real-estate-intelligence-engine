import { describe, expect, it } from 'vitest';
import { EdikteMapper } from '@immoradar/normalization';

describe('canary worker normalizer coverage', () => {
  it('exposes the Edikte mapper from normalization for canary use', () => {
    const mapper = new EdikteMapper();

    expect(mapper.sourceCode).toBe('edikte');
    expect(mapper.normalizationVersion).toBeGreaterThan(0);
  });
});

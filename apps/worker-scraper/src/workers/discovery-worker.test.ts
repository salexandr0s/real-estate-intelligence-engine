import { describe, expect, it } from 'vitest';
import { resolveRunOutcome, type DiscoveryEnd } from './discovery-worker.js';

const blocked: DiscoveryEnd = {
  kind: 'page_error',
  errorClass: 'soft_anti_bot',
  message: 'HTTP 403',
};

describe('resolveRunOutcome', () => {
  // Counting any run that queued a detail page as a success would hide a page 2 that always fails.
  it.each<[string, DiscoveryEnd, number, number, string, string | undefined]>([
    ['pagination ran out', { kind: 'exhausted' }, 3, 60, 'succeeded', undefined],
    ['the page cap stopped it', { kind: 'page_cap' }, 60, 1200, 'partial', 'page_cap'],
    ['page 2 failed after page 1 had listings', blocked, 1, 20, 'partial', 'soft_anti_bot'],
    ['pages loaded with no listings', { kind: 'exhausted' }, 2, 0, 'failed', 'no_items'],
    // The cause carries the breaker's reason, so a pause after network errors isn't counted.
    [
      'the breaker held it before page 1',
      { kind: 'breaker_open', reason: 'transient_network' },
      0,
      0,
      'rate_limited',
      'transient_network',
    ],
    ['the scraper shut down', { kind: 'shutdown' }, 5, 100, 'cancelled', 'shutdown'],
  ])('%s', (_, end, pages, items, status, errorCode) => {
    const result = resolveRunOutcome(end, pages, items);
    expect(result.status).toBe(status);
    expect(result.cause?.errorCode).toBe(errorCode);
  });
});

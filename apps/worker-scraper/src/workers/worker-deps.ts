import type { PerDomainRateLimiter, SourceCircuitBreaker } from '@immoradar/scraper-core';

/**
 * What the discovery and detail workers of one scraper process share. One limiter and one breaker
 * mean search pages and listing pages count against the same rate and the same failure streak.
 */
export interface ScraperWorkerDeps {
  /** Aborts when the process starts shutting down. */
  shutdownSignal: AbortSignal;
  rateLimiter: PerDomainRateLimiter;
  circuitBreaker: SourceCircuitBreaker;
}

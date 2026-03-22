// ── Types ────────────────────────────────────────────────────────────────────
export {
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  DEFAULT_SCRAPER_SOURCE_CONFIG,
  VIEWPORT_POOL,
  USER_AGENT_POOL,
  pickRandomViewport,
  pickRandomUserAgent,
  type BrowserContextConfig,
  type CaptureResult,
  type ScraperSourceConfig,
} from './types/index.js';

// ── Rate Limiting ────────────────────────────────────────────────────────────
export { PerDomainRateLimiter } from './rate-limit/rate-limiter.js';

// ── Retries ──────────────────────────────────────────────────────────────────
export { ClassifiedError, withRetry } from './retries/retry.js';
export { classifyScraperError } from './retries/classify.js';

// ── Capture ──────────────────────────────────────────────────────────────────
export { ArtifactWriter, type ArtifactWriterPort } from './capture/artifact-writer.js';
export { computeContentHash } from './capture/content-hash.js';

// ── Health ───────────────────────────────────────────────────────────────────
export { SourceCircuitBreaker, type CircuitState } from './health/circuit-breaker.js';

// ── Adapters ─────────────────────────────────────────────────────────────────
export { ScrapeRunContext } from './adapters/run-context.js';

// ── Browser Utilities ────────────────────────────────────────────────────────
export {
  cooldownDelay,
  interactionDelay,
  jitteredDelay,
  pageNavigationDelay,
  randomInt,
} from './browser/delay.js';
export { dismissCookieConsent, type CookieConsentConfig } from './browser/cookie-consent.js';
export { setupRequestInterception } from './browser/request-interceptor.js';

// ── Queues ──────────────────────────────────────────────────────────────────
export {
  QUEUE_NAMES,
  type DiscoveryJobData,
  type DetailJobData,
  type ProcessingJobData,
  type BaselineJobData,
  type GeocodingJobData,
  type RescoreJobData,
} from './queues/queue-names.js';
export { getRedisConnection, closeRedisConnection, getQueuePrefix } from './queues/connection.js';

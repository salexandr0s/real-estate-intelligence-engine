// ── Types ────────────────────────────────────────────────────────────────────
export {
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  DEFAULT_SCRAPER_SOURCE_CONFIG,
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

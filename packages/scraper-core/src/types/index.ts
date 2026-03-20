// ── Scraper-specific configuration types ────────────────────────────────────

export interface ScraperSourceConfig {
  /** Minimum delay between requests in milliseconds */
  minDelayMs: number;
  /** Maximum delay between requests in milliseconds */
  maxDelayMs: number;
  /** Max concurrent browser contexts for this source */
  concurrency: number;
  /** Max retries per page fetch */
  maxRetries: number;
  /** Requests per minute limit for this source */
  rateLimitRpm: number;
  /** Max pages to crawl per discovery run */
  maxPagesPerRun: number;
  /** Cooldown duration in ms after a soft block signal */
  cooldownAfterBlockMs: number;
}

export interface BrowserContextConfig {
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
  userAgent: string;
  isMobile: boolean;
  hasTouch: boolean;
  javaScriptEnabled: boolean;
  acceptDownloads: boolean;
  ignoreHTTPSErrors: boolean;
}

export interface CaptureResult {
  htmlStorageKey: string | null;
  screenshotStorageKey: string | null;
  harStorageKey: string | null;
  contentHash: string;
  capturedAt: string;
}

/** Default scraper config values per source (overridable) */
export const DEFAULT_SCRAPER_SOURCE_CONFIG: ScraperSourceConfig = {
  minDelayMs: 2000,
  maxDelayMs: 7000,
  concurrency: 1,
  maxRetries: 3,
  rateLimitRpm: 12,
  maxPagesPerRun: 50,
  cooldownAfterBlockMs: 900_000,
};

/** Default browser context config for Austrian real estate scraping */
export const DEFAULT_BROWSER_CONTEXT_CONFIG: BrowserContextConfig = {
  viewport: { width: 1366, height: 768 },
  locale: 'de-AT',
  timezoneId: 'Europe/Vienna',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  isMobile: false,
  hasTouch: false,
  javaScriptEnabled: true,
  acceptDownloads: false,
  ignoreHTTPSErrors: false,
};

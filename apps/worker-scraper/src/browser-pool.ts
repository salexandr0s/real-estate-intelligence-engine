/**
 * Managed Playwright browser lifecycle.
 * Provides a shared browser instance with context creation for scraping jobs.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import { DEFAULT_BROWSER_CONTEXT_CONFIG } from '@rei/scraper-core';
import { createLogger } from '@rei/observability';

const log = createLogger('browser-pool');

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;

  log.info('Launching Playwright browser');
  _browser = await chromium.launch({ headless: true });
  return _browser;
}

export async function createScrapeContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    viewport: DEFAULT_BROWSER_CONTEXT_CONFIG.viewport,
    locale: DEFAULT_BROWSER_CONTEXT_CONFIG.locale,
    timezoneId: DEFAULT_BROWSER_CONTEXT_CONFIG.timezoneId,
    userAgent: DEFAULT_BROWSER_CONTEXT_CONFIG.userAgent,
    javaScriptEnabled: DEFAULT_BROWSER_CONTEXT_CONFIG.javaScriptEnabled,
  });
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    log.info('Closing Playwright browser');
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

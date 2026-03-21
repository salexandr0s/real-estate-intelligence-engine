/**
 * Managed Playwright browser lifecycle.
 * Provides a shared browser instance with context creation for scraping jobs.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import {
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  pickRandomViewport,
  pickRandomUserAgent,
} from '@rei/scraper-core';
import { loadConfig } from '@rei/config';
import { createLogger } from '@rei/observability';

const log = createLogger('browser-pool');

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;

  log.info('Launching Playwright browser');
  _browser = await chromium.launch({ headless: loadConfig().playwright.headless });
  return _browser;
}

export async function createScrapeContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  const viewport = pickRandomViewport();
  const userAgent = pickRandomUserAgent();
  log.debug('Browser context config', { viewport, userAgent: userAgent.slice(0, 40) });
  return browser.newContext({
    viewport,
    locale: DEFAULT_BROWSER_CONTEXT_CONFIG.locale,
    timezoneId: DEFAULT_BROWSER_CONTEXT_CONFIG.timezoneId,
    userAgent,
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
